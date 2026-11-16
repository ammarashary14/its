import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { clearCertificateCache } from '../server/auth.js';
import { publicApplications, ownerApplications, ownerApplicationSettings, ownerApplicationDecision } from '../server/applications-api.js';
import { validateApplication, validateTemplates, validateDecision, decideApplication } from '../server/applications-store.js';

const origin = 'https://bts.example.org';
const issuer = 'https://applications-test.cloudflareaccess.com';
const auth = { CF_ACCESS_TEAM_DOMAIN: 'applications-test.cloudflareaccess.com', CF_ACCESS_AUD: 'owner-app', OWNER_EMAIL: 'owner@example.org' };
const schema = await readFile(new URL('../migrations/0002_applications.sql', import.meta.url), 'utf8');
const originalFetch = globalThis.fetch;
const baseApplication = { reference: 'BTS-11111111-2222-4333-8444-555555555555', name: 'Sample Applicant', email: 'applicant@example.org', message: 'Math interest: algebra\nAvailability: weekends', honey: '' };
let privateKey, jwk, provider;
const b64 = value => Buffer.from(value).toString('base64url');
async function token(email = auth.OWNER_EMAIL) {
  const now = Math.floor(Date.now() / 1000);
  const data = [b64(JSON.stringify({ alg: 'RS256', kid: 'applications-key' })), b64(JSON.stringify({ iss: issuer, aud: ['owner-app'], sub: 'owner-sub', email, iat: now - 5, exp: now + 600 }))].join('.');
  return data + '.' + b64(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(data)));
}
function database() {
  const connection = new DatabaseSync(':memory:'); connection.exec(schema);
  return { connection, prepare(sql) {
    const statement = connection.prepare(sql); let args = [];
    return { bind(...values) { args = values; return this; },
      async first() { return statement.get(...args) || null; },
      async all() { return { success: true, results: statement.all(...args) }; },
      async run() { const result = statement.run(...args); return { success: true, meta: { changes: Number(result.changes) } }; }
    };
  } };
}
function environment(db = database()) { return { ...auth, BTS_DB: db, BTS_APPLICATIONS_ENABLED: 'true', RESEND_API_KEY: 'secret-test-only', APPLICATION_FROM_EMAIL: 'applications@example.org' }; }
async function request(path, { method = 'GET', body, signed = true, originHeader = origin, email } = {}) {
  const headers = {};
  if (signed) headers['Cf-Access-Jwt-Assertion'] = await token(email);
  if (body !== undefined) { headers['Content-Type'] = 'application/json'; if (originHeader !== null) headers.Origin = originHeader; }
  return new Request(origin + path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function submit(env, value = baseApplication) {
  return publicApplications({ env, request: await request('/api/applications', { method: 'POST', signed: false, body: value }) });
}
async function saved(env) { return env.BTS_DB.prepare('SELECT * FROM applications').first(); }
async function decision(env, overrides = {}) {
  const row = await saved(env);
  return ownerApplicationDecision({ env, request: await request('/api/owner/applications/decision', { method: 'POST', body: { id: row.id, decision: 'accepted', subject: 'Your application', body: 'Hello Sample Applicant, thanks for applying.', ...overrides } }) });
}
before(async () => {
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  privateKey = pair.privateKey; jwk = { ...await crypto.subtle.exportKey('jwk', pair.publicKey), kid: 'applications-key', use: 'sig', alg: 'RS256' };
  globalThis.fetch = async (url, options) => {
    if (url === issuer + '/cdn-cgi/access/certs') return Response.json({ keys: [jwk] });
    if (url === 'https://api.resend.com/emails') return provider(url, options);
    throw new Error('Unexpected external network request');
  };
});
beforeEach(() => { clearCertificateCache(); provider = () => { throw new Error('Unexpected email send'); }; });
after(() => { globalThis.fetch = originalFetch; clearCertificateCache(); });

test('public discovery is disabled until intake, database, and migration are ready', async () => {
  for (const env of [{}, { BTS_DB: database() }, { BTS_APPLICATIONS_ENABLED: 'true' }, { BTS_APPLICATIONS_ENABLED: 'true', BTS_DB: { prepare() { throw new Error('Missing table'); } } }]) {
    const response = await publicApplications({ env, request: await request('/api/applications', { signed: false }) });
    assert.deepEqual(await response.json(), { enabled: false });
  }
  assert.equal((await submit({})).status, 503);
});
test('intake is idempotent by random reference and never sends email or exposes applicant data', async () => {
  const env = environment();
  for (let i = 0; i < 2; i++) {
    const response = await submit(env); assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true, reference: baseApplication.reference });
  }
  assert.equal(env.BTS_DB.connection.prepare('SELECT count(*) AS n FROM applications').get().n, 1);
  assert.equal((await submit(env, { ...baseApplication, message: 'Different answers' })).status, 409);
  const response = await publicApplications({ env, request: await request('/api/applications', { signed: false }) });
  assert.equal(response.headers.get('Cache-Control'), 'no-store'); assert.deepEqual(await response.json(), { enabled: true });
});
test('intake rejects cross-origin, invalid recipient, honeypot, invalid reference and oversized details', async () => {
  const env = environment();
  const cross = await publicApplications({ env, request: await request('/api/applications', { method: 'POST', signed: false, body: baseApplication, originHeader: 'https://other.example' }) });
  assert.equal(cross.status, 403);
  for (const replacement of [{ email: 'bad@example.org\nBcc: other@example.org' }, { name: 'One\nTwo' }, { honey: 'bot' }, { reference: 'guess' }, { message: 'x'.repeat(60001) }]) {
    assert.equal((await submit(env, { ...baseApplication, ...replacement })).status, 400);
  }
  assert.equal(env.BTS_DB.connection.prepare('SELECT count(*) AS n FROM applications').get().n, 0);
});
test('all owner application endpoints require verified owner identity', async () => {
  const env = environment(); await submit(env);
  for (const endpoint of [ownerApplications, ownerApplicationSettings, ownerApplicationDecision]) {
    const response = await endpoint({ env, request: await request('/api/owner/applications', { signed: false }) });
    assert.equal(response.status, 401);
    const denied = await endpoint({ env, request: await request('/api/owner/applications', { email: 'other@example.org' }) });
    assert.equal(denied.status, 403);
  }
  const response = await ownerApplications({ env, request: await request('/api/owner/applications') });
  const body = await response.json(); assert.equal(body.applications.length, 1); assert.equal(body.applications[0].email, baseApplication.email);
  assert.equal(body.canSend, true); assert(!JSON.stringify(body).includes('secret-test-only')); assert.equal(response.headers.get('Cache-Control'), 'no-store');
});
test('email templates are private, blank by default, token-validated and revision protected', async () => {
  const env = environment();
  const get = () => ownerApplicationSettings({ env, request: new Request(origin + '/api/owner/application-settings') });
  assert.equal((await get()).status, 401);
  let response = await ownerApplicationSettings({ env, request: await request('/api/owner/application-settings') });
  const initial = await response.json(); assert.equal(initial.revision, 0); assert.equal(initial.templates.accepted.body, '');
  const templates = { accepted: { subject: 'BTS: {{reference}}', body: 'Hello {{name}}, thanks! Reply from {{email}}.' }, rejected: { subject: 'BTS application', body: 'Dear {{name}}, thank you for your interest.' } };
  const put = async expectedRevision => ownerApplicationSettings({ env, request: await request('/api/owner/application-settings', { method: 'PUT', body: { templates, expectedRevision } }) });
  assert.equal((await put(0)).status, 200); assert.equal((await put(0)).status, 409);
  response = await ownerApplicationSettings({ env, request: await request('/api/owner/application-settings') });
  assert.deepEqual((await response.json()).templates, templates);
  assert.throws(() => validateTemplates({ ...templates, accepted: { subject: 'Hi\nBCC: a@b.org', body: 'no' } }));
  assert.throws(() => validateTemplates({ ...templates, accepted: { subject: 'Hi', body: '{{password}}' } }));
});
test('decision requires same-origin, configured email and rendered nonempty messages', async () => {
  const env = environment(); await submit(env); const row = await saved(env);
  const cross = await ownerApplicationDecision({ env, request: await request('/api/owner/applications/decision', { method: 'POST', originHeader: null, body: { id: row.id, decision: 'accepted', subject: 'Hello', body: 'Text' } }) });
  assert.equal(cross.status, 403);
  const missing = { ...env, RESEND_API_KEY: '' }; assert.equal((await decision(missing)).status, 503);
  for (const fields of [{ body: '' }, { body: '{{name}}' }, { subject: 'Hello\nBcc: bad@example.org' }, { decision: 'approved' }]) assert.equal((await decision(env, fields)).status, 400);
  assert.equal((await saved(env)).status, 'pending');
});
test('accept sends reviewed plain text to stored recipient only and prevents repeat decisions', async () => {
  const env = environment(); await submit(env); let calls = 0, sent, headers;
  provider = async (_url, options) => { calls++; sent = JSON.parse(options.body); headers = options.headers; return Response.json({ id: 'provider-email-1' }); };
  const response = await decision(env, { email: 'attacker@example.org', body: 'Hello <script>not HTML</script>.' });
  assert.equal(response.status, 200); assert.equal((await response.json()).emailAccepted, true);
  assert.deepEqual(sent.to, [baseApplication.email]); assert.equal(sent.reply_to, auth.OWNER_EMAIL);
  assert.equal(sent.text, 'Hello <script>not HTML</script>.'); assert(!('html' in sent));
  assert.match(headers['Idempotency-Key'], /^bts-application-.*-accepted$/);
  assert.equal((await saved(env)).status, 'accepted'); assert.equal((await decision(env)).status, 409); assert.equal(calls, 1);
});
test('reject works and concurrent opposite decisions produce only one provider request', async () => {
  const env = environment(); await submit(env); let unblock, calls = 0;
  provider = async () => { calls++; await new Promise(resolve => { unblock = resolve; }); return Response.json({ id: 'provider-email-2' }); };
  const row = await saved(env);
  const input = { id: row.id, decision: 'rejected', subject: 'Application update', body: 'Thank you for applying.' };
  const first = decideApplication(env, input, auth.OWNER_EMAIL);
  while (!unblock) await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(decideApplication(env, { ...input, decision: 'accepted' }, auth.OWNER_EMAIL), error => error.status === 409);
  unblock(); await first; assert.equal(calls, 1); assert.equal((await saved(env)).status, 'rejected');
});
test('known provider rejection leaves a pending record with no false sent state', async () => {
  const env = environment(); await submit(env);
  provider = async () => Response.json({ error: 'unverified sender' }, { status: 422 });
  const response = await decision(env); assert.equal(response.status, 502); assert.equal((await response.json()).code, 'email_rejected');
  const row = await saved(env); assert.equal(row.status, 'pending'); assert.equal(row.decided_at, null); assert(row.last_error);
});
test('network failure, timeout, provider 5xx and invalid ACK block automatic resend as uncertain', async () => {
  const scenarios = [() => { throw new Error('network'); }, () => { throw new DOMException('Timeout', 'AbortError'); }, () => Response.json({}, { status: 503 }), () => Response.json({})];
  for (const scenario of scenarios) {
    const env = environment(); await submit(env); let calls = 0;
    provider = async () => { calls++; return scenario(); };
    const response = await decision(env); assert.equal(response.status, 502); assert.equal((await response.json()).code, 'delivery_uncertain');
    assert.equal((await saved(env)).status, 'delivery_uncertain'); assert.equal((await decision(env)).status, 409); assert.equal(calls, 1);
  }
});
test('new schema limits reject unsupported controls and invalid decisions', () => {
  assert.throws(() => validateApplication({ ...baseApplication, name: 'A\0B' }));
  assert.throws(() => validateDecision({ id: 'invalid', decision: 'accepted', subject: 's', body: 'b' }));
});
