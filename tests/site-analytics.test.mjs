import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { pageView, recordPageView, loadSiteStats, normalizePublicPath } from '../server/site-analytics.js';
import { analyticsConfigured, loadStats } from '../server/analytics.js';
import { ownerStats } from '../server/owner-api.js';

const origin = 'https://breakingthesky.com';
const analyticsSchema = await readFile(new URL('../migrations/0004_site_analytics.sql', import.meta.url), 'utf8');
const calendarAnalyticsSchema = await readFile(new URL('../migrations/0005_calendar_analytics.sql', import.meta.url), 'utf8');
const applicationsSchema = await readFile(new URL('../migrations/0002_applications.sql', import.meta.url), 'utf8');
const publicPaths = ['/', '/curriculum', '/team', '/tutoring', '/community', '/calendar', '/contact', '/apply', '/schools', '/sponsors', '/donate'];

test('calendar migration preserves existing counts and keeps private paths excluded', () => {
  const connection = new DatabaseSync(':memory:');
  connection.exec(analyticsSchema);
  connection.prepare('INSERT INTO site_page_views VALUES (?, ?, ?)').run('2026-11-16', '/', 42);
  connection.exec(calendarAnalyticsSchema);
  connection.prepare('INSERT INTO site_page_views VALUES (?, ?, ?)').run('2026-11-16', '/calendar', 1);
  assert.equal(connection.prepare('SELECT page_views FROM site_page_views WHERE path = ?').get('/').page_views, 42);
  assert.equal(connection.prepare('SELECT page_views FROM site_page_views WHERE path = ?').get('/calendar').page_views, 1);
  assert.throws(() => connection.prepare('INSERT INTO site_page_views VALUES (?, ?, ?)').run('2026-11-16', '/owner', 1));
  connection.close();
});

function database({ analytics = true, applications = true } = {}) {
  const connection = new DatabaseSync(':memory:');
  if (analytics) { connection.exec(analyticsSchema); connection.exec(calendarAnalyticsSchema); }
  if (applications) connection.exec(applicationsSchema);
  const operations = [];
  return { connection, operations, prepare(sql) {
    const statement = connection.prepare(sql); let values = [];
    const note = () => operations.push({ sql, values: [...values] });
    return {
      bind(...input) { values = input; return this; },
      async all() { note(); return { success: true, results: statement.all(...values) }; },
      async first() { note(); return statement.get(...values) || null; },
      async run() { note(); return { success: true, meta: { changes: Number(statement.run(...values).changes) } }; }
    };
  } };
}
function environment(db = database()) { return { BTS_SITE_ANALYTICS_ENABLED: 'true', BTS_DB: db }; }
function request(path = '/api/page-view', { method = 'POST', body = { path: '/' }, requestOrigin = origin, headers = {}, contentType = 'application/json' } = {}) {
  const allHeaders = { ...headers };
  if (requestOrigin !== null) allHeaders.Origin = requestOrigin;
  if (contentType) allHeaders['Content-Type'] = contentType;
  return new Request(origin + path, { method, headers: allHeaders, ...(method === 'GET' || method === 'HEAD' ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) });
}
function statsRequest(days = '7') { return new Request(origin + '/api/owner/stats?days=' + days); }
function addApplication(db, createdAt, index = 1) {
  db.connection.prepare('INSERT INTO applications (id, reference, payload_hash, name, email, message, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    `private-id-${index}`, `PRIVATE-REFERENCE-${index}`, 'test-hash', 'PRIVATE APPLICANT NAME', 'private-applicant@example.org', 'PRIVATE ANSWERS', createdAt, createdAt
  );
}

test('page aliases normalize to exactly eleven public aggregate paths', () => {
  for (const path of publicPaths) {
    assert.equal(normalizePublicPath(path), path);
    if (path !== '/') assert.equal(normalizePublicPath(path + '.html'), path);
  }
  assert.equal(normalizePublicPath('/index'), '/');
  assert.equal(normalizePublicPath('/index.html'), '/');
  for (const path of ['/owner', '/owner.html', '/editor.html', '/api/owner/content', '/assets/photo.jpg', '/unknown', '/team?email=private@example.org', '/team#private', '//team', '/team/', '/%74eam', '/TEAM', '/team\\other', 'https://breakingthesky.com/team', null]) {
    assert.throws(() => normalizePublicPath(path), error => error.code === 'invalid_page');
  }
});
test('only same-origin JSON POSTs with a single allowed path field can write', async () => {
  const env = environment();
  const cases = [
    { method: 'GET', status: 405 },
    { requestOrigin: null, status: 403 },
    { requestOrigin: 'https://other.example.org', status: 403 },
    { headers: { 'Sec-Fetch-Site': 'cross-site' }, status: 403 },
    { contentType: 'text/plain', status: 415 },
    { body: '{', status: 400 },
    { body: { path: '/', email: 'private@example.org' }, status: 400 },
    { body: [], status: 400 },
    { body: { path: '/owner.html' }, status: 400 },
    { body: JSON.stringify({ path: '/', extra: 'x'.repeat(1024) }), status: 413 }
  ];
  for (const item of cases) {
    const response = await pageView({ env, request: request('/api/page-view', item) });
    assert.equal(response.status, item.status);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
  }
  assert.equal(env.BTS_DB.connection.prepare('SELECT count(*) AS count FROM site_page_views').get().count, 0);
});
test('page events aggregate by UTC day and canonical path without storing visitor metadata', async () => {
  const env = environment();
  for (const path of ['/index.html', '/', '/team.html']) {
    const response = await pageView({ env, request: request('/api/page-view?visitor=private-query', {
      body: { path }, headers: { 'CF-Connecting-IP': '192.0.2.21', Referer: 'https://private.example.org/account', 'User-Agent': 'private-agent', Cookie: 'private-cookie=secret' }
    }) });
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), { success: true });
  }
  const rows = env.BTS_DB.connection.prepare('SELECT * FROM site_page_views ORDER BY path').all();
  assert.equal(rows.length, 2); assert.equal(rows[0].page_views, 2); assert.equal(rows[1].path, '/team');
  assert.equal(rows[0].day, new Date().toISOString().slice(0, 10));
  assert.deepEqual(env.BTS_DB.connection.prepare('PRAGMA table_info(site_page_views)').all().map(row => row.name), ['day', 'path', 'page_views']);
  const serialized = JSON.stringify({ rows, operations: env.BTS_DB.operations });
  for (const identity of ['192.0.2.21', 'private-query', 'private.example.org', 'private-agent', 'private-cookie']) assert(!serialized.includes(identity));
});
test('concurrent page events use an atomic UPSERT and do not overwrite counts', async () => {
  const env = environment(); const now = new Date('2026-11-16T18:00:00.000Z');
  await Promise.all(Array.from({ length: 25 }, () => recordPageView(env, '/curriculum.html', now)));
  assert.equal(env.BTS_DB.connection.prepare('SELECT page_views FROM site_page_views WHERE path = ?').get('/curriculum').page_views, 25);
});
test('analytics requires explicit enablement and unavailable storage never reports successful counts', async () => {
  for (const env of [{}, { BTS_DB: database() }, { BTS_SITE_ANALYTICS_ENABLED: true, BTS_DB: database() }, { BTS_SITE_ANALYTICS_ENABLED: 'true' }]) {
    assert.equal(analyticsConfigured(env), false);
    assert.equal((await pageView({ env, request: request() })).status, 503);
  }
  for (const db of [database({ analytics: false }), { prepare() { return { bind() { return this; }, async run() { return { success: false }; } }; } }]) {
    const response = await pageView({ env: environment(db), request: request() });
    assert.equal(response.status, 503); assert.equal((await response.json()).code, 'analytics_unavailable');
  }
  for (const db of [database({ analytics: false }), database({ applications: false })]) {
    await assert.rejects(loadSiteStats(statsRequest(), environment(db)), error => error.status === 503 && error.code === 'analytics_unavailable');
  }
});
test('seven-day stats include current UTC day, exclude outside records, and count only aggregate application totals', async () => {
  const env = environment(); const now = new Date('2026-11-16T00:30:00.000Z');
  await recordPageView(env, '/', new Date('2026-11-09T23:59:59.999Z'));
  await recordPageView(env, '/team', new Date('2026-11-10T00:00:00.000Z'));
  await recordPageView(env, '/', new Date('2026-11-16T00:01:00.000Z'));
  await recordPageView(env, '/index.html', new Date('2026-11-16T00:02:00.000Z'));
  await recordPageView(env, '/contact', new Date('2026-11-17T00:00:00.000Z'));
  addApplication(env.BTS_DB, '2026-11-09T23:59:59.999Z', 1);
  addApplication(env.BTS_DB, '2026-11-10T00:00:00.000Z', 2);
  addApplication(env.BTS_DB, '2026-11-16T00:03:00.000Z', 3);
  addApplication(env.BTS_DB, '2026-11-17T00:00:00.000Z', 4);
  const result = await loadSiteStats(statsRequest('7'), env, now);
  assert.equal(result.connected, true); assert.equal(result.provider, 'site'); assert.equal(result.source, 'BTS website page views');
  assert.deepEqual(result.period, { start: '2026-11-10', end: '2026-11-16', timeZone: 'UTC', endExclusive: false });
  assert.deepEqual(result.totals, { pageViews: 3, applications: 2, activePages: 2 });
  assert.equal(result.daily.length, 7);
  assert.deepEqual(result.daily[0], { date: '2026-11-10', pageViews: 1, applications: 1 });
  assert.deepEqual(result.daily[1], { date: '2026-11-11', pageViews: 0, applications: 0 });
  assert.deepEqual(result.daily[6], { date: '2026-11-16', pageViews: 2, applications: 1 });
  assert.deepEqual(result.pages, [{ path: '/', pageViews: 2 }, { path: '/team', pageViews: 1 }]);
  assert.equal(result.updatedAt, now.toISOString());
  assert(!JSON.stringify(result).includes('PRIVATE')); assert(!JSON.stringify(result).includes('private-applicant'));
  const applicationQueries = env.BTS_DB.operations.filter(operation => operation.sql.includes('FROM applications'));
  assert.equal(applicationQueries.length, 1); assert(applicationQueries[0].sql.includes('COUNT(*)'));
});
test('thirty-day calendar period crosses month/year boundaries and genuine empty results return zero totals', async () => {
  const env = environment();
  const result = await loadSiteStats(statsRequest('30'), env, new Date('2026-01-02T23:59:59.000Z'));
  assert.deepEqual(result.period, { start: '2025-12-04', end: '2026-01-02', timeZone: 'UTC', endExclusive: false });
  assert.equal(result.daily.length, 30); assert.deepEqual(result.totals, { pageViews: 0, applications: 0, activePages: 0 }); assert.deepEqual(result.pages, []);
  for (const days of ['0', '8', '31', '7.0', '7 OR 1=1']) await assert.rejects(loadSiteStats(statsRequest(days), env), error => error.status === 400);
});
test('private stats use enabled D1 without fetching any external analytics provider', async () => {
  const env = environment(); await recordPageView(env, '/schools');
  assert.equal(analyticsConfigured(env), true);
  const stats = await loadStats(statsRequest(), env, () => { throw new Error('No external token or request is required'); });
  assert.equal(stats.provider, 'site'); assert.equal(stats.totals.pageViews, 1);
  const forbidden = await ownerStats({ env: { ...env, CF_ACCESS_TEAM_DOMAIN: 'bts-test.cloudflareaccess.com', CF_ACCESS_AUD: 'owner-app', OWNER_EMAIL: 'owner@example.org' }, request: statsRequest() });
  assert.equal(forbidden.status, 401);
});
test('explicit Cloudflare zone configuration preserves legacy provider precedence and period semantics', async () => {
  const env = { ...environment(), CF_ANALYTICS_API_TOKEN: 'test-secret-only', CF_ZONE_ID: 'a'.repeat(32) }; let calls = 0;
  const stats = await loadStats(statsRequest(), env, async (url, options) => {
    calls++; assert.equal(url, 'https://api.cloudflare.com/client/v4/graphql'); assert.equal(options.headers.Authorization, 'Bearer test-secret-only');
    return Response.json({ data: { viewer: { zones: [{ httpRequests1dGroups: [] }] } } });
  });
  assert.equal(calls, 1); assert.equal(stats.source, 'Cloudflare zone traffic'); assert.equal(stats.period.endExclusive, true); assert.equal(stats.provider, undefined);
  assert.deepEqual(stats.totals, { pageViews: 0, requests: 0, bytes: 0 });
});
