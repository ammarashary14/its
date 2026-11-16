import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { validateSiteContent, CALENDAR_CATEGORIES, CONTENT_LIMITS } from '../assets/content-schema.js';
import { publishContent, readContent } from '../server/content-store.js';

const fixture = JSON.parse(await readFile(new URL('../assets/site-content.json', import.meta.url), 'utf8'));
const schema = await readFile(new URL('../migrations/0001_owner_content.sql', import.meta.url), 'utf8');
const event = (changes = {}) => ({
  id: 'event-one', title: 'Volunteer planning', date: '2026-11-20', startTime: '15:30', endTime: '16:30',
  category: 'volunteer', location: 'Community room', description: 'Planning the next classroom activity.', url: 'https://events.example.org/planning', visible: true, ...changes
});
function content(events = [event()], timeZone = 'America/Chicago') {
  return { ...structuredClone(fixture), calendar: { timeZone, events } };
}
function database() {
  const connection = new DatabaseSync(':memory:'); connection.exec(schema);
  return { connection, prepare(sql) {
    const statement = connection.prepare(sql); let values = [];
    return {
      bind(...args) { values = args; return this; },
      async first() { return statement.get(...values) || null; },
      async run() { return { success: true, meta: { changes: Number(statement.run(...values).changes) } }; }
    };
  } };
}

test('legacy version 1 content gains an empty UTC calendar without changing other content', () => {
  const old = structuredClone(fixture); delete old.calendar;
  const validated = validateSiteContent(old);
  assert.deepEqual(validated.calendar, { timeZone: 'UTC', events: [] });
  assert.deepEqual(validated.people, old.people); assert.deepEqual(validated.home, old.home);
  assert.equal(Object.hasOwn(old, 'calendar'), false);
  assert.equal(CONTENT_LIMITS.calendarEvents, 100); assert(Object.isFrozen(CALENDAR_CATEGORIES));
  assert.deepEqual(CALENDAR_CATEGORIES, ['school', 'tutoring', 'volunteer', 'community', 'other']);
});

test('calendar retains its named time zone and local date/time without shifting the date', () => {
  for (const timeZone of ['UTC', 'America/Chicago', 'Asia/Kolkata', 'Etc/GMT+5']) {
    const result = validateSiteContent(content([event({ date: '2026-11-01', startTime: '01:30', endTime: '02:30' })], timeZone));
    assert.equal(result.calendar.timeZone, timeZone); assert.equal(result.calendar.events[0].date, '2026-11-01');
    assert.equal(result.calendar.events[0].startTime, '01:30');
  }
  for (const timeZone of ['Mars/Olympus', '+01:00', '-0600', 'America/Chicago\ninvalid', '', null]) {
    assert.throws(() => validateSiteContent(content([event()], timeZone)));
  }
  for (const calendar of [null, [], 'UTC', {}, { timeZone: 'UTC' }, { events: [] }, { timeZone: 'UTC', events: {} }]) {
    const value = content(); value.calendar = calendar; assert.throws(() => validateSiteContent(value));
  }
});

test('optional fields support all-day and open-ended events while required fields remain explicit', () => {
  const minimal = { id: 'all-day', title: 'School visit', date: '2026-12-01', category: 'school', visible: false };
  assert.deepEqual(validateSiteContent(content([minimal])).calendar.events[0], {
    ...minimal, startTime: '', endTime: '', location: '', description: '', url: ''
  });
  assert.equal(validateSiteContent(content([event({ endTime: '' })])).calendar.events[0].endTime, '');
  for (const property of ['id', 'title', 'date', 'category', 'visible']) {
    const value = event(); delete value[property]; assert.throws(() => validateSiteContent(content([value])), undefined, property);
  }
  assert.throws(() => validateSiteContent(content([event({ visible: 'false' })])));
  assert.throws(() => validateSiteContent(content([event({ category: 'private' })])));
});

test('calendar dates must exist and respect the 2000–2199 range, including leap-year rules', () => {
  for (const date of ['2000-02-29', '2004-02-29', '2196-02-29', '2199-12-31', '2000-01-01']) {
    assert.equal(validateSiteContent(content([event({ date })])).calendar.events[0].date, date);
  }
  for (const date of ['1999-12-31', '2200-01-01', '2100-02-29', '2026-02-29', '2026-04-31', '2026-00-01', '2026-13-01', '2026-01-00', '2026-01-32', '2026-1-01', '11/20/2026', '2026-11-20T00:00:00Z']) {
    assert.throws(() => validateSiteContent(content([event({ date })])), undefined, date);
  }
});

test('event times use 24-hour precision and cannot silently span overnight or end before starting', () => {
  assert.equal(validateSiteContent(content([event({ startTime: '00:00', endTime: '23:59' })])).calendar.events[0].endTime, '23:59');
  for (const changes of [{ startTime: '', endTime: '12:00' }, { startTime: '12:00', endTime: '12:00' }, { startTime: '23:30', endTime: '00:30' }, { startTime: '9:30' }, { startTime: '24:00' }, { endTime: '16:60' }, { endTime: '04 PM' }]) {
    assert.throws(() => validateSiteContent(content([event(changes)])));
  }
});

test('event IDs are safe and unique, and the event limit is enforced', () => {
  for (const id of ['constructor', 'prototype', '__proto__', 'contains space', 'Uppercase', 'x'.repeat(51), 'event.<script>']) {
    assert.throws(() => validateSiteContent(content([event({ id })])), undefined, id);
  }
  assert.throws(() => validateSiteContent(content([event(), event()])));
  const hundred = Array.from({ length: 100 }, (_, index) => event({ id: `event-${index}` }));
  assert.equal(validateSiteContent(content(hundred)).calendar.events.length, 100);
  assert.throws(() => validateSiteContent(content([...hundred, event({ id: 'event-101' })])));
});

test('calendar text limits and existing HTTPS URL validation apply to every event', () => {
  for (const [key, maximum] of [['title', 160], ['location', 250], ['description', 2000]]) {
    assert.equal(validateSiteContent(content([event({ [key]: 'x'.repeat(maximum) })])).calendar.events[0][key].length, maximum);
    assert.throws(() => validateSiteContent(content([event({ [key]: 'x'.repeat(maximum + 1) })])));
  }
  for (const url of ['javascript:alert(1)', 'http://events.example.org/', 'https://name:secret@events.example.org/', 'https://events.example.org:9000/', 'https://events.example.org/\nunsafe']) {
    assert.throws(() => validateSiteContent(content([event({ url })])), undefined, url);
  }
  assert.equal(validateSiteContent(content([event({ url: '', location: '  Library  ' })])).calendar.events[0].location, 'Library');
});

test('public content excludes hidden calendar events and profiles while owner reads preserve both', async () => {
  const env = { BTS_DB: database() };
  const hidden = event({ id: 'private-event', title: 'PRIVATE EVENT TITLE', location: 'PRIVATE LOCATION', description: 'PRIVATE DESCRIPTION', url: 'https://private.example.org/secret', visible: false });
  const value = content([event(), hidden]); value.people[0].visible = false; value.people[0].bio = 'PRIVATE STAFF BIO';
  await publishContent(env, { content: value, expectedRevision: 0 });
  const publicValue = await readContent(env, { publicView: true });
  assert.equal(publicValue.content.calendar.events.length, 1);
  assert.equal(publicValue.content.calendar.events[0].id, 'event-one');
  assert.equal(publicValue.content.calendar.timeZone, 'America/Chicago');
  for (const sensitive of ['PRIVATE', 'private-event', 'private.example.org']) assert(!JSON.stringify(publicValue).includes(sensitive));
  const ownerValue = await readContent(env);
  assert.equal(ownerValue.content.calendar.events.length, 2);
  assert.equal(ownerValue.content.people.length, value.people.length);
  assert.deepEqual(ownerValue.content.calendar.events[1], hidden);
  assert.equal(ownerValue.revision, 1);
});

test('all-hidden calendars return an empty public event list and legacy stored content stays readable', async () => {
  const env = { BTS_DB: database() };
  await publishContent(env, { content: content([event({ visible: false })]), expectedRevision: 0 });
  assert.deepEqual((await readContent(env, { publicView: true })).content.calendar.events, []);
  const old = structuredClone(fixture); delete old.calendar;
  env.BTS_DB.connection.prepare('UPDATE site_content SET content_json = ? WHERE id = 1').run(JSON.stringify(old));
  assert.deepEqual((await readContent(env, { publicView: true })).content.calendar, { timeZone: 'UTC', events: [] });
  assert.deepEqual((await readContent(env)).content.calendar, { timeZone: 'UTC', events: [] });
});

test('invalid event publication cannot overwrite saved calendar content', async () => {
  const env = { BTS_DB: database() };
  await publishContent(env, { content: content(), expectedRevision: 0 });
  await assert.rejects(publishContent(env, { content: content([event({ date: '2026-02-30' })]), expectedRevision: 1 }), error => error.code === 'invalid_content');
  const saved = await readContent(env);
  assert.equal(saved.revision, 1); assert.equal(saved.content.calendar.events[0].date, '2026-11-20');
});
