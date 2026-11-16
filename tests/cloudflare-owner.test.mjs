import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { authorizeOwner, clearCertificateCache } from '../server/auth.js';
import { publicContent, ownerContent, ownerSession, ownerPublish, ownerStats } from '../server/owner-api.js';

const origin = 'https://bts.example.org';
const issuer = 'https://bts-test.cloudflareaccess.com';
const envBase = { CF_ACCESS_TEAM_DOMAIN: 'bts-test.cloudflareaccess.com', CF_ACCESS_AUD: 'owner-app', OWNER_EMAIL: 'ammarashary@gmail.com' };
const fixture = JSON.parse(await readFile(new URL('../assets/site-content.json', import.meta.url), 'utf8'));
const clone = () => structuredClone(fixture);
const originalFetch = globalThis.fetch;
let privateKey, publicJWK, provider;
const b64 = value => Buffer.from(value).toString('base64url');
async function token(overrides = {}, header = {}) {
  const now = Math.floor(Date.now() / 1000);
  const encoded = [b64(JSON.stringify({ alg: 'RS256', kid: 'test-key', ...header })), b64(JSON.stringify({ iss: issuer, aud: ['owner-app'], sub: 'owner-test-subject', email: 'ammarashary@gmail.com', iat: now - 5, exp: now + 600, ...overrides }))].join('.');
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(encoded));
  return `${encoded}.${b64(signature)}`;
}
function database() {
  const state = { row: null, writes: 0 };
  return { state, prepare(sql) {
    let values;
    return {
      bind(...input) { values = input; return this; },
      async first() { return state.row && { ...state.row }; },
      async run() {
        if (sql.startsWith('INSERT')) {
          if (state.row) return { success: true, meta: { changes: 0 } };
          state.row = { content_json: values[0], revision: 1, updated_at: values[1] };
        } else if (sql.startsWith('UPDATE')) {
          if (!state.row || state.row.revision !== values[3]) return { success: true, meta: { changes: 0 } };
          state.row = { content_json: values[0], revision: values[1], updated_at: values[2] };
        } else throw new Error('Unexpected SQL');
        state.writes++; return { success: true, meta: { changes: 1 } };
      }
    };
  } };
}
async function request(path, { claims, signed = true, method = 'GET', body, originHeader = origin, headers = {} } = {}) {
  if (signed) headers['Cf-Access-Jwt-Assertion'] = await token(claims);
  if (method === 'POST') { if (originHeader !== null) headers.Origin = originHeader; headers['Content-Type'] = 'application/json'; }
  return new Request(origin + path, { method, headers, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) });
}
before(async () => {
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  privateKey = pair.privateKey; publicJWK = { ...await crypto.subtle.exportKey('jwk', pair.publicKey), kid: 'test-key', alg: 'RS256', use: 'sig' };
  globalThis.fetch = async (url, options) => {
    if (url === `${issuer}/cdn-cgi/access/certs`) return Response.json({ keys: [publicJWK] });
    if (url === 'https://api.cloudflare.com/client/v4/graphql') return provider(url, options);
    throw new Error('Unexpected external request');
  };
});
beforeEach(() => { clearCertificateCache(); provider = async () => { throw new Error('Unexpected analytics fetch'); }; });
after(() => { globalThis.fetch = originalFetch; clearCertificateCache(); });

test('owner endpoints fail closed before identity is configured', async () => {
  for (const handler of [ownerSession, ownerContent, ownerPublish, ownerStats]) {
    const response = await handler({ request: await request('/api/owner/session', { signed: false }), env: {} });
    assert.equal(response.status, 503); assert.equal((await response.json()).code, 'owner_auth_not_configured');
  }
});
test('a bare email header cannot authorize any owner endpoint', async () => {
  for (const handler of [ownerSession, ownerContent, ownerPublish, ownerStats]) {
    const response = await handler({ request: await request('/api/owner/session', { signed: false, headers: { 'Cf-Access-Authenticated-User-Email': 'ammarashary@gmail.com' } }), env: envBase });
    assert.equal(response.status, 401);
  }
});
test('only signed RS256 tokens with correct issuer, audience and current expiry work', async () => {
  assert.equal((await authorizeOwner(await request('/api/owner/session'), envBase)).email, 'ammarashary@gmail.com');
  for (const claims of [{ aud: ['different-app'] }, { iss: 'https://evil.example.org' }, { exp: Math.floor(Date.now() / 1000) - 1 }, { nbf: Math.floor(Date.now() / 1000) + 900 }, { sub: '' }]) {
    await assert.rejects(authorizeOwner(await request('/api/owner/session', { claims }), envBase), error => error.status === 401);
  }
  const invalid = await token({}, { alg: 'none' });
  await assert.rejects(authorizeOwner(new Request(origin, { headers: { 'Cf-Access-Jwt-Assertion': invalid } }), envBase), error => error.status === 401);
  const parts = (await token()).split('.'); parts[2] = (parts[2][0] === 'A' ? 'B' : 'A') + parts[2].slice(1);
  await assert.rejects(authorizeOwner(new Request(origin, { headers: { 'Cf-Access-Jwt-Assertion': parts.join('.') } }), envBase), error => error.status === 401);
});
test('a signed token for another email is denied', async () => {
  const response = await ownerSession({ request: await request('/api/owner/session', { claims: { email: 'other@example.org' } }), env: envBase });
  assert.equal(response.status, 403); assert.equal((await response.json()).code, 'owner_required');
});
test('the owner allowlist admits both configured owners and reports the signed-in email', async () => {
  const env = { ...envBase, OWNER_EMAILS: ' AMMARASHARY@gmail.com, BreakingTheSkyAdmissions@Gmail.com ' };
  for (const email of ['ammarashary@gmail.com', 'breakingtheskyadmissions@gmail.com']) {
    const response = await ownerSession({ request: await request('/api/owner/session', { claims: { email: email.toUpperCase() } }), env });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { owner: true, email, analyticsConfigured: false });
  }
  for (const email of ['other@example.org', 'breakingtheskyadmissions+other@gmail.com', 'breakingtheskyadmissions@gmail.com.evil.example']) {
    const response = await ownerSession({ request: await request('/api/owner/session', { claims: { email } }), env });
    assert.equal(response.status, 403); assert.equal((await response.json()).code, 'owner_required');
  }
});
test('an explicit allowlist replaces the legacy owner instead of extending it', async () => {
  const env = { ...envBase, OWNER_EMAILS: 'breakingtheskyadmissions@gmail.com' };
  assert.equal((await ownerSession({ request: await request('/api/owner/session'), env })).status, 403);
  const allowed = await authorizeOwner(await request('/api/owner/session', { claims: { email: 'breakingtheskyadmissions@gmail.com' } }), env);
  assert.equal(allowed.email, 'breakingtheskyadmissions@gmail.com');
});
test('malformed owner allowlists fail closed even when the legacy owner is valid', async () => {
  const invalidLists = [
    '', '   ', ',ammarashary@gmail.com', 'ammarashary@gmail.com,', 'ammarashary@gmail.com,,breakingtheskyadmissions@gmail.com',
    'ammarashary@gmail.com,not-an-email', '*@gmail.com', 'ammara?@gmail.com', 'owner@*.example.org',
    '.owner@example.org', 'owner..name@example.org', 'owner.@example.org', 'Owner <owner@example.org>',
    `${'a'.repeat(65)}@example.org`, `owner@${'a'.repeat(64)}.org`, 'owner@exa\nmple.org',
    Array.from({ length: 11 }, (_, index) => `owner${index}@example.org`).join(','), 'x'.repeat(4097),
    null, 42, ['ammarashary@gmail.com']
  ];
  const signedRequest = await request('/api/owner/session');
  for (const OWNER_EMAILS of invalidLists) {
    const response = await ownerSession({ request: signedRequest, env: { ...envBase, OWNER_EMAILS } });
    assert.equal(response.status, 503, `Invalid owner list must fail closed: ${JSON.stringify(OWNER_EMAILS)}`);
    assert.equal((await response.json()).code, 'owner_auth_not_configured');
  }
});
test('owner allowlists support at most ten exact email addresses', async () => {
  const owners = Array.from({ length: 10 }, (_, index) => `owner${index}@example.org`);
  const env = { ...envBase, OWNER_EMAILS: owners.join(',') };
  assert.equal((await authorizeOwner(await request('/api/owner/session', { claims: { email: owners[9] } }), env)).email, owners[9]);
});
test('legacy OWNER_EMAIL remains normalized and limited to one valid address', async () => {
  assert.equal((await authorizeOwner(await request('/api/owner/session'), { ...envBase, OWNER_EMAIL: ' AMMARASHARY@GMAIL.COM ' })).email, 'ammarashary@gmail.com');
  for (const OWNER_EMAIL of ['', '*@gmail.com', 'not-an-email', 'ammarashary@gmail.com,breakingtheskyadmissions@gmail.com']) {
    const response = await ownerSession({ request: await request('/api/owner/session'), env: { ...envBase, OWNER_EMAIL } });
    assert.equal(response.status, 503); assert.equal((await response.json()).code, 'owner_auth_not_configured');
  }
});
test('owner session exposes no API token and accurately reports absent analytics', async () => {
  const response = await ownerSession({ request: await request('/api/owner/session'), env: { ...envBase, CF_ANALYTICS_API_TOKEN: 'test-server-secret' } });
  assert.equal(response.status, 200); assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await response.json(), { owner: true, email: 'ammarashary@gmail.com', analyticsConfigured: false });
});
test('publishing rejects missing/cross-site origins and non-JSON payloads', async () => {
  const db = database(); const env = { ...envBase, BTS_DB: db };
  for (const originHeader of [null, 'https://other.example.org']) {
    const response = await ownerPublish({ request: await request('/api/owner/publish', { method: 'POST', originHeader, body: { content: clone(), expectedRevision: 0 } }), env });
    assert.equal(response.status, 403);
  }
  const req = await request('/api/owner/publish', { method: 'POST', body: '{}' }); req.headers.set('Content-Type', 'text/plain');
  assert.equal((await ownerPublish({ request: req, env })).status, 415); assert.equal(db.state.writes, 0);
});
test('invalid or oversized content never writes to storage', async () => {
  const db = database(); const env = { ...envBase, BTS_DB: db };
  const bad = clone(); bad.people[0].photo = 'javascript:alert(1)';
  const invalid = await ownerPublish({ request: await request('/api/owner/publish', { method: 'POST', body: { content: bad, expectedRevision: 0 } }), env });
  assert.equal(invalid.status, 400);
  const tooBig = await ownerPublish({ request: await request('/api/owner/publish', { method: 'POST', body: JSON.stringify({ data: 'x'.repeat(2 * 1024 * 1024) }) }), env });
  assert.equal(tooBig.status, 413); assert.equal(db.state.writes, 0);
});
test('first publication persists, subsequent edits require the current revision', async () => {
  const db = database(); const env = { ...envBase, BTS_DB: db };
  const send = async (content, expectedRevision) => ownerPublish({ request: await request('/api/owner/publish', { method: 'POST', body: { content, expectedRevision } }), env });
  const first = await send(clone(), 0); assert.equal(first.status, 200); assert.equal((await first.json()).revision, 1);
  const changed = clone(); changed.home.headline = 'A new headline.';
  assert.equal((await send(changed, 0)).status, 409); assert.equal(db.state.writes, 1);
  const second = await send(changed, 1); assert.equal(second.status, 200); assert.equal((await second.json()).revision, 2);
  assert.equal(JSON.parse(db.state.row.content_json).home.headline, 'A new headline.');
});
test('public data excludes every hidden profile while owner data retains it', async () => {
  const db = database(); const env = { ...envBase, BTS_DB: db }; const content = clone();
  content.people.forEach(person => { person.visible = false; person.bio = 'PRIVATE-HIDDEN-BIO'; });
  await ownerPublish({ request: await request('/api/owner/publish', { method: 'POST', body: { content, expectedRevision: 0 } }), env });
  const publicResponse = await publicContent({ request: await request('/api/content', { signed: false }), env });
  const publicBody = await publicResponse.text(); assert(!publicBody.includes('PRIVATE-HIDDEN-BIO')); assert.deepEqual(JSON.parse(publicBody).content.people, []);
  const privateResponse = await ownerContent({ request: await request('/api/owner/content'), env });
  assert.equal((await privateResponse.json()).content.people.length, content.people.length);
});
test('unpublished storage returns revision zero; missing storage does not claim success', async () => {
  const response = await publicContent({ request: await request('/api/content', { signed: false }), env: { BTS_DB: database() } });
  assert.deepEqual(await response.json(), { content: null, revision: 0, updatedAt: null });
  assert.equal((await ownerContent({ request: await request('/api/owner/content'), env: envBase })).status, 503);
});
test('unconnected stats contain no fabricated metrics', async () => {
  const response = await ownerStats({ request: await request('/api/owner/stats?days=7'), env: envBase });
  const body = await response.json(); assert.equal(body.connected, false); assert(!('totals' in body)); assert(!('daily' in body));
});
test('real provider metrics are aggregated, with unique IPs left daily only', async () => {
  const end = new Date(); end.setUTCHours(0, 0, 0, 0); const date = new Date(end); date.setUTCDate(date.getUTCDate() - 1);
  let sent;
  provider = async (_url, options) => { sent = options; return Response.json({ data: { viewer: { zones: [{ httpRequests1dGroups: [{ dimensions: { date: date.toISOString().slice(0, 10) }, sum: { requests: 15, pageViews: 7, bytes: 12000 }, uniq: { uniques: 4 } }] }] } } }); };
  const response = await ownerStats({ request: await request('/api/owner/stats?days=7'), env: { ...envBase, CF_ZONE_ID: 'a'.repeat(32), CF_ANALYTICS_API_TOKEN: 'server-secret-only' } });
  assert.equal(response.status, 200); const body = await response.json(); assert.equal(body.connected, true);
  assert.deepEqual(body.totals, { requests: 15, pageViews: 7, bytes: 12000 }); assert.equal(body.daily[0].uniqueIPs, 4);
  assert.equal(body.period.endExclusive, true); assert.equal(body.period.timeZone, 'UTC');
  assert(!JSON.stringify(body).includes('server-secret-only')); assert.equal(sent.headers.Authorization, 'Bearer server-secret-only');
});
test('provider failure yields an error, never fake zero traffic', async () => {
  provider = async () => Response.json({ errors: [{ message: 'forbidden' }] });
  const response = await ownerStats({ request: await request('/api/owner/stats?days=30'), env: { ...envBase, CF_ZONE_ID: 'b'.repeat(32), CF_ANALYTICS_API_TOKEN: 'server-secret-only' } });
  assert.equal(response.status, 502); const body = await response.json(); assert.equal(body.connected, false); assert(!('totals' in body));
});
