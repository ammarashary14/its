import { HttpError } from './http.js';
import { GmailSendError, gmailConfigured, sendGmail } from './gmail-mailer.js';

const TUTORING_RECIPIENT = 'ammarashary@gmail.com';
const FIELDS = new Set(['reference', 'name', 'email', 'relationship', 'grade', 'subjects', 'needs', 'format', 'city', 'availability', 'consent', 'honey']);
const RELATIONSHIPS = ['Student', 'Parent or guardian', 'Educator'];
const GRADES = ['Grades K–2', 'Grades 3–5', 'Grades 6–8', 'Grades 9–12', 'Other'];
const FORMATS = ['Online', 'In person', 'Either'];
const EMAIL = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;
const encoder = new TextEncoder();

function invalid(message) { return new HttpError(400, 'invalid_tutoring', message); }
function text(value, label, maximum, { optional = false, multiline = false } = {}) {
  if (value === undefined && optional) return '';
  if (typeof value !== 'string' || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value) || (!multiline && /[\r\n]/.test(value))) throw invalid(`${label} must be valid text.`);
  const result = value.trim();
  if ((!optional && !result) || result.length > maximum) throw invalid(`${label} must contain ${optional ? 'no more than' : 'between 1 and'} ${maximum} characters.`);
  return result;
}
function choice(value, allowed, label) {
  if (!allowed.includes(value)) throw invalid(`Choose a valid ${label}.`);
  return value;
}
function email(value) {
  const result = text(value, 'Email address', 254);
  const [local, domain] = result.split('@');
  if (!EMAIL.test(result) || local.length > 64 || local.startsWith('.') || local.endsWith('.') || local.includes('..') || domain.split('.').some(label => label.length > 63)) throw invalid('Enter a valid email address.');
  return result;
}
export function validateTutoring(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid('Send the tutoring request as an object.');
  if (Object.keys(value).some(key => !FIELDS.has(key))) throw invalid('The tutoring request contains an unsupported field.');
  if (value.honey !== undefined && value.honey !== '') throw invalid('This tutoring request could not be submitted.');
  if (value.consent !== true) throw invalid('Please agree that BTS may contact you about this tutoring request.');
  const reference = text(value.reference, 'Request reference', 46);
  if (!/^BTS-TUTOR-[0-9A-F]{8}(?:-[0-9A-F]{4}){3}-[0-9A-F]{12}$/.test(reference)) throw invalid('Refresh the tutoring form to create a valid request reference.');
  return {
    reference, name: text(value.name, 'Name', 100), email: email(value.email),
    relationship: choice(value.relationship, RELATIONSHIPS, 'relationship'), grade: choice(value.grade, GRADES, 'grade level'),
    subjects: text(value.subjects, 'Subjects', 120), needs: text(value.needs, 'Learning goals', 500, { multiline: true }),
    format: choice(value.format, FORMATS, 'format'), city: text(value.city, 'City or area', 80, { optional: true }),
    availability: text(value.availability, 'Availability', 120, { optional: true }), consent: true
  };
}
function database(env) {
  if (typeof env.BTS_DB?.prepare !== 'function') throw new HttpError(503, 'tutoring_not_configured', 'The tutoring inbox will be available after storage is connected.');
  return env.BTS_DB;
}
function unavailable() { return new HttpError(503, 'tutoring_unavailable', 'The tutoring request could not be confirmed. Keep your request reference and try again or contact BTS.'); }
export async function tutoringEnabled(env) {
  if (env.BTS_TUTORING_ENABLED !== 'true' || typeof env.BTS_DB?.prepare !== 'function') return false;
  try { await env.BTS_DB.prepare('SELECT id, payload_hash, notification_status FROM tutoring_requests LIMIT 1').first(); return true; }
  catch { return false; }
}
export async function saveTutoring(env, raw, { waitUntil, gmailMailer = sendGmail } = {}) {
  if (!await tutoringEnabled(env)) throw new HttpError(503, 'tutoring_not_configured', 'Direct tutoring requests are not available yet. Please contact BTS by email.');
  const value = validateTutoring(raw);
  const payloadHash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(JSON.stringify(value))))].map(byte => byte.toString(16).padStart(2, '0')).join('');
  const db = database(env), now = new Date().toISOString();
  let saved;
  try {
    // Request and pending notification share one row, so there is no interval
    // where an accepted request exists without a durable notification record.
    const result = await db.prepare('INSERT INTO tutoring_requests (id, reference, payload_hash, name, email, relationship, grade, subjects, needs, format, city, availability, consent, created_at, notification_status, notification_updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?) ON CONFLICT(reference) DO NOTHING').bind(
      crypto.randomUUID(), value.reference, payloadHash, value.name, value.email, value.relationship, value.grade, value.subjects, value.needs, value.format, value.city, value.availability, now, 'pending', now
    ).run();
    if (result?.success !== true) throw new Error('Request write failed');
    saved = await db.prepare('SELECT id, payload_hash FROM tutoring_requests WHERE reference = ?').bind(value.reference).first();
  } catch { throw unavailable(); }
  if (!saved) throw unavailable();
  if (saved.payload_hash !== payloadHash) throw new HttpError(409, 'tutoring_reference_conflict', 'This reference was already submitted with different details. Contact BTS with the reference before submitting again.');
  const delivery = async () => {
    try { await notifyTutoring(env, saved.id, { gmailMailer }); }
    catch { /* The request remains accepted in the private inbox if notification delivery fails. */ }
  };
  if (typeof waitUntil === 'function') {
    const task = delivery();
    try { waitUntil(task); } catch { await task; }
  } else await delivery();
  return { success: true, reference: value.reference };
}
function ownerRequest(row) {
  return {
    id: row.id, reference: row.reference, name: row.name, email: row.email, relationship: row.relationship,
    grade: row.grade, subjects: row.subjects, needs: row.needs, format: row.format, city: row.city,
    availability: row.availability, status: row.status, createdAt: row.created_at, notificationStatus: row.notification_status
  };
}
export async function listTutoring(env) {
  try {
    const result = await database(env).prepare('SELECT id, reference, name, email, relationship, grade, subjects, needs, format, city, availability, status, created_at, notification_status FROM tutoring_requests ORDER BY created_at DESC, id DESC LIMIT 100').all();
    if (result?.success !== true || !Array.isArray(result.results)) throw new Error('Request read failed');
    return result.results.map(ownerRequest);
  } catch (error) { if (error instanceof HttpError) throw error; throw unavailable(); }
}
async function updateNotification(db, id, status, error = null) {
  const now = new Date().toISOString();
  const result = await db.prepare('UPDATE tutoring_requests SET notification_status = ?, notification_error = ?, notification_updated_at = ?, notification_sent_at = ? WHERE id = ? AND notification_status = ?').bind(status, error, now, status === 'sent' ? now : null, id, 'sending').run();
  if (result?.success !== true || result?.meta?.changes !== 1) throw new Error('Notification state update failed');
}
export async function notifyTutoring(env, id, { gmailMailer = sendGmail } = {}) {
  if (!gmailConfigured(env)) return;
  const db = database(env);
  const row = await db.prepare('SELECT * FROM tutoring_requests WHERE id = ?').bind(id).first();
  if (!row || row.notification_status !== 'pending') return;
  const messageId = `<bts-notification-tutoring-${row.id}@breakingthesky.local>`;
  const lock = await db.prepare('UPDATE tutoring_requests SET notification_status = ?, notification_message_id = ?, notification_error = NULL, notification_updated_at = ? WHERE id = ? AND notification_status = ?').bind('sending', messageId, new Date().toISOString(), id, 'pending').run();
  if (lock?.success !== true || lock?.meta?.changes !== 1) return;
  let emailAccepted = false;
  try {
    const result = await gmailMailer(env, {
      to: TUTORING_RECIPIENT, replyTo: row.email,
      subject: `New BTS tutoring request — ${row.reference}`,
      body: [
        'A new tutoring request is saved in the BTS owner dashboard.', '',
        `Reference: ${row.reference}`, `Contact name: ${row.name}`, `Contact email: ${row.email}`, `Relationship: ${row.relationship}`,
        `Grade level: ${row.grade}`, `Subjects: ${row.subjects}`, `Learning goals: ${row.needs}`, `Preferred format: ${row.format}`,
        `City or area: ${row.city || 'Not provided'}`, `Availability: ${row.availability || 'Not provided'}`, 'Permission to contact: Yes'
      ].join('\n'),
      messageId
    });
    if (result?.accepted !== true) throw new GmailSendError('Gmail acceptance was not confirmed.', { uncertain: true });
    emailAccepted = true;
    await updateNotification(db, id, 'sent');
  } catch (error) {
    const definiteFailure = !emailAccepted && error instanceof GmailSendError && !error.uncertain;
    try {
      await updateNotification(db, id, definiteFailure ? 'failed' : 'delivery_uncertain', definiteFailure
        ? 'The tutoring notification was not accepted. The request is saved in the dashboard; check the Gmail setup before any resend.'
        : 'Notification delivery could not be confirmed. Check Gmail before any resend. The request remains saved in the dashboard.');
    } catch { /* Leave the sending lock intact if storage cannot record the result. */ }
  }
}
