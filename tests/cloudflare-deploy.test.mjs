import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createCloudflareApi, CloudflareApiError } from '../scripts/cloudflare-api.mjs';
import { deployCloudflare, DEPLOY_TARGET, selectDatabase } from '../scripts/cloudflare-deploy.mjs';

const TOKEN = 'test-only-deployment-secret-never-published';
const database = { name: 'bts-site', uuid: '12345678-1234-1234-1234-123456789abc' };
const identity = { teamDomain: 'bts-test.cloudflareaccess.com', audience: 'abc123', appId: 'app-test' };
const source = {
  name: 'its', main: 'server/worker.js', account_id: DEPLOY_TARGET.accountId, keep_vars: true,
  assets: { directory: './dist', binding: 'ASSETS', run_worker_first: ['/api', '/api/*'] },
  workers_dev: true, routes: [{ pattern: 'breakingthesky.com', custom_domain: true }],
  vars: { EXISTING_SETTING: 'preserved' }
};
async function fixture(t, config = source) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'bts-deploy-test-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await writeFile(path.join(cwd, 'wrangler.jsonc'), JSON.stringify(config));
  return cwd;
}
async function absent(file) { await assert.rejects(access(file), { code: 'ENOENT' }); }
function inputs(cwd, overrides = {}) {
  return { cwd, env: { CLOUDFLARE_API_TOKEN: TOKEN }, configureAccess: async () => identity, log: () => {}, ...overrides };
}

test('API credentials go only to Cloudflare with redirects prohibited', async () => {
  let seen;
  const api = createCloudflareApi({ token: TOKEN, fetcher: async (url, options) => {
    seen = { url, options }; return new Response(JSON.stringify({ success: true, result: { id: 'app' } }));
  } });
  const result = await api(`/accounts/${DEPLOY_TARGET.accountId}/access/apps`, { method: 'POST', body: { name: 'BTS' } });
  assert.equal(result.result.id, 'app');
  assert.equal(seen.url, `https://api.cloudflare.com/client/v4/accounts/${DEPLOY_TARGET.accountId}/access/apps`);
  assert.equal(seen.options.headers.Authorization, 'Bearer ' + TOKEN);
  assert.equal(seen.options.redirect, 'error');
  assert.deepEqual(JSON.parse(seen.options.body), { name: 'BTS' });
  for (const bad of ['https://other.example/accounts/1', '//other.example/accounts/1', '/accounts/x\\else', '/accounts/x\n']) {
    await assert.rejects(api(bad), /invalid account API path/);
  }
});

test('API provider and network errors never expose raw error messages or credentials', async () => {
  const api = createCloudflareApi({ token: TOKEN, fetcher: async () => new Response(JSON.stringify({ success: false, errors: [{ code: 10000, message: TOKEN }] }), { status: 403 }) });
  await assert.rejects(api('/accounts/example/access/apps'), error => {
    assert.ok(error instanceof CloudflareApiError); assert.equal(error.status, 403); assert.deepEqual(error.codes, [10000]);
    assert.ok(!error.message.includes(TOKEN)); return true;
  });
  const network = createCloudflareApi({ token: TOKEN, fetcher: async () => { throw new Error(TOKEN); } });
  await assert.rejects(network('/accounts/example/access/apps'), error => !error.message.includes(TOKEN) && error.status === 0);
});

test('disabled Access reports dashboard onboarding without exposing arbitrary provider text', async () => {
  const api = createCloudflareApi({ token: TOKEN, fetcher: async () => new Response(JSON.stringify({
    success: false, errors: [{ code: 9999, message: 'access.api.error.not_enabled: Access is not enabled. ' + TOKEN }]
  }), { status: 403 }) });
  await assert.rejects(api('/accounts/example/access/organizations'), error => {
    assert.equal(error.status, 403);
    assert.equal(error.providerCode, 'access.api.error.not_enabled');
    assert.equal(error.operation, 'GET Access organization');
    assert.match(error.message, /Complete Zero Trust onboarding/);
    assert.ok(!error.message.includes(TOKEN));
    return true;
  });
});

test('generic 9999 permission errors are not misidentified as disabled Access', async () => {
  const api = createCloudflareApi({ token: TOKEN, fetcher: async () => new Response(JSON.stringify({
    success: false, errors: [{ code: 9999, message: 'Permission denied ' + TOKEN }]
  }), { status: 403 }) });
  await assert.rejects(api('/accounts/example/access/apps'), error => {
    assert.equal(error.providerCode, undefined);
    assert.equal(error.operation, 'GET Access applications');
    assert.match(error.message, /Check the build token permissions/);
    assert.ok(!error.message.includes(TOKEN));
    return true;
  });
});

test('existing database is preserved, migrations precede enabled intake, and config is cleaned', async t => {
  const cwd = await fixture(t); const calls = []; const configs = []; const logs = [];
  const result = await deployCloudflare(inputs(cwd, { log: text => logs.push(text), runWrangler: async args => {
    calls.push(args);
    if (args[1] === 'list') return { stdout: JSON.stringify([database, { name: 'other-project', uuid: 'abcdefab-1234-1234-1234-123456789abc' }]) };
    configs.push(JSON.parse(await readFile(args.at(-1), 'utf8'))); return { stdout: '' };
  } }));
  assert.equal(result.databaseId, database.uuid);
  assert.deepEqual(calls.map(args => args.slice(0, 3)), [['d1', 'list', '--json'], ['d1', 'migrations', 'apply'], ['deploy', '--config', path.join(cwd, DEPLOY_TARGET.runtimeConfig)]]);
  assert.equal(configs[0].vars.BTS_APPLICATIONS_ENABLED, 'false'); assert.equal(configs[1].vars.BTS_APPLICATIONS_ENABLED, 'true');
  assert.equal(configs[0].vars.BTS_TUTORING_ENABLED, 'false'); assert.equal(configs[1].vars.BTS_TUTORING_ENABLED, 'true');
  assert.equal(configs[1].vars.CF_ACCESS_AUD, identity.audience); assert.equal(configs[1].vars.OWNER_EMAIL, DEPLOY_TARGET.ownerEmail);
  assert.equal(configs[1].vars.OWNER_EMAILS, 'ammarashary@gmail.com,breakingtheskyadmissions@gmail.com');
  assert.equal(configs[1].vars.EXISTING_SETTING, 'preserved'); assert.deepEqual(configs[1].routes, source.routes);
  assert.equal(configs[1].d1_databases[0].database_id, database.uuid);
  assert.ok(!JSON.stringify(configs).includes(TOKEN)); assert.ok(!logs.join('\n').includes(TOKEN));
  await absent(path.join(cwd, DEPLOY_TARGET.runtimeConfig));
  assert.deepEqual(JSON.parse(await readFile(path.join(cwd, 'wrangler.jsonc'), 'utf8')), source);
});

test('new database is created only after D1 lookup and owner access setup succeed', async t => {
  const cwd = await fixture(t); const steps = []; let lists = 0;
  await deployCloudflare(inputs(cwd, { configureAccess: async () => { steps.push('access'); return identity; }, runWrangler: async args => {
    steps.push(args[0] === 'deploy' ? 'deploy' : args[1]);
    if (args[1] === 'list') return { stdout: JSON.stringify(lists++ ? [database] : []) };
    if (args[1] === 'create') assert.deepEqual(args, ['d1', 'create', 'bts-site', '--binding', 'BTS_DB', '--update-config=false']);
    return { stdout: '' };
  } }));
  assert.deepEqual(steps, ['list', 'access', 'create', 'list', 'migrations', 'deploy']);
});

test('account and database mismatches fail without borrowing another project database', async t => {
  const cwd = await fixture(t); let invoked = false;
  await assert.rejects(deployCloudflare(inputs(cwd, { env: { CLOUDFLARE_API_TOKEN: TOKEN, CLOUDFLARE_ACCOUNT_ID: 'wrong-account' }, runWrangler: async () => { invoked = true; } })), /account does not match/);
  assert.equal(invoked, false);
  assert.throws(() => selectDatabase([database], { d1_databases: [{ binding: 'BTS_DB', database_name: 'bts-site', database_id: 'ffffffff-1234-1234-1234-123456789abc' }] }), /does not match/);
  assert.throws(() => selectDatabase([database, database]), /unambiguously/);
  assert.equal(selectDatabase([{ name: 'lasserre', uuid: database.uuid }]), null);
});

test('Access failure stops before creating a database or writing configuration', async t => {
  const cwd = await fixture(t); const calls = [];
  await assert.rejects(deployCloudflare(inputs(cwd, { configureAccess: async () => { throw new CloudflareApiError(403, [10000]); }, runWrangler: async args => { calls.push(args); return { stdout: '[]' }; } })), /HTTP 403/);
  assert.equal(calls.length, 1); await absent(path.join(cwd, DEPLOY_TARGET.runtimeConfig));
});

test('migration failure prevents deployment and removes temporary config', async t => {
  const cwd = await fixture(t); let deployed = false;
  await assert.rejects(deployCloudflare(inputs(cwd, { runWrangler: async args => {
    if (args[1] === 'list') return { stdout: JSON.stringify([database]) };
    if (args[1] === 'migrations') throw new Error('migration blocked');
    deployed = true; return { stdout: '' };
  } })), /migration blocked/);
  assert.equal(deployed, false); await absent(path.join(cwd, DEPLOY_TARGET.runtimeConfig));
});

test('failed deployment never reports completion and still removes temporary config', async t => {
  const cwd = await fixture(t); const logs = [];
  await assert.rejects(deployCloudflare(inputs(cwd, { log: value => logs.push(value), runWrangler: async args => {
    if (args[1] === 'list') return { stdout: JSON.stringify([database]) };
    if (args[0] === 'deploy') throw new Error('deployment rejected');
    return { stdout: '' };
  } })), /deployment rejected/);
  assert.ok(!logs.some(line => line.includes('deployment completed'))); await absent(path.join(cwd, DEPLOY_TARGET.runtimeConfig));
});

test('Wrangler authentication fallback stays in memory and rejects global API keys', async t => {
  const cwd = await fixture(t); const logs = [];
  const calls = [];
  await deployCloudflare(inputs(cwd, { env: {}, log: value => logs.push(value), runWrangler: async args => {
    calls.push(args);
    if (args[0] === 'auth') return { stdout: JSON.stringify({ type: 'api_token', token: TOKEN }) };
    if (args[1] === 'list') return { stdout: JSON.stringify([database]) };
    assert.ok(!(await readFile(args.at(-1), 'utf8')).includes(TOKEN)); return { stdout: '' };
  } }));
  assert.deepEqual(calls[0], ['auth', 'token', '--json']); assert.ok(!logs.join('\n').includes(TOKEN));
  await assert.rejects(deployCloudflare(inputs(cwd, { env: {}, runWrangler: async () => ({ stdout: JSON.stringify({ type: 'api_key', key: TOKEN, email: 'private@example.com' }) }) })), /Global API key/);
});

test('check mode does not access credentials, call APIs, write config, or invoke Wrangler', async t => {
  const cwd = await fixture(t); let calls = 0;
  const plan = await deployCloudflare({ cwd, env: {}, checkOnly: true, runWrangler: async () => { calls++; }, configureAccess: async () => { calls++; }, log: () => {} });
  assert.equal(calls, 0); assert.equal(plan.database, 'bts-site'); await absent(path.join(cwd, DEPLOY_TARGET.runtimeConfig));
});
