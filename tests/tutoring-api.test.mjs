import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { clearCertificateCache } from '../server/auth.js';
import { ADMISSIONS_MAILBOX, GmailSendError, composeGmailMessage } from '../server/gmail-mailer.js';
import { publicTutoring, ownerTutoring } from '../server/tutoring-api.js';
import { validateTutoring, saveTutoring, listTutoring } from '../server/tutoring-store.js';

const origin = 'https://breakingthesky.com';
const issuer = 'https://tutoring-test.cloudflareaccess.com';
const auth = { CF_ACCESS_TEAM_DOMAIN: 'tutoring-test.cloudflareaccess.com', CF_ACCESS_AUD: 'owner-app', OWNER_EMAILS: 'ammarashary@gmail.com,breakingtheskyadmissions@gmail.com' };
const schema = await readFile(new URL('../migrations/0006_tutoring_requests.sql', import.meta.url), 'utf8');
const payload = {
  reference: 'BTS-TUTOR-11111111-2222-4333-8444-555555555555', name: 'Sample Contact', email: 'contact@example.org',
  relationship: 'Parent or guardian', grade: 'Grades 6–8', subjects: 'Algebra and biology', needs: 'Review equations.\nHelp reading biology diagrams.',
  format: 'Either', city: 'Example town', availability: 'Weekends', consent: true, honey: ''
};
const originalFetch = globalThis.fetch;
let privateKey, jwk;
const b64 = value => Buffer.from(value).toString('base64url');
async function token(email = 'ammarashary@gmail.com') {
  const now = Math.floor(Date.now() / 1000);
  const text = [b64(JSON.stringify({ alg: 'RS256', kid: 'tutoring-key' })), b64(JSON.stringify({ iss: issuer, aud: ['owner-app'], sub: 'owner-sub', email, iat: now - 5, exp: now + 600 }))].join('.');
  return text + '.' + b64(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(text)));
}
function database({ migrated = true } = {}) {
  const connection = new DatabaseSync(':memory:'); if (migrated) connection.exec(schema);
  return { connection, prepare(sql) {
    const statement = connection.prepare(sql); let args = [];
    return {
      bind(...values) { args = values; return this; },
      async first() { return statement.get(...args) || null; },
      async all() { return { success: true, results: statement.all(...args) }; },
      async run() { return { success: true, meta: { changes: Number(statement.run(...args).changes) } }; }
    };
  } };
}
function environment(db = database()) { return { ...auth, BTS_DB: db, BTS_TUTORING_ENABLED: 'true' }; }
function gmailEnvironment() { return { ...environment(), ADMISSIONS_EMAIL: ADMISSIONS_MAILBOX, GMAIL_APP_PASSWORD: 'abcdefghijklmnop' }; }
async function request(path = '/api/tutoring', { method = 'GET', body, signed = false, email, requestOrigin = origin, contentType = 'application/json', headers = {} } = {}) {
  const nextHeaders = { ...headers };
  if (signed) nextHeaders['Cf-Access-Jwt-Assertion'] = await token(email);
  if (body !== undefined) { if (contentType) nextHeaders['Content-Type'] = contentType; if (requestOrigin !== null) nextHeaders.Origin = requestOrigin; }
  return new Request(origin + path, { method, headers: nextHeaders, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) });
}
async function submit(env, body = payload, options = {}) { return publicTutoring({ env, request: await request('/api/tutoring', { method: 'POST', body, ...options }) }); }
async function stored(env) { return env.BTS_DB.prepare('SELECT * FROM tutoring_requests').first(); }
before(async () => {
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  privateKey = pair.privateKey; jwk = { ...await crypto.subtle.exportKey('jwk', pair.publicKey), kid: 'tutoring-key', alg: 'RS256', use: 'sig' };
  globalThis.fetch = async url => {
    if (url === issuer + '/cdn-cgi/access/certs') return Response.json({ keys: [jwk] });
    throw new Error('Unexpected external request; tutoring tests never send email');
  };
});
beforeEach(() => clearCertificateCache());
after(() => { globalThis.fetch = originalFetch; clearCertificateCache(); });

test('tutoring discovery stays disabled until explicitly enabled with migrated D1 storage', async () => {
  for (const env of [{}, { BTS_DB: database() }, { BTS_TUTORING_ENABLED: 'true' }, { BTS_TUTORING_ENABLED: true, BTS_DB: database() }, environment(database({ migrated: false }))]) {
    const response = await publicTutoring({ env, request: await request() });
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), { enabled: false });
    const submission = await submit(env); assert.equal(submission.status, 503); assert.equal((await submission.json()).code, 'tutoring_not_configured');
  }
});
test('required fields, supported enums, consent and request references are validated', () => {
  const valid = validateTutoring({ ...payload, city: undefined, availability: undefined });
  assert.equal(valid.city, ''); assert.equal(valid.availability, ''); assert.equal(valid.consent, true);
  for (const changes of [{ name: ' ' }, { email: 'not-an-email' }, { email: 'contact@example.org\r\nBcc:other@example.org' }, { email: 'bad..local@example.org' }, { email: 'unicodeé@example.org' }, { relationship: 'Sibling' }, { grade: 'Grades 6-8' }, { format: 'Virtual' }, { subjects: '' }, { needs: '\n  ' }, { consent: false }, { consent: 'true' }, { honey: 'bot' }, { reference: payload.reference.toLowerCase() }, { reference: 'BTS-TUTOR-random' }, { recipient: 'other@example.org' }]) {
    assert.throws(() => validateTutoring({ ...payload, ...changes }), error => error.code === 'invalid_tutoring');
  }
  for (const [field, maximum] of [['name', 100], ['subjects', 120], ['needs', 500], ['city', 80], ['availability', 120]]) {
    assert.equal(validateTutoring({ ...payload, [field]: 'x'.repeat(maximum) })[field].length, maximum);
    assert.throws(() => validateTutoring({ ...payload, [field]: 'x'.repeat(maximum + 1) }));
  }
  for (const field of ['name', 'subjects', 'city', 'availability']) assert.throws(() => validateTutoring({ ...payload, [field]: 'line one\nline two' }));
});
test('intake requires same-origin JSON and enforces the 16KB body limit before writing', async () => {
  const env = environment();
  for (const options of [{ requestOrigin: null }, { requestOrigin: 'https://other.example.org' }, { headers: { 'Sec-Fetch-Site': 'cross-site' } }]) assert.equal((await submit(env, payload, options)).status, 403);
  assert.equal((await submit(env, payload, { contentType: 'text/plain' })).status, 415);
  assert.equal((await submit(env, '{')).status, 400);
  assert.equal((await submit(env, { ...payload, padding: 'x'.repeat(16384) })).status, 413);
  assert.equal((await submit(env, { ...payload, consent: false })).status, 400);
  assert.equal(env.BTS_DB.connection.prepare('SELECT count(*) AS n FROM tutoring_requests').get().n, 0);
});
test('identical references are idempotent and changed answers cannot overwrite a saved request', async () => {
  const env = environment();
  for (let index = 0; index < 2; index++) {
    const response = await submit(env); assert.equal(response.status, 200); assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(await response.json(), { success: true, reference: payload.reference });
  }
  const conflicting = await submit(env, { ...payload, needs: 'Different details' });
  assert.equal(conflicting.status, 409); assert.equal((await conflicting.json()).code, 'tutoring_reference_conflict');
  assert.equal(env.BTS_DB.connection.prepare('SELECT count(*) AS n FROM tutoring_requests').get().n, 1);
  const row = await stored(env); assert.equal(row.needs, payload.needs); assert.equal(row.notification_status, 'pending'); assert.equal(row.status, 'new'); assert.equal(row.consent, 1);
});
test('request storage and notification pending state are atomic', async () => {
  const env = environment();
  env.BTS_DB.connection.exec("CREATE TRIGGER reject_request BEFORE INSERT ON tutoring_requests BEGIN SELECT RAISE(FAIL, 'mock storage failure'); END;");
  const response = await submit(env); assert.equal(response.status, 503);
  assert.equal(env.BTS_DB.connection.prepare('SELECT count(*) AS n FROM tutoring_requests').get().n, 0);
  env.BTS_DB.connection.exec('DROP TRIGGER reject_request');
  await saveTutoring(env, payload);
  const row = await stored(env); assert.equal(row.notification_status, 'pending'); assert(row.notification_updated_at);
});
test('a lost post-save acknowledgement can be retried with the same payload without duplicates', async () => {
  const env = environment(); const originalPrepare = env.BTS_DB.prepare; let fail = true;
  env.BTS_DB.prepare = sql => {
    const statement = originalPrepare(sql);
    if (sql === 'SELECT id, payload_hash FROM tutoring_requests WHERE reference = ?') {
      const first = statement.first.bind(statement);
      statement.first = async () => { if (fail) { fail = false; throw new Error('Mock connection lost'); } return first(); };
    }
    return statement;
  };
  assert.equal((await submit(env)).status, 503);
  assert.equal((await submit(env)).status, 200);
  assert.equal(env.BTS_DB.connection.prepare('SELECT count(*) AS n FROM tutoring_requests').get().n, 1);
});
test('public responses never disclose request details and owner inbox requires a signed allowed owner', async () => {
  const env = environment(); await submit(env);
  const publicResponse = await publicTutoring({ env, request: await request() });
  assert.deepEqual(await publicResponse.json(), { enabled: true });
  const unsigned = await ownerTutoring({ env, request: await request('/api/owner/tutoring', { headers: { 'Cf-Access-Authenticated-User-Email': 'ammarashary@gmail.com' } }) });
  assert.equal(unsigned.status, 401);
  const other = await ownerTutoring({ env, request: await request('/api/owner/tutoring', { signed: true, email: 'other@example.org' }) }); assert.equal(other.status, 403);
  for (const email of ['ammarashary@gmail.com', ADMISSIONS_MAILBOX]) {
    const response = await ownerTutoring({ env, request: await request('/api/owner/tutoring', { signed: true, email }) });
    assert.equal(response.status, 200); assert.equal(response.headers.get('Cache-Control'), 'no-store');
    const data = await response.json(); assert.equal(data.limit, 100); assert.equal(data.requests.length, 1);
    assert.equal(data.requests[0].email, payload.email); assert.equal(data.requests[0].needs, payload.needs); assert.equal(data.requests[0].notificationStatus, 'pending');
    assert(!JSON.stringify(data).includes('payload_hash')); assert(!JSON.stringify(data).includes('GMAIL_APP_PASSWORD'));
  }
});
test('notifications use only the fixed tutoring inbox with contact Reply-To and valid admissions-sender MIME', async () => {
  const env = gmailEnvironment(); let sent, calls = 0;
  const gmailMailer = async (_env, message) => { calls++; sent = message; return { accepted: true, messageId: message.messageId }; };
  await saveTutoring(env, payload, { gmailMailer }); await saveTutoring(env, payload, { gmailMailer });
  assert.equal(calls, 1); assert.equal(sent.to, 'ammarashary@gmail.com'); assert.equal(sent.replyTo, payload.email);
  assert(sent.body.includes(payload.needs)); assert(sent.body.includes(payload.reference));
  assert.match(sent.messageId, /^<bts-notification-tutoring-[a-f0-9-]+@breakingthesky\.local>$/);
  const mime = composeGmailMessage(sent); assert(mime.includes(`From: Breaking the Sky <${ADMISSIONS_MAILBOX}>`)); assert(mime.includes('To: <ammarashary@gmail.com>'));
  const row = await stored(env); assert.equal(row.notification_status, 'sent'); assert(row.notification_sent_at);
  await assert.rejects(saveTutoring(env, { ...payload, recipient: 'other@example.org' }, { gmailMailer }), error => error.code === 'invalid_tutoring');
  assert.equal(calls, 1);
});
test('concurrent identical requests can claim only one notification send', async () => {
  const env = gmailEnvironment(); let calls = 0, release;
  const gmailMailer = async () => { calls++; await new Promise(resolve => { release = resolve; }); return { accepted: true }; };
  const first = saveTutoring(env, payload, { gmailMailer });
  while (!release) await new Promise(resolve => setImmediate(resolve));
  assert.equal((await saveTutoring(env, payload, { gmailMailer })).success, true);
  release(); await first;
  assert.equal(calls, 1); assert.equal((await stored(env)).notification_status, 'sent');
});
test('background delivery failure leaves the accepted request intact and never automatically retries an uncertain send', async () => {
  for (const uncertain of [false, true]) {
    const env = gmailEnvironment(); const tasks = []; let calls = 0;
    const gmailMailer = async () => { calls++; throw new GmailSendError('Mock failure', { uncertain }); };
    const result = await saveTutoring(env, payload, { gmailMailer, waitUntil(task) { tasks.push(task); } });
    assert.deepEqual(result, { success: true, reference: payload.reference }); await Promise.all(tasks);
    const row = await stored(env); assert.equal(row.status, 'new'); assert.equal(row.notification_status, uncertain ? 'delivery_uncertain' : 'failed'); assert.equal(row.notification_sent_at, null);
    await saveTutoring(env, payload, { gmailMailer }); assert.equal(calls, 1);
  }
});
test('no Gmail setup still accepts requests and unavailable owner storage does not invent an empty inbox', async () => {
  const env = environment(); let called = false;
  assert.equal((await saveTutoring(env, payload, { gmailMailer() { called = true; throw new Error('Must not send'); } })).success, true);
  assert.equal(called, false); assert.equal((await stored(env)).notification_status, 'pending');
  await assert.rejects(listTutoring(environment(database({ migrated: false }))), error => error.code === 'tutoring_unavailable');
});
