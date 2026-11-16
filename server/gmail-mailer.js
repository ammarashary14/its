export const ADMISSIONS_MAILBOX = 'breakingtheskyadmissions@gmail.com';
const encoder = new TextEncoder();
const MAILBOX = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;

export class GmailSendError extends Error {
  constructor(message, { uncertain = false, code = 'gmail_send_failed' } = {}) {
    super(message); this.name = 'GmailSendError'; this.uncertain = uncertain; this.code = code;
  }
}
function password(env) {
  return typeof env.GMAIL_APP_PASSWORD === 'string' ? env.GMAIL_APP_PASSWORD.replace(/ /g, '') : '';
}
export function gmailConfigured(env) {
  return typeof env.ADMISSIONS_EMAIL === 'string' && env.ADMISSIONS_EMAIL.trim().toLowerCase() === ADMISSIONS_MAILBOX && /^[A-Za-z0-9]{16}$/.test(password(env));
}
function mailbox(value) {
  if (typeof value !== 'string' || value.length > 254 || value.split('@')[0].length > 64 || !MAILBOX.test(value)) {
    throw new GmailSendError('Use a valid email address.', { code: 'invalid_email_message' });
  }
  return value;
}
function base64(value) {
  const bytes = encoder.encode(value); let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}
function encodedSubject(subject) {
  const parts = []; let part = '', length = 0;
  for (const point of subject) {
    const size = encoder.encode(point).length;
    if (length + size > 42) { parts.push(part); part = ''; length = 0; }
    part += point; length += size;
  }
  if (part) parts.push(part);
  return parts.map(value => `=?UTF-8?B?${base64(value)}?=`).join('\r\n ');
}
export function composeGmailMessage({ to, replyTo = ADMISSIONS_MAILBOX, subject, body, messageId }) {
  mailbox(to); mailbox(replyTo);
  if (typeof subject !== 'string' || !subject.trim() || subject.length > 200 || /[\x00-\x1f\x7f]/.test(subject)) throw new GmailSendError('Use a single-line email subject of up to 200 characters.', { code: 'invalid_email_message' });
  if (typeof body !== 'string' || !body.trim() || body.length > 65000 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(body)) throw new GmailSendError('The email message is invalid or too long.', { code: 'invalid_email_message' });
  if (typeof messageId !== 'string' || !/^<bts-(?:notification|decision)-[a-z0-9-]{1,110}@breakingthesky\.local>$/i.test(messageId)) throw new GmailSendError('The email tracking reference is invalid.', { code: 'invalid_email_message' });
  const encodedBody = base64(body.replace(/\r?\n/g, '\r\n')).match(/.{1,76}/g).join('\r\n');
  return [
    `From: Breaking the Sky <${ADMISSIONS_MAILBOX}>`, `To: <${to}>`, `Reply-To: <${replyTo}>`,
    `Subject: ${encodedSubject(subject)}`, `Date: ${new Date().toUTCString()}`, `Message-ID: ${messageId}`,
    'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', encodedBody, ''
  ].join('\r\n');
}

/** SMTP runs only inside a request. The injected connector is exclusively for protocol tests. */
export async function sendGmail(env, message, { connect: injectedConnect, timeoutMs = 15000 } = {}) {
  if (!gmailConfigured(env)) throw new GmailSendError('Connect the admissions Gmail account with an App Password before sending.', { code: 'gmail_not_configured' });
  const mime = composeGmailMessage(message);
  let socket, reader, writer, timer;
  let finalDotAttempted = false, accepted = false, stopped = false;
  let buffer = '', totalBytes = 0;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  function error(messageText, code = 'gmail_send_failed') {
    return new GmailSendError(messageText, { uncertain: finalDotAttempted && !accepted, code });
  }
  function close() {
    stopped = true;
    try { Promise.resolve(socket?.close()).catch(() => {}); } catch {}
    try { Promise.resolve(reader?.cancel()).catch(() => {}); } catch {}
    try { Promise.resolve(writer?.abort()).catch(() => {}); } catch {}
  }
  async function line() {
    while (true) {
      if (stopped) throw error('The Gmail connection was closed.');
      const end = buffer.indexOf('\r\n');
      if (end >= 0) {
        if (end > 4096) throw error('Gmail returned an invalid response.');
        const value = buffer.slice(0, end); buffer = buffer.slice(end + 2); return value;
      }
      if (buffer.length > 4096) throw error('Gmail returned an invalid response.');
      const chunk = await reader.read();
      if (chunk.done) throw error('Gmail closed the connection before confirming the message.');
      totalBytes += chunk.value.byteLength;
      if (chunk.value.byteLength > 32768 || totalBytes > 65536) throw error('Gmail returned an invalid response.');
      buffer += decoder.decode(chunk.value, { stream: true });
    }
  }
  async function reply() {
    let expected;
    for (let index = 0; index < 50; index++) {
      const value = await line();
      const match = /^(\d{3})([ -])[^\r\n]*$/.exec(value);
      if (!match || (expected && expected !== match[1])) throw error('Gmail returned an invalid response.');
      expected = match[1];
      if (match[2] === ' ') return Number(expected);
    }
    throw error('Gmail returned an invalid response.');
  }
  async function expect(codes) {
    const code = await reply();
    if (codes.includes(code)) return;
    if (code >= 400 && code < 600) throw new GmailSendError('Gmail rejected the message or sign-in. Check the admissions email configuration.', { code: 'gmail_rejected' });
    throw error('Gmail returned an unexpected response.');
  }
  async function write(value) {
    if (stopped) throw error('The Gmail connection was closed.');
    await writer.write(encoder.encode(value));
  }
  async function command(value, codes) { await write(value + '\r\n'); await expect(codes); }
  const session = async () => {
    const connect = injectedConnect || (await import('cloudflare:sockets')).connect;
    if (stopped) throw error('The Gmail connection was closed.');
    socket = connect({ hostname: 'smtp.gmail.com', port: 465 }, { secureTransport: 'on', allowHalfOpen: false });
    // A rejected closed promise is otherwise unhandled when the SMTP exchange fails.
    Promise.resolve(socket.closed).catch(() => {});
    reader = socket.readable.getReader(); writer = socket.writable.getWriter();
    if (socket.opened) await socket.opened;
    await expect([220]);
    await command('EHLO bts.local', [250]);
    await command('AUTH LOGIN', [334]);
    await command(base64(ADMISSIONS_MAILBOX), [334]);
    await command(base64(password(env)), [235]);
    await command(`MAIL FROM:<${ADMISSIONS_MAILBOX}>`, [250]);
    await command(`RCPT TO:<${message.to}>`, [250, 251]);
    await command('DATA', [354]);
    await write(mime);
    // SMTP cannot accept the message before this terminator. Once attempted,
    // a broken connection can no longer prove that Gmail did not accept it.
    finalDotAttempted = true;
    await write('.\r\n');
    await expect([250]);
    accepted = true;
    return { accepted: true, messageId: message.messageId };
  };
  try {
    return await Promise.race([
      session(),
      new Promise((_, reject) => { timer = setTimeout(() => { const timeout = error('Gmail did not confirm the message in time.', 'gmail_timeout'); close(); reject(timeout); }, timeoutMs); })
    ]);
  } catch (cause) {
    if (accepted) return { accepted: true, messageId: message.messageId };
    if (cause instanceof GmailSendError) throw cause;
    throw error('The Gmail connection could not complete the send.');
  } finally {
    clearTimeout(timer); close();
    try { reader?.releaseLock(); } catch {}
    try { writer?.releaseLock(); } catch {}
  }
}
