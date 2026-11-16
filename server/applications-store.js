import { HttpError } from './http.js';

export const DEFAULT_TEMPLATES = Object.freeze({
  accepted: Object.freeze({ subject: 'Your BTS volunteer application', body: '' }),
  rejected: Object.freeze({ subject: 'Your BTS volunteer application', body: '' })
});
const encoder = new TextEncoder();
const EMAIL = /^[^\s@<>()"\\]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;

function invalid(message) { return new HttpError(400, 'invalid_application', message); }
function object(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid('Send the application as an object.');
  return value;
}
function text(value, maximum, label, { optional = false, oneLine = false } = {}) {
  if (typeof value !== 'string') throw invalid(`${label} must be text.`);
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value) || (oneLine && /[\r\n]/.test(value))) throw invalid(`${label} contains unsupported characters.`);
  const result = value.trim();
  if ((!optional && !result) || result.length > maximum) throw invalid(`${label} must contain ${optional ? 'no more than' : 'between 1 and'} ${maximum} characters.`);
  return result;
}
function email(value) {
  const result = text(value, 254, 'Email address', { oneLine: true });
  if (!EMAIL.test(result) || result.split('@')[0].length > 64) throw invalid('Enter a valid email address.');
  return result;
}
export function applicationDatabase(env) {
  if (!env.BTS_DB?.prepare) throw new HttpError(503, 'applications_not_configured', 'The application inbox will be available after Cloudflare storage is connected.');
  return env.BTS_DB;
}
function storageError() { return new HttpError(503, 'applications_unavailable', 'The application inbox could not be reached. Please try again shortly.'); }
export async function applicationIntakeEnabled(env) {
  if (env.BTS_APPLICATIONS_ENABLED !== 'true' || !env.BTS_DB?.prepare) return false;
  try { await env.BTS_DB.prepare('SELECT id FROM applications LIMIT 1').first(); return true; }
  catch { return false; }
}
export function validateApplication(value) {
  object(value);
  if (value.honey !== undefined && value.honey !== '') throw invalid('This application could not be submitted.');
  const reference = text(value.reference, 80, 'Application reference', { oneLine: true });
  if (!/^BTS-[A-Z0-9-]{12,76}$/.test(reference)) throw invalid('Refresh the application form to create a valid reference.');
  return { reference, name: text(value.name, 120, 'Name', { oneLine: true }), email: email(value.email), message: text(value.message, 60000, 'Application details') };
}
export async function saveApplication(env, raw) {
  if (!await applicationIntakeEnabled(env)) throw new HttpError(503, 'applications_not_configured', 'The application inbox is not accepting submissions yet.');
  const value = validateApplication(raw);
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(JSON.stringify(value))))].map(byte => byte.toString(16).padStart(2, '0')).join('');
  const now = new Date().toISOString();
  const db = applicationDatabase(env);
  let result, saved;
  try {
    result = await db.prepare('INSERT INTO applications (id, reference, payload_hash, name, email, message, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(reference) DO NOTHING').bind(crypto.randomUUID(), value.reference, hash, value.name, value.email, value.message, now, now).run();
    if (result?.success === false) throw new Error('Write failed');
    saved = await db.prepare('SELECT payload_hash FROM applications WHERE reference = ?').bind(value.reference).first();
  } catch { throw storageError(); }
  if (!saved) throw storageError();
  if (saved.payload_hash !== hash) throw new HttpError(409, 'application_reference_conflict', 'This reference was already submitted with different answers. Contact BTS using the reference before submitting again.');
  return { success: true, reference: value.reference };
}
export function publicApplication(row) {
  return {
    id: row.id, reference: row.reference, name: row.name, email: row.email, message: row.message,
    status: row.status, decision: row.decision || null, createdAt: row.created_at, updatedAt: row.updated_at,
    decidedAt: row.decided_at || null, lastError: row.last_error || null
  };
}
export async function listApplications(env) {
  try {
    const result = await applicationDatabase(env).prepare('SELECT * FROM applications ORDER BY created_at DESC, id DESC LIMIT 100').all();
    if (result?.success === false || !Array.isArray(result.results)) throw new Error('Read failed');
    return result.results.map(publicApplication);
  } catch (error) { if (error instanceof HttpError) throw error; throw storageError(); }
}
export function validateTemplates(value) {
  object(value);
  const result = {};
  for (const decision of ['accepted', 'rejected']) {
    const template = object(value[decision]);
    result[decision] = {
      subject: text(template.subject, 200, 'Email subject', { oneLine: true, optional: true }),
      body: text(template.body, 10000, 'Email message', { optional: true })
    };
    for (const content of Object.values(result[decision])) {
      if (/{{|}}/.test(content.replace(/{{(?:name|email|reference)}}/g, ''))) throw invalid('Use only {{name}}, {{email}}, or {{reference}} as email placeholders.');
    }
  }
  return result;
}
export async function readApplicationSettings(env) {
  let row;
  try { row = await applicationDatabase(env).prepare('SELECT templates_json, revision, updated_at FROM application_settings WHERE id = 1').first(); }
  catch (error) { if (error instanceof HttpError) throw error; throw storageError(); }
  if (!row) return { templates: structuredClone(DEFAULT_TEMPLATES), revision: 0, updatedAt: null };
  try { return { templates: validateTemplates(JSON.parse(row.templates_json)), revision: row.revision, updatedAt: row.updated_at }; }
  catch { throw storageError(); }
}
export async function saveApplicationSettings(env, raw) {
  object(raw);
  if (!Number.isSafeInteger(raw.expectedRevision) || raw.expectedRevision < 0 || raw.expectedRevision >= Number.MAX_SAFE_INTEGER) throw invalid('Reload email settings before saving.');
  const templates = validateTemplates(raw.templates);
  const previous = raw.expectedRevision, revision = previous + 1, updatedAt = new Date().toISOString();
  const db = applicationDatabase(env);
  let result;
  try {
    result = previous === 0
      ? await db.prepare('INSERT INTO application_settings (id, templates_json, revision, updated_at) VALUES (1, ?, 1, ?) ON CONFLICT(id) DO NOTHING').bind(JSON.stringify(templates), updatedAt).run()
      : await db.prepare('UPDATE application_settings SET templates_json = ?, revision = ?, updated_at = ? WHERE id = 1 AND revision = ?').bind(JSON.stringify(templates), revision, updatedAt, previous).run();
    if (result?.success === false) throw new Error('Write failed');
  } catch { throw storageError(); }
  if (result?.meta?.changes !== 1) throw new HttpError(409, 'revision_conflict', 'Email messages were updated elsewhere. Keep a copy of your text, reload, and review before saving.');
  return { templates, revision, updatedAt };
}
export function emailConfigured(env) {
  return typeof env.RESEND_API_KEY === 'string' && env.RESEND_API_KEY.trim().length > 0 &&
    typeof env.APPLICATION_FROM_EMAIL === 'string' && EMAIL.test(env.APPLICATION_FROM_EMAIL) && env.APPLICATION_FROM_EMAIL.split('@')[0].length <= 64;
}
export function validateDecision(value) {
  object(value);
  if (typeof value.id !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value.id)) throw invalid('Choose a valid application.');
  if (!['accepted', 'rejected'].includes(value.decision)) throw invalid('Choose Accept or Reject.');
  const subject = text(value.subject, 200, 'Email subject', { oneLine: true });
  const body = text(value.body, 12000, 'Email message');
  if (/{{|}}/.test(subject + body)) throw invalid('Review the rendered message before sending; email placeholders must be replaced.');
  return { id: value.id, decision: value.decision, subject, body };
}
async function updateDelivery(db, id, status, error = null, providerId = null) {
  const now = new Date().toISOString();
  const result = await db.prepare('UPDATE applications SET status = ?, last_error = ?, email_provider_id = ?, updated_at = ?, decided_at = ? WHERE id = ? AND status = ?').bind(status, error, providerId, now, ['accepted', 'rejected'].includes(status) ? now : null, id, 'sending').run();
  if (result?.success === false || result?.meta?.changes !== 1) throw new Error('Delivery state update failed');
}
export async function decideApplication(env, raw, ownerEmail, fetcher = fetch) {
  const value = validateDecision(raw);
  if (!emailConfigured(env)) throw new HttpError(503, 'email_not_configured', 'Connect the email service and verified sender before sending decisions.');
  const db = applicationDatabase(env);
  let row, locked;
  const now = new Date().toISOString();
  try {
    row = await db.prepare('SELECT * FROM applications WHERE id = ?').bind(value.id).first();
    if (!row) throw new HttpError(404, 'application_not_found', 'This application could not be found.');
    if (row.status !== 'pending') throw new HttpError(409, 'decision_already_started', 'A decision was already sent or delivery is being checked for this application. Refresh the inbox before continuing.');
    locked = await db.prepare('UPDATE applications SET status = ?, decision = ?, email_subject = ?, email_body = ?, last_error = NULL, updated_at = ? WHERE id = ? AND status = ?').bind('sending', value.decision, value.subject, value.body, now, value.id, 'pending').run();
    if (locked?.success === false) throw new Error('Lock failed');
    if (locked?.meta?.changes !== 1) throw new HttpError(409, 'decision_already_started', 'Another decision is already being sent. Refresh the inbox before continuing.');
  } catch (error) { if (error instanceof HttpError) throw error; throw storageError(); }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let response, result;
  try {
    response = await fetcher('https://api.resend.com/emails', {
      method: 'POST', redirect: 'error', signal: controller.signal,
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': `bts-application-${value.id}-${value.decision}` },
      body: JSON.stringify({ from: `Breaking the Sky <${env.APPLICATION_FROM_EMAIL}>`, to: [row.email], reply_to: ownerEmail, subject: value.subject, text: value.body })
    });
    if (response.status >= 400 && response.status < 500 && response.status !== 409 && response.status !== 408) {
      await updateDelivery(db, value.id, 'pending', 'The email provider rejected this send. Review the sender configuration and message before retrying.');
      throw new HttpError(502, 'email_rejected', 'The email provider rejected the message. No decision was marked as sent; check the email setup before retrying.');
    }
    if (!response.ok) throw new Error('Email acceptance unknown');
    const responseText = await response.text();
    if (responseText.length > 16000) throw new Error('Unexpected provider response');
    result = JSON.parse(responseText);
    if (!result || typeof result.id !== 'string' || !result.id || result.id.length > 200) throw new Error('Email acceptance unknown');
    await updateDelivery(db, value.id, value.decision, null, result.id);
  } catch (error) {
    if (error instanceof HttpError && error.code === 'email_rejected') throw error;
    try { await updateDelivery(db, value.id, 'delivery_uncertain', 'Email delivery could not be confirmed. Check the email provider before attempting any resend.'); } catch { /* The sending lock remains when storage is unavailable. Never send a second email here. */ }
    throw new HttpError(502, 'delivery_uncertain', 'The email may have been accepted, but delivery could not be confirmed. Check the email provider before resending. This application is locked to prevent duplicate messages.');
  } finally { clearTimeout(timer); }
  return { success: true, emailAccepted: true, application: publicApplication({ ...row, status: value.decision, decision: value.decision, last_error: null, updated_at: new Date().toISOString(), decided_at: new Date().toISOString() }) };
}
