import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import worker from '../server/worker.js';

const origin = 'https://its.example.workers.dev';
const ownerEnvironment = {
  CF_ACCESS_TEAM_DOMAIN: 'bts-test.cloudflareaccess.com',
  CF_ACCESS_AUD: 'owner-app',
  OWNER_EMAIL: 'owner@example.org'
};
function request(path, options) { return new Request(origin + path, options); }
function assets() {
  const calls = [];
  return { calls, async fetch(req) { calls.push(req); return new Response('Static page', { status: 200 }); } };
}

test('public API requests reach existing handlers without falling through to assets', async () => {
  const ASSETS = assets();
  const status = await worker.fetch(request('/api/applications?check=1'), { ASSETS });
  assert.equal(status.status, 200);
  assert.deepEqual(await status.json(), { enabled: false });
  const content = await worker.fetch(request('/api/content'), { ASSETS });
  assert.equal(content.status, 503);
  assert.equal((await content.json()).code, 'storage_not_configured');
  assert.equal(ASSETS.calls.length, 0);
});

test('every private API route still requires verified owner identity', async () => {
  const ASSETS = assets();
  const paths = ['/api/owner/session', '/api/owner/content', '/api/owner/publish', '/api/owner/stats', '/api/owner/applications', '/api/owner/application-settings', '/api/owner/applications/decision'];
  for (const path of paths) {
    const response = await worker.fetch(request(path), { ...ownerEnvironment, ASSETS });
    assert.equal(response.status, 401, path);
    assert.equal((await response.json()).code, 'sign_in_required', path);
    assert.equal(response.headers.get('Cache-Control'), 'no-store', path);
  }
  assert.equal(ASSETS.calls.length, 0);
});

test('public intake preserves same-origin mutation restrictions', async () => {
  const ASSETS = assets();
  const response = await worker.fetch(request('/api/applications', {
    method: 'POST', headers: { Origin: 'https://other.example.org', 'Content-Type': 'application/json' }, body: '{}'
  }), { ASSETS });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, 'origin_rejected');
  assert.equal(ASSETS.calls.length, 0);
});

test('page-view recording stays in the API router and rejects cross-origin writes', async () => {
  const ASSETS = assets();
  const response = await worker.fetch(request('/api/page-view', {
    method: 'POST', headers: { Origin: 'https://other.example.org', 'Content-Type': 'application/json' }, body: '{"path":"/"}'
  }), { ASSETS });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, 'origin_rejected');
  assert.equal(ASSETS.calls.length, 0);
});

test('bare and unknown API paths return JSON 404 for every method instead of serving HTML', async () => {
  const ASSETS = assets();
  for (const path of ['/api', '/api/', '/api/missing', '/api/owner/unknown', '/api/applications/']) {
    for (const method of ['GET', 'POST', 'HEAD']) {
      const response = await worker.fetch(request(path, { method }), { ASSETS });
      assert.equal(response.status, 404, `${method} ${path}`);
      assert.match(response.headers.get('Content-Type'), /^application\/json/);
      assert.equal((await response.json()).code, 'not_found');
    }
  }
  assert.equal(ASSETS.calls.length, 0);
});

test('non-API paths pass the original request to the assets binding', async () => {
  const ASSETS = assets();
  for (const path of ['/', '/team.html', '/assets/theme.css?v=full-11', '/apiculture.html']) {
    const original = request(path);
    const response = await worker.fetch(original, { ASSETS });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'Static page');
    assert.equal(ASSETS.calls.at(-1), original);
  }
});

test('missing assets fail clearly without claiming a successful website response', async () => {
  const response = await worker.fetch(request('/'), {});
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, 'assets_not_configured');
});

test('Workers configuration matches Git build output and keeps all API paths worker-first', async () => {
  const config = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
  assert.equal(config.name, 'its');
  assert.equal(config.main, 'server/worker.js');
  assert.equal(config.keep_vars, true);
  assert.deepEqual(config.assets, { directory: './dist', binding: 'ASSETS', run_worker_first: ['/api', '/api/*'] });
  assert.equal(config.account_id, '76e1181b5afd1df4b6b15e2864218e21');
  assert.equal(config.workers_dev, true);
  assert.equal(config.vars.ADMISSIONS_EMAIL, 'breakingtheskyadmissions@gmail.com');
  assert.equal(config.vars.OWNER_EMAILS, 'ammarashary@gmail.com,breakingtheskyadmissions@gmail.com');
  assert.deepEqual(config.routes, [{ pattern: 'breakingthesky.com', custom_domain: true }]);
  for (const setting of ['route', 'd1_databases']) assert.equal(config[setting], undefined);
});
