const API_ORIGIN = 'https://api.cloudflare.com';
const API_PREFIX = '/client/v4';

export class CloudflareApiError extends Error {
  constructor(status, codes = [], message) {
    const safeCodes = codes.filter(code => Number.isSafeInteger(code)).slice(0, 8);
    super(message || `Cloudflare setup request failed (HTTP ${status || 'unavailable'}${safeCodes.length ? `; codes ${safeCodes.join(', ')}` : ''}). Check the build token permissions and retry.`);
    this.name = 'CloudflareApiError';
    this.status = status;
    this.codes = safeCodes;
  }
}

/** The token stays in process memory and is sent only to Cloudflare's API. */
export function createCloudflareApi({ token, fetcher = fetch, timeoutMs = 20000 } = {}) {
  if (typeof token !== 'string' || !token.trim() || /[\r\n]/.test(token)) {
    throw new Error('Cloudflare deployment credentials are unavailable. Select the BTS build token in Workers → Settings → Build → API token.');
  }
  const credential = token.trim();
  return async function api(path, { method = 'GET', body } = {}) {
    if (typeof path !== 'string' || !path.startsWith('/accounts/') || path.startsWith('//') || /[\\\x00-\x20\x7f]/.test(path)) {
      throw new Error('Cloudflare setup requested an invalid account API path.');
    }
    const target = new URL(API_PREFIX + path, API_ORIGIN);
    if (target.origin !== API_ORIGIN || !target.pathname.startsWith(API_PREFIX + '/accounts/')) {
      throw new Error('Cloudflare setup requested an invalid account API path.');
    }
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) throw new Error('Unsupported Cloudflare setup request method.');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher(target.href, {
        method,
        redirect: 'error',
        signal: controller.signal,
        headers: { Authorization: `Bearer ${credential}`, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
      const raw = await response.text();
      if (raw.length > 4 * 1024 * 1024) throw new CloudflareApiError(response.status, [], 'Cloudflare returned an unexpectedly large setup response. No configuration was applied from it.');
      let envelope;
      try { envelope = JSON.parse(raw); } catch { throw new CloudflareApiError(response.status); }
      if (!response.ok || !envelope || envelope.success !== true) {
        const codes = Array.isArray(envelope?.errors) ? envelope.errors.map(error => error?.code) : [];
        const resource = /\/access\/organizations(?:\?|$)/.test(path) ? 'Access organization'
          : /\/access\/identity_providers(?:\/|\?|$)/.test(path) ? 'Access identity providers'
          : /\/access\/apps(?:\/|\?|$)/.test(path) ? 'Access applications' : 'account resource';
        // Map only a known provider identifier to a fixed message. Never forward
        // arbitrary response text, account identifiers, or credentials to logs.
        const accessDisabled = response.status === 403 && Array.isArray(envelope?.errors) && envelope.errors.some(error =>
          error?.code === 9999 && typeof error.message === 'string' && error.message.startsWith('access.api.error.not_enabled:'));
        const error = accessDisabled
          ? new CloudflareApiError(response.status, codes, `Cloudflare Access is not enabled for this account. Complete Zero Trust onboarding at https://one.dash.cloudflare.com/ and retry the build. Operation: ${method} ${resource} (HTTP 403; code 9999).`)
          : new CloudflareApiError(response.status, codes);
        error.operation = `${method} ${resource}`;
        if (accessDisabled) error.providerCode = 'access.api.error.not_enabled';
        else error.message += ` Operation: ${error.operation}.`;
        throw error;
      }
      return envelope;
    } catch (error) {
      if (error instanceof CloudflareApiError) throw error;
      throw new CloudflareApiError(0, [], 'Cloudflare setup could not confirm an API response. Check the account configuration before retrying.');
    } finally { clearTimeout(timeout); }
  };
}
