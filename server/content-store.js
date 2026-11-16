import { validateSiteContent } from '../assets/content-schema.js';
import { HttpError } from './http.js';

function database(env) {
  if (!env.BTS_DB?.prepare) throw new HttpError(503, 'storage_not_configured', 'Publishing will be available after Cloudflare storage is connected.');
  return env.BTS_DB;
}
export async function readContent(env, { publicView = false } = {}) {
  const db = database(env);
  let row;
  try { row = await db.prepare('SELECT content_json, revision, updated_at FROM site_content WHERE id = 1').first(); }
  catch { throw new HttpError(503, 'storage_unavailable', 'Website content could not be loaded right now.'); }
  if (!row) return { content: null, revision: 0, updatedAt: null };
  let content;
  try { content = validateSiteContent(JSON.parse(row.content_json)); }
  catch { throw new HttpError(503, 'content_unavailable', 'The saved website content could not be loaded.'); }
  if (publicView) {
    content.people = content.people.filter(person => person.visible);
    content.calendar.events = content.calendar.events.filter(event => event.visible);
  }
  return { content, revision: row.revision, updatedAt: row.updated_at };
}
export async function publishContent(env, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Number.isSafeInteger(value.expectedRevision) || value.expectedRevision < 0 || value.expectedRevision >= Number.MAX_SAFE_INTEGER) {
    throw new HttpError(400, 'invalid_update', 'Reload the latest website version before publishing.');
  }
  let content;
  try { content = validateSiteContent(value.content); }
  catch { throw new HttpError(400, 'invalid_content', 'Some content is invalid. Check your text, profiles, and photos before publishing.'); }
  const db = database(env);
  const previous = value.expectedRevision;
  const revision = previous + 1;
  const updatedAt = new Date().toISOString();
  const serialized = JSON.stringify(content);
  let result;
  try {
    result = previous === 0
      ? await db.prepare('INSERT INTO site_content (id, content_json, revision, updated_at) VALUES (1, ?, 1, ?) ON CONFLICT(id) DO NOTHING').bind(serialized, updatedAt).run()
      : await db.prepare('UPDATE site_content SET content_json = ?, revision = ?, updated_at = ? WHERE id = 1 AND revision = ?').bind(serialized, revision, updatedAt, previous).run();
  } catch { throw new HttpError(503, 'storage_unavailable', 'Your update could not be saved. Your draft is still available on this device.'); }
  if (result?.success === false) throw new HttpError(503, 'storage_unavailable', 'Your update could not be saved. Your draft is still available on this device.');
  if (result?.meta?.changes !== 1) throw new HttpError(409, 'revision_conflict', 'The website was updated elsewhere. Export your draft, then reload the latest version before publishing.');
  return { content, revision, updatedAt };
}
