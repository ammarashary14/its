/** Configure only the BTS owner Access application; never change account-wide policy. */
const APP_NAME = 'BTS owner dashboard';
const PAGE_SIZE = 100;

function setupError(message) {
  const error = new Error(message);
  error.code = 'access_setup_required';
  return error;
}
function identifier(value, label) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
    throw setupError(`Cloudflare returned an invalid ${label}. No owner configuration was deployed.`);
  }
  return value;
}
function resultObject(envelope, label) {
  const value = envelope?.result;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw setupError(`Cloudflare returned an unreadable ${label}. No owner configuration was deployed.`);
  }
  return value;
}
async function listAll(api, path, label) {
  const items = [];
  const seen = new Set();
  for (let page = 1; page <= 100; page++) {
    const envelope = await api(`${path}?page=${page}&per_page=${PAGE_SIZE}`);
    if (!Array.isArray(envelope?.result)) throw setupError(`Cloudflare returned an unreadable ${label} list.`);
    const rows = envelope.result;
    for (const row of rows) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) throw setupError(`Cloudflare returned an unreadable ${label} entry.`);
      const id = identifier(row.id, `${label} ID`);
      if (seen.has(id)) throw setupError(`Cloudflare repeated a page of ${label}. Setup stopped without guessing which resources to use.`);
      seen.add(id); items.push(row);
    }
    const info = envelope.result_info;
    if (info?.page !== undefined && info.page !== page) throw setupError(`Cloudflare returned an unexpected ${label} page.`);
    if (Number.isInteger(info?.total_pages) && page >= info.total_pages) return items;
    if (Number.isInteger(info?.total_count) && items.length >= info.total_count) return items;
    if (!rows.length || (!Number.isInteger(info?.total_pages) && !Number.isInteger(info?.total_count) && rows.length < PAGE_SIZE)) return items;
  }
  throw setupError(`There are too many ${label} to configure safely in one deployment.`);
}
function protectedDestinations(hostname) {
  return [`${hostname}/owner`, `${hostname}/owner.html`, `${hostname}/api/owner/*`];
}
function appUris(app) {
  return [app.domain, ...(Array.isArray(app.self_hosted_domains) ? app.self_hosted_domains : []),
    ...(Array.isArray(app.destinations) ? app.destinations.filter(item => item?.type === 'public' || item?.type === undefined).map(item => item?.uri) : [])]
    .filter(item => typeof item === 'string');
}
function conflicts(app, hostname) {
  const targets = [`${hostname}/owner`, `${hostname}/owner.html`, `${hostname}/api/owner/session`];
  return appUris(app).some(uri => {
    const normalized = uri.replace(/^https:\/\//, '').replace(/\/$/, '');
    const pattern = normalized.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    const expression = new RegExp(`^${pattern}(?:/.*)?$`, 'i');
    return targets.some(target => expression.test(target));
  });
}
function sameStrings(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length &&
    [...actual].sort().every((item, index) => item === [...expected].sort()[index]);
}
function ownerPolicy(policy, emails) {
  if (!policy || policy.decision !== 'allow' || !Array.isArray(policy.include) || policy.include.length !== emails.length) return false;
  if (policy.exclude !== undefined && (!Array.isArray(policy.exclude) || policy.exclude.length)) return false;
  if (policy.require !== undefined && (!Array.isArray(policy.require) || policy.require.length)) return false;
  const included = [];
  for (const rule of policy.include) {
    if (!rule || Object.keys(rule).length !== 1 || !rule.email || Object.keys(rule.email).length !== 1 ||
        typeof rule.email.email !== 'string') return false;
    included.push(rule.email.email.trim().toLowerCase());
  }
  return sameStrings(included, emails);
}
function verifyApp(app, hostname, ownerEmails, otpId) {
  const expected = protectedDestinations(hostname);
  const destinations = app.destinations;
  const validDestinations = Array.isArray(destinations) && destinations.every(item => item &&
    item.type === 'public' && (!item.overrides || (Array.isArray(item.overrides) && item.overrides.length === 0)));
  if (app.name !== APP_NAME || app.type !== 'self_hosted' || !expected.includes(app.domain) ||
      !validDestinations || !sameStrings(destinations.map(item => item.uri), expected) ||
      !sameStrings(app.allowed_idps, [otpId]) || !Array.isArray(app.policies) ||
      app.policies.length !== 1 || !ownerPolicy(app.policies[0], ownerEmails) || app.path_cookie_attribute === true) {
    throw setupError('An existing BTS owner Access application has different destinations, sign-in providers, or access rules. Review it in Cloudflare; this deployment will not overwrite or broaden it.');
  }
  identifier(app.id, 'Access application ID');
  if (typeof app.aud !== 'string' || !/^[A-Za-z0-9_-]{1,512}$/.test(app.aud)) {
    throw setupError('Cloudflare did not return a usable owner application audience.');
  }
  return app;
}

/** api(path, options) returns Cloudflare's {result, result_info} envelope. */
export async function configureOwnerAccess({ api, accountId, hostname, ownerEmail, ownerEmails }) {
  const emails = ownerEmails === undefined ? [ownerEmail] : ownerEmails;
  if (typeof api !== 'function' || !/^[a-f0-9]{32}$/i.test(accountId || '') ||
      !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(hostname || '') ||
      !Array.isArray(emails) || !emails.length || emails.length > 20 ||
      emails.some(email => typeof email !== 'string' || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email))) {
    throw setupError('A valid Cloudflare account, public hostname, and owner email list are required.');
  }
  hostname = hostname.toLowerCase(); ownerEmails = [...new Set(emails.map(email => email.trim().toLowerCase()))];
  const base = `/accounts/${accountId}/access`;
  let organization;
  try {
    const envelope = await api(`${base}/organizations`);
    if (!Object.hasOwn(envelope || {}, 'result')) throw setupError('Cloudflare returned an unreadable Zero Trust organization.');
    organization = envelope.result === null ? null : resultObject(envelope, 'Zero Trust organization');
  } catch (error) {
    if (error.status !== 404) throw error;
    organization = null;
  }
  if (!organization) {
    organization = resultObject(await api(`${base}/organizations`, { method: 'POST', body: { name: 'Breaking the Sky' } }), 'Zero Trust organization');
  }
  if (typeof organization.auth_domain !== 'string' || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.cloudflareaccess\.com$/i.test(organization.auth_domain)) {
    throw setupError('Cloudflare Zero Trust has no valid team domain. Complete Zero Trust setup in the account before retrying; no subscription or billing settings were changed.');
  }

  const apps = await listAll(api, `${base}/apps`, 'Access applications');
  const named = apps.filter(app => app.name === APP_NAME);
  if (named.length > 1 || apps.some(app => app.name !== APP_NAME && conflicts(app, hostname))) {
    throw setupError('Another Access application already covers the BTS owner paths, or multiple BTS owner applications exist. Review those applications in Cloudflare; setup will not overwrite them.');
  }
  let existing = named.length ? resultObject(await api(`${base}/apps/${identifier(named[0].id, 'Access application ID')}`), 'Access application') : null;

  const providers = await listAll(api, `${base}/identity_providers`, 'identity providers');
  const otpProviders = providers.filter(provider => provider.type === 'onetimepin');
  let otp = existing && Array.isArray(existing.allowed_idps)
    ? otpProviders.find(provider => existing.allowed_idps.length === 1 && existing.allowed_idps[0] === provider.id)
    : null;
  otp ||= otpProviders[0];
  // An existing app must be checked without creating providers or changing its rules.
  if (existing) {
    if (!otp) throw setupError('The existing BTS owner application has no matching email-code identity provider. Review its sign-in settings in Cloudflare.');
    verifyApp(existing, hostname, ownerEmails, identifier(otp.id, 'identity provider ID'));
  } else {
    if (!otp) otp = resultObject(await api(`${base}/identity_providers`, {
      method: 'POST', body: { name: 'BTS email login', type: 'onetimepin', config: {} }
    }), 'email-code identity provider');
    const otpId = identifier(otp.id, 'identity provider ID');
    if (otp.type !== 'onetimepin') throw setupError('Cloudflare did not confirm an email-code identity provider.');
    const payload = {
      name: APP_NAME, type: 'self_hosted', domain: `${hostname}/owner`,
      destinations: protectedDestinations(hostname).map(uri => ({ type: 'public', uri })),
      allowed_idps: [otpId], session_duration: '24h', http_only_cookie_attribute: true,
      path_cookie_attribute: false, app_launcher_visible: false,
      policies: [{ name: 'BTS owner', decision: 'allow', include: ownerEmails.map(email => ({ email: { email } })), exclude: [], require: [] }]
    };
    const created = resultObject(await api(`${base}/apps`, { method: 'POST', body: payload }), 'Access application');
    const id = identifier(created.id, 'Access application ID');
    existing = verifyApp(resultObject(await api(`${base}/apps/${id}`), 'Access application'), hostname, ownerEmails, otpId);
  }
  return { teamDomain: organization.auth_domain.toLowerCase(), audience: existing.aud, appId: existing.id };
}
