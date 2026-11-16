import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ADMISSIONS_MAILBOX, GmailSendError, gmailConfigured, composeGmailMessage, sendGmail } from '../server/gmail-mailer.js';

const env = { ADMISSIONS_EMAIL: ADMISSIONS_MAILBOX, GMAIL_APP_PASSWORD: 'abcd efgh ijkl mnop' };
const message = { to: 'applicant@example.org', replyTo: ADMISSIONS_MAILBOX, subject: 'A BTS application update', body: 'Hello!\nThank you for applying.', messageId: '<bts-decision-11111111-2222-4333-8444-555555555555-accepted@breakingthesky.local>' };
const encoder = new TextEncoder();

function smtp({ fragment = false, responses = {}, failWrite, stall, greeting = '220 smtp.gmail.com ready\r\n' } = {}) {
  const writes = []; let controller, closed = false, closeCount = 0, address, options;
  const replies = {
    1: '250-smtp.gmail.com\r\n250-AUTH LOGIN PLAIN\r\n250 SIZE 35882577\r\n',
    2: '334 VXNlcm5hbWU6\r\n', 3: '334 UGFzc3dvcmQ6\r\n', 4: '235 2.7.0 Authenticated\r\n',
    5: '250 2.1.0 OK\r\n', 6: '250 2.1.5 OK\r\n', 7: '354 Go ahead\r\n', 9: '250 2.0.0 accepted\r\n', ...responses
  };
  function push(value) {
    if (!value || closed) return;
    const data = encoder.encode(value);
    if (fragment) for (const byte of data) controller.enqueue(new Uint8Array([byte]));
    else controller.enqueue(data);
  }
  const readable = new ReadableStream({ start(value) { controller = value; push(greeting); }, cancel() { closed = true; } });
  const writable = new WritableStream({ write(value) {
    writes.push(new TextDecoder().decode(value)); const stage = writes.length;
    if (stage === failWrite) throw new Error('Mock socket write failed');
    if (stage !== stall) push(replies[stage]);
  } });
  return {
    writes,
    get closed() { return closed; },
    get closeCount() { return closeCount; },
    get address() { return address; }, get options() { return options; },
    connect(target, configuration) {
      address = target; options = configuration;
      return { readable, writable, opened: Promise.resolve(), closed: Promise.resolve(), close() { closeCount++; if (!closed) { closed = true; try { controller.close(); } catch {} } return Promise.resolve(); } };
    }
  };
}

test('Gmail configuration is restricted to the admissions account and an App Password', () => {
  assert.equal(gmailConfigured(env), true);
  for (const changed of [{ ADMISSIONS_EMAIL: 'someone@gmail.com' }, { GMAIL_APP_PASSWORD: '' }, { GMAIL_APP_PASSWORD: 'not-an-app-password' }, { GMAIL_APP_PASSWORD: 'abcd\nefghijklmnop' }]) assert.equal(gmailConfigured({ ...env, ...changed }), false);
});
test('MIME keeps fixed sender, safely folds Unicode subject, and base64-encodes plain text', () => {
  const unicode = { ...message, subject: 'An update — ' + '数学 '.repeat(40), body: 'Hi Zoë,\n.\n<script>Plain text only</script>\nΚαλημέρα' };
  const mime = composeGmailMessage(unicode);
  const [headers, body] = mime.split('\r\n\r\n');
  assert(headers.includes(`From: Breaking the Sky <${ADMISSIONS_MAILBOX}>`));
  assert(headers.includes(`Reply-To: <${ADMISSIONS_MAILBOX}>`));
  const subject = headers.match(/Subject: ([\s\S]*?)\r\nDate:/)[1];
  const decoded = [...subject.matchAll(/=\?UTF-8\?B\?([^?]+)\?=/g)].map(match => Buffer.from(match[1], 'base64').toString('utf8')).join('');
  assert.equal(decoded, unicode.subject);
  for (const line of subject.split('\r\n')) assert(line.length < 78);
  for (const line of body.trim().split('\r\n')) assert(line.length <= 76);
  assert.equal(Buffer.from(body.replace(/\s/g, ''), 'base64').toString('utf8'), unicode.body.replace(/\n/g, '\r\n'));
  assert(!mime.includes('\r\n.\r\n'));
});
test('header injection and invalid message IDs are rejected before any connection', async () => {
  for (const changed of [{ to: 'one@example.org\r\nRCPT TO:<two@example.org>' }, { replyTo: 'one@example.org\nBcc: two@example.org' }, { subject: 'Hi\r\nBcc: two@example.org' }, { messageId: '<bad\r\nBCC: x>' }]) {
    let called = false;
    await assert.rejects(sendGmail(env, { ...message, ...changed }, { connect() { called = true; throw new Error('Must not connect'); } }), error => error instanceof GmailSendError && !error.uncertain);
    assert.equal(called, false);
  }
});
test('SMTP uses implicit TLS on fixed Gmail port, handles split multiline replies, and requires final 250', async () => {
  const fake = smtp({ fragment: true });
  const result = await sendGmail(env, message, { connect: fake.connect });
  assert.deepEqual(result, { accepted: true, messageId: message.messageId });
  assert.deepEqual(fake.address, { hostname: 'smtp.gmail.com', port: 465 });
  assert.deepEqual(fake.options, { secureTransport: 'on', allowHalfOpen: false });
  assert.equal(fake.writes[0], 'EHLO bts.local\r\n'); assert.equal(fake.writes[1], 'AUTH LOGIN\r\n');
  assert.equal(Buffer.from(fake.writes[2].trim(), 'base64').toString(), ADMISSIONS_MAILBOX);
  assert.equal(Buffer.from(fake.writes[3].trim(), 'base64').toString(), 'abcdefghijklmnop');
  assert.equal(fake.writes[4], `MAIL FROM:<${ADMISSIONS_MAILBOX}>\r\n`);
  assert.equal(fake.writes[5], 'RCPT TO:<applicant@example.org>\r\n');
  assert.equal(fake.writes[6], 'DATA\r\n'); assert.equal(fake.writes[8], '.\r\n');
  assert.equal(fake.closed, true); assert(fake.closeCount >= 1);
});
test('authentication, recipient and explicit final DATA rejection are definite failures', async () => {
  for (const stage of [4, 6, 9]) {
    const fake = smtp({ responses: { [stage]: '535 5.7.8 Raw sensitive server response\r\n' } });
    await assert.rejects(sendGmail(env, message, { connect: fake.connect }), error => {
      assert(!error.message.includes('Raw sensitive')); assert(!error.message.includes('abcdefghijklmnop'));
      return error instanceof GmailSendError && !error.uncertain && error.code === 'gmail_rejected';
    });
    assert.equal(fake.closed, true);
  }
});
test('write failure before the final dot is retryable; failure after dot attempt is uncertain', async () => {
  for (const [stage, uncertain] of [[8, false], [9, true]]) {
    const fake = smtp({ failWrite: stage });
    await assert.rejects(sendGmail(env, message, { connect: fake.connect }), error => error instanceof GmailSendError && error.uncertain === uncertain);
    assert.equal(fake.closed, true);
  }
});
test('timeouts close the socket and distinguish pre-DATA failure from unknown final acceptance', async () => {
  for (const [stage, uncertain] of [[1, false], [9, true]]) {
    const fake = smtp({ stall: stage });
    await assert.rejects(sendGmail(env, message, { connect: fake.connect, timeoutMs: 15 }), error => error instanceof GmailSendError && error.code === 'gmail_timeout' && error.uncertain === uncertain);
    assert.equal(fake.closed, true);
  }
});
test('invalid and oversized SMTP replies fail closed without exposing raw content', async () => {
  for (const config of [{ greeting: '220 ' + 'x'.repeat(5000) + '\r\n' }, { responses: { 1: '250-first\r\n251 mismatched\r\n' } }, { responses: { 9: 'malformed-final-reply\r\n' } }]) {
    const fake = smtp(config);
    await assert.rejects(sendGmail(env, message, { connect: fake.connect }), error => error instanceof GmailSendError && error.uncertain === Boolean(config.responses?.[9]));
    assert.equal(fake.closed, true);
  }
});
