import test from 'node:test';
import assert from 'node:assert/strict';
import { configureOwnerAccess } from '../scripts/cloudflare-access.mjs';

const accountId = '76e1181b5afd1df4b6b15e2864218e21';
const hostname = 'breakingthesky.com';
const ownerEmail = 'ammarashary@gmail.com';
const base = `/accounts/${accountId}/access`;
const clone = value => structuredClone(value);
function ownerApp(extra = {}) {
  return {
    id: 'app-bts', aud: 'audience-bts', name: 'BTS owner dashboard', type: 'self_hosted',
    domain: `${hostname}/owner`,
    destinations: ['owner', 'owner.html', 'api/owner/*'].map(path => ({ type: 'public', uri: `${hostname}/${path}` })),
    allowed_idps: ['otp-1'], path_cookie_attribute: false,
    policies: [{ id: 'policy-bts', name: 'BTS owner', decision: 'allow', include: [{ email: { email: ownerEmail } }], exclude: [], require: [] }],
    ...extra
  };
}
function fake({ organization = { auth_domain: 'bts-team.cloudflareaccess.com' }, providers = [{ id: 'otp-1', type: 'onetimepin' }], apps = [], intercept } = {}) {
  const state = { organization: clone(organization), providers: clone(providers), apps: clone(apps) };
  const calls = [];
  const api = async (path, options = {}) => {
    const method = options.method || 'GET'; calls.push({ path, method, body: clone(options.body) });
    if (intercept) {
      const response = await intercept(path, options, state);
      if (response !== undefined) return response;
    }
    const url = new URL(path, 'https://api.cloudflare.com');
    const route = url.pathname;
    if (route === `${base}/organizations`) {
      if (method === 'POST') state.organization = { auth_domain: 'auto-team-1234.cloudflareaccess.com', ...options.body };
      return { result: clone(state.organization) };
    }
    if (route === `${base}/identity_providers`) {
      if (method === 'POST') {
        const provider = { id: 'otp-new', ...options.body }; state.providers.push(provider); return { result: clone(provider) };
      }
      return page(state.providers, url);
    }
    if (route === `${base}/apps`) {
      if (method === 'POST') {
        const app = { id: 'app-new', aud: 'audience-new', ...options.body }; state.apps.push(app); return { result: clone(app) };
      }
      return page(state.apps, url);
    }
    if (route.startsWith(`${base}/apps/`)) {
      return { result: clone(state.apps.find(app => app.id === route.split('/').at(-1))) };
    }
    throw new Error(`Unexpected API path ${path}`);
  };
  return { api, state, calls, run: () => configureOwnerAccess({ api, accountId, hostname, ownerEmail }) };
}
function page(items, url) {
  const number = Number(url.searchParams.get('page') || 1);
  const size = Number(url.searchParams.get('per_page') || 100);
  return { result: clone(items.slice((number - 1) * size, number * size)), result_info: { page: number, total_pages: Math.max(1, Math.ceil(items.length / size)), total_count: items.length } };
}
function writes(env) { return env.calls.filter(call => call.method !== 'GET'); }

test('creates only the missing organization, email provider, and owner-only app', async () => {
  const env = fake({ organization: null, providers: [] });
  assert.deepEqual(await env.run(), { teamDomain: 'auto-team-1234.cloudflareaccess.com', audience: 'audience-new', appId: 'app-new' });
  assert.deepEqual(writes(env).map(call => call.path), [`${base}/organizations`, `${base}/identity_providers`, `${base}/apps`]);
  const created = env.state.apps[0];
  assert.deepEqual(created.destinations.map(item => item.uri), [`${hostname}/owner`, `${hostname}/owner.html`, `${hostname}/api/owner/*`]);
  assert.deepEqual(created.policies[0].include, [{ email: { email: ownerEmail } }]);
  assert.equal(created.path_cookie_attribute, false);
  assert.deepEqual(writes(env)[0].body, { name: 'Breaking the Sky' });
  assert.equal(env.calls.some(call => /billing|subscription/.test(call.path)), false);
});

test('existing exact owner app and OTP provider are reused without mutation', async () => {
  const env = fake({ apps: [ownerApp()] });
  assert.deepEqual(await env.run(), { teamDomain: 'bts-team.cloudflareaccess.com', audience: 'audience-bts', appId: 'app-bts' });
  assert.equal(writes(env).length, 0);
});

test('repeated setup of newly created resources is idempotent', async () => {
  const env = fake({ organization: null, providers: [] });
  const first = await env.run(); const count = writes(env).length;
  assert.deepEqual(await env.run(), first);
  assert.equal(writes(env).length, count);
});

test('403 and unknown API failures are propagated without creating an organization', async () => {
  for (const status of [403, 429, 500, undefined]) {
    const failure = Object.assign(new Error('Access denied'), { status });
    const env = fake({ intercept() { throw failure; } });
    await assert.rejects(env.run(), error => error === failure);
    assert.equal(writes(env).length, 0);
  }
});

test('an actual organization 404 permits minimal creation', async () => {
  let first = true;
  const env = fake({ organization: null, intercept(path) {
    if (first && path === `${base}/organizations`) { first = false; throw Object.assign(new Error('Missing'), { status: 404 }); }
  } });
  await env.run();
  assert.equal(writes(env)[0].path, `${base}/organizations`);
});

test('malformed organization responses fail without writes', async () => {
  for (const result of [{}, { result: {} }, { result: [] }, { result: { auth_domain: 'attacker.example' } }]) {
    const env = fake({ intercept(path) { if (path === `${base}/organizations`) return result; } });
    await assert.rejects(env.run(), /organization|team domain/);
    assert.equal(writes(env).length, 0);
  }
});

test('broader or mismatched existing app configuration is never overwritten', async () => {
  const variants = [
    { policies: [{ decision: 'allow', include: [{ everyone: {} }] }] },
    { policies: [...ownerApp().policies, { decision: 'bypass', include: [{ everyone: {} }] }] },
    { destinations: [{ type: 'public', uri: hostname }] },
    { domain: 'other.example/owner' },
    { allowed_idps: ['otp-1', 'another-provider'] },
    { path_cookie_attribute: true },
    { destinations: ownerApp().destinations.map(item => ({ ...item, overrides: [{ type: 'bypass' }] })) }
  ];
  for (const extra of variants) {
    const env = fake({ apps: [ownerApp(extra)] });
    await assert.rejects(env.run(), /different destinations/);
    assert.equal(writes(env).length, 0);
  }
});

test('ambiguous names and other overlapping Access applications block creation', async () => {
  for (const apps of [
    [ownerApp(), ownerApp({ id: 'second-app' })],
    [{ id: 'other-app', name: 'Other owner policy', domain: `${hostname}/api/*` }],
    [{ id: 'other-app', name: 'Whole website', domain: hostname }]
  ]) {
    const env = fake({ apps }); await assert.rejects(env.run(), /Another Access application/);
    assert.equal(writes(env).length, 0);
  }
});

test('application pagination finds an existing app beyond the first page', async () => {
  const apps = Array.from({ length: 100 }, (_, i) => ({ id: `other-${i}`, name: `Other ${i}`, domain: `site${i}.example.com` }));
  apps.push(ownerApp());
  const env = fake({ apps });
  assert.equal((await env.run()).appId, 'app-bts');
  assert.ok(env.calls.some(call => call.path === `${base}/apps?page=2&per_page=100`));
  assert.equal(writes(env).length, 0);
});

test('existing app selects its configured OTP rather than switching provider', async () => {
  const env = fake({ providers: [{ id: 'otp-other', type: 'onetimepin' }, { id: 'otp-1', type: 'onetimepin' }], apps: [ownerApp()] });
  assert.equal((await env.run()).appId, 'app-bts'); assert.equal(writes(env).length, 0);
});

test('missing or malformed email-provider confirmation never creates an application', async () => {
  const env = fake({ providers: [], intercept(path, options) {
    if (path === `${base}/identity_providers` && options.method === 'POST') return { result: { id: 'provider-new', type: 'unknown' } };
  } });
  await assert.rejects(env.run(), /email-code/);
  assert.equal(writes(env).some(call => call.path === `${base}/apps`), false);
});

test('new application audience and policy are verified before runtime settings are returned', async () => {
  const env = fake({ intercept(path, options, state) {
    if (path === `${base}/apps/app-new`) return { result: { ...state.apps[0], aud: '' } };
  } });
  await assert.rejects(env.run(), /audience/);
});

test('invalid setup inputs cannot call the API', async () => {
  let called = false;
  await assert.rejects(configureOwnerAccess({ api() { called = true; }, accountId, hostname: 'https://breakingthesky.com', ownerEmail }), /valid Cloudflare/);
  assert.equal(called, false);
});

test('the two explicitly authorized owner emails create an exact allowlist and reuse cleanly', async () => {
  const env = fake();
  const ownerEmails = [ownerEmail, 'breakingtheskyadmissions@gmail.com'];
  const options = { api: env.api, accountId, hostname, ownerEmails };
  const result = await configureOwnerAccess(options);
  assert.deepEqual(env.state.apps[0].policies[0].include, ownerEmails.map(email => ({ email: { email } })));
  const count = writes(env).length;
  assert.deepEqual(await configureOwnerAccess(options), result);
  assert.equal(writes(env).length, count);
});

test('a one-owner policy is not silently broadened when another owner is requested', async () => {
  const env = fake({ apps: [ownerApp()] });
  await assert.rejects(configureOwnerAccess({ api: env.api, accountId, hostname, ownerEmails: [ownerEmail, 'breakingtheskyadmissions@gmail.com'] }), /different destinations/);
  assert.equal(writes(env).length, 0);
});
