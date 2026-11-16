import { HttpError } from './http.js';

const encoder = new TextEncoder();
const certificates = new Map();
const OWNER_EMAIL_PATTERN = /^[a-z0-9.!#$%&'+/=^_{}|~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;
function validOwnerEmail(value) {
  if (!value || value.length > 254 || !OWNER_EMAIL_PATTERN.test(value)) return false;
  const [local, domain] = value.split('@');
  return local.length <= 64 && !local.startsWith('.') && !local.endsWith('.') && !local.includes('..') && domain.split('.').every(label => label.length <= 63);
}
function configuration(env) {
  const raw = String(env.CF_ACCESS_TEAM_DOMAIN || '').trim().replace(/\/$/, '');
  const domain = raw.replace(/^https:\/\//, '');
  const audience = String(env.CF_ACCESS_AUD || '').trim();
  // An explicitly supplied list is authoritative, including when it is invalid.
  const hasOwnerList = env.OWNER_EMAILS !== undefined;
  const configuredOwners = hasOwnerList ? env.OWNER_EMAILS : env.OWNER_EMAIL;
  const owners = typeof configuredOwners === 'string' && configuredOwners.length <= 4096
    ? (hasOwnerList ? configuredOwners.split(',') : [configuredOwners]).map(email => email.trim().toLowerCase()) : [];
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.cloudflareaccess\.com$/i.test(domain) || !audience || !owners.length || owners.length > 10 || !owners.every(validOwnerEmail)) {
    throw new HttpError(503, 'owner_auth_not_configured', 'Owner sign-in will be available after Cloudflare is connected.');
  }
  return { issuer: `https://${domain.toLowerCase()}`, audience, owners };
}
function decodeSegment(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid token encoding');
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4));
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}
function decodeJSON(value) {
  const object = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(decodeSegment(value)));
  if (!object || typeof object !== 'object' || Array.isArray(object)) throw new Error('Invalid token data');
  return object;
}
async function keysFor(issuer, refresh, fetcher) {
  const saved = certificates.get(issuer);
  if (saved && saved.expires > Date.now() && (!refresh || saved.fetchedAt > Date.now() - 30000)) return saved.keys;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    // Workers supports manual/follow redirects, but rejects redirect: 'error'.
    // Manual plus the status check keeps key retrieval on the trusted issuer.
    const response = await fetcher(`${issuer}/cdn-cgi/access/certs`, { signal: controller.signal, redirect: 'manual' });
    if (!response.ok) throw new Error('Certificate service rejected request');
    const text = await response.text();
    if (text.length > 128000) throw new Error('Certificate response too large');
    const data = JSON.parse(text);
    if (!Array.isArray(data.keys) || data.keys.length > 25) throw new Error('Invalid certificates');
    const keys = data.keys.filter(key => key.kty === 'RSA' && (!key.alg || key.alg === 'RS256') && (!key.use || key.use === 'sig') && typeof key.kid === 'string');
    if (!keys.length) throw new Error('No signing certificates');
    if (certificates.size > 8) certificates.clear();
    certificates.set(issuer, { keys, fetchedAt: Date.now(), expires: Date.now() + 5 * 60 * 1000 });
    return keys;
  } catch {
    throw new HttpError(503, 'identity_unavailable', 'Sign-in could not be verified right now. Please try again shortly.');
  } finally { clearTimeout(timer); }
}
export async function authorizeOwner(request, env, fetcher = fetch) {
  const config = configuration(env);
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) throw new HttpError(401, 'sign_in_required', 'Sign in to the owner dashboard to continue.');
  if (token.length > 16000) throw new HttpError(401, 'invalid_identity', 'Your sign-in could not be verified.');
  let header, claims, signature, encoded;
  try {
    const pieces = token.split('.');
    if (pieces.length !== 3) throw new Error('Invalid token');
    header = decodeJSON(pieces[0]); claims = decodeJSON(pieces[1]); signature = decodeSegment(pieces[2]);
    encoded = encoder.encode(`${pieces[0]}.${pieces[1]}`);
    if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid || header.kid.length > 256) throw new Error('Invalid signing algorithm');
    if (header.crit !== undefined) throw new Error('Unsupported critical header');
  } catch { throw new HttpError(401, 'invalid_identity', 'Your sign-in could not be verified.'); }
  let keys = await keysFor(config.issuer, false, fetcher);
  let key = keys.find(candidate => candidate.kid === header.kid);
  if (!key) { keys = await keysFor(config.issuer, true, fetcher); key = keys.find(candidate => candidate.kid === header.kid); }
  if (!key) throw new HttpError(401, 'invalid_identity', 'Your sign-in could not be verified.');
  try {
    const publicKey = await crypto.subtle.importKey('jwk', key, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    if (!await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, signature, encoded)) throw new Error('Signature failed');
    const now = Math.floor(Date.now() / 1000);
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (claims.iss !== config.issuer || !audiences.includes(config.audience) || typeof claims.sub !== 'string' || !claims.sub) throw new Error('Invalid claims');
    if (!Number.isFinite(claims.exp) || claims.exp <= now) throw new Error('Expired identity');
    if (claims.nbf !== undefined && (!Number.isFinite(claims.nbf) || claims.nbf > now + 60)) throw new Error('Identity not active');
    if (claims.iat !== undefined && (!Number.isFinite(claims.iat) || claims.iat > now + 60)) throw new Error('Invalid issued time');
    if (typeof claims.email !== 'string') throw new Error('Missing email');
  } catch { throw new HttpError(401, 'invalid_identity', 'Your sign-in could not be verified.'); }
  const email = claims.email.trim().toLowerCase();
  if (!config.owners.includes(email)) throw new HttpError(403, 'owner_required', 'This account does not have permission to manage this website.');
  return { email };
}
export function clearCertificateCache() { certificates.clear(); }
