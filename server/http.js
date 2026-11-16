export class HttpError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
export function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  } });
}
export function failure(error) {
  if (error instanceof HttpError) return json({ error: error.message, code: error.code }, error.status);
  return json({ error: 'This service is temporarily unavailable.', code: 'service_unavailable' }, 503);
}
export function requireMethod(request, method) {
  if (request.method !== method) throw new HttpError(405, 'method_not_allowed', 'This request method is not supported.');
}
export function requireSameOrigin(request) {
  const origin = request.headers.get('Origin');
  if (origin !== new URL(request.url).origin || request.headers.get('Sec-Fetch-Site') === 'cross-site') {
    throw new HttpError(403, 'origin_rejected', 'Open the owner dashboard on this website before publishing.');
  }
}
export async function readJson(request, maximum = 2 * 1024 * 1024) {
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new HttpError(415, 'json_required', 'Send the update as JSON.');
  }
  const declared = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > maximum) throw new HttpError(413, 'body_too_large', 'This update is too large. Reduce the profile photo sizes.');
  if (!request.body) throw new HttpError(400, 'invalid_json', 'The update is empty.');
  const reader = request.body.getReader();
  const chunks = []; let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximum) { await reader.cancel(); throw new HttpError(413, 'body_too_large', 'This update is too large. Reduce the profile photo sizes.'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new HttpError(400, 'invalid_json', 'The update could not be read.'); }
}
