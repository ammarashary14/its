import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateSiteContent } from '../assets/content-schema.js';
import { publishContent, readContent } from '../server/content-store.js';

const fixture = JSON.parse(await readFile(new URL('../assets/site-content.json', import.meta.url), 'utf8'));
const contentWith = (platform, url) => {
  const content = structuredClone(fixture);
  content.community[platform] = url;
  return content;
};

test('older version 1 content and drafts gain empty social links without losing fields', () => {
  const old = structuredClone(fixture);
  delete old.community.instagram; delete old.community.facebook;
  delete old.schools; delete old.donation;
  const upgraded = validateSiteContent(old);
  assert.equal(upgraded.community.instagram, '');
  assert.equal(upgraded.community.facebook, '');
  assert.deepEqual(upgraded.schools, []);
  assert.deepEqual(upgraded.donation, { url: '' });
  assert.deepEqual(upgraded.people, old.people);
  assert.deepEqual(upgraded.home, old.home);
  delete old.community;
  const early = validateSiteContent(old);
  assert.equal(early.community.instagram, '');
  assert.equal(early.community.facebook, '');
});

test('blank social profiles stay blank and never become invented account links', () => {
  const value = validateSiteContent(contentWith('instagram', '   '));
  assert.equal(value.community.instagram, '');
  assert.equal(value.community.facebook, '');
  assert.equal(value.community.discordInvite, '');
});

test('direct Instagram profiles and Facebook pages are accepted with tracking removed', () => {
  assert.equal(validateSiteContent(contentWith('instagram', 'https://www.instagram.com/bts.example/?igsh=tracking#bio')).community.instagram, 'https://www.instagram.com/bts.example/');
  assert.equal(validateSiteContent(contentWith('facebook', 'https://www.facebook.com/bts.example/?ref=profile')).community.facebook, 'https://www.facebook.com/bts.example/');
  assert.equal(validateSiteContent(contentWith('facebook', 'https://m.facebook.com/people/BTS-Example/123456789/')).community.facebook, 'https://m.facebook.com/people/BTS-Example/123456789/');
  assert.equal(validateSiteContent(contentWith('facebook', 'https://www.facebook.com/profile.php?id=123456789&ref=bookmarks')).community.facebook, 'https://www.facebook.com/profile.php?id=123456789');
});

test('unsafe URLs, wrong hosts, platform homepages, and nonprofile routes are rejected', () => {
  for (const platform of ['instagram', 'facebook']) {
    for (const url of ['javascript:alert(1)', 'http://' + platform + '.com/bts/', 'https://' + platform + '.com.evil.test/bts/', 'https://evil.test/bts/', 'https://name:password@' + platform + '.com/bts/', 'https://' + platform + '.com:8080/bts/', 'https://' + platform + '.com/', 'https://' + platform + '.com/\nbts/', 'https://' + platform + '.com\\@evil.test/bts/']) {
      assert.throws(() => validateSiteContent(contentWith(platform, url)), undefined, url);
    }
  }
  for (const url of ['https://instagram.com/accounts/', 'https://instagram.com/p/post/', 'https://instagram.com/reel/abc/']) assert.throws(() => validateSiteContent(contentWith('instagram', url)));
  for (const url of ['https://facebook.com/l.php?u=https://evil.test', 'https://facebook.com/profile.php?id=not-an-id', 'https://facebook.com/share/abc/', 'https://facebook.com/login/']) assert.throws(() => validateSiteContent(contentWith('facebook', url)));
});

test('social URLs round-trip through publication and public reads while hidden profiles stay hidden', async () => {
  let row;
  const env = { BTS_DB: { prepare(sql) { return {
    bind(...args) { this.values = args; return this; },
    async run() { row = { content_json: this.values[0], revision: 1, updated_at: this.values[1] }; return { success: true, meta: { changes: 1 } }; },
    async first() { return row; }
  }; } } };
  const content = contentWith('instagram', 'https://www.instagram.com/bts.example/');
  content.community.facebook = 'https://www.facebook.com/bts.example/';
  content.people[0].visible = false;
  content.schools = [{id:'school-example',name:'Example School',location:'Example town',grades:'Grades 3–5',description:'Example partnership for validation.',website:'https://school.example.org/'}];
  content.donation = {url:'https://donate.example.org/bts'};
  await publishContent(env, { content, expectedRevision: 0 });
  const stored = await readContent(env, { publicView: true });
  assert.equal(stored.content.community.instagram, content.community.instagram);
  assert.equal(stored.content.community.facebook, content.community.facebook);
  assert.deepEqual(stored.content.schools, content.schools);
  assert.deepEqual(stored.content.donation, content.donation);
  assert.ok(!stored.content.people.some(person => person.id === content.people[0].id));
  const full = await readContent(env);
  assert.equal(full.content.people.length, content.people.length);
});

test('school records require a real name, unique ID, and valid optional public website', () => {
  const content = structuredClone(fixture);
  content.schools = [{id:'school-one',name:'Example School'}];
  assert.deepEqual(validateSiteContent(content).schools[0], {id:'school-one',name:'Example School',location:'',grades:'',description:'',website:''});
  content.schools[0].name = '';
  assert.throws(() => validateSiteContent(content));
  content.schools[0].name = 'Example School';
  content.schools.push({...content.schools[0]});
  assert.throws(() => validateSiteContent(content));
  content.schools.pop();
  for (const website of ['javascript:alert(1)', 'http://school.example.org/', 'https://user:password@school.example.org/', 'https://school.example.org/\nunsafe']) {
    content.schools[0].website = website;
    assert.throws(() => validateSiteContent(content));
  }
  content.schools = Array.from({length:31},(_,index)=>({id:`school-${index}`,name:'Example School'}));
  assert.throws(() => validateSiteContent(content));
});

test('donation links are optional HTTPS links and reject unsafe schemes or credentials', () => {
  const content = structuredClone(fixture);
  delete content.donation;
  assert.deepEqual(validateSiteContent(content).donation, {url:''});
  for (const url of ['javascript:alert(1)', 'data:text/html,pay', 'http://donate.example.org/', 'https://secret@donate.example.org/']) {
    content.donation = {url};
    assert.throws(() => validateSiteContent(content));
  }
  content.donation = {url:'https://donate.example.org/bts?campaign=education'};
  assert.deepEqual(validateSiteContent(content).donation, content.donation);
});
