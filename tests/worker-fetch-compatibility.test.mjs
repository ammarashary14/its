import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { generateKeyPairSync, sign } from 'node:crypto';

// Use Wrangler's actual workerd runtime, rather than Node's different Fetch API.
// An explicit Wrangler path also supports isolated development-tool caches.
const require = createRequire(import.meta.url);
const wrangler = process.env.BTS_WORKER_TEST_WRANGLER || require.resolve('wrangler');
const { Miniflare, convertV4MiniflareOptions } = createRequire(wrangler)('miniflare');
const root = fileURLToPath(new URL('../', import.meta.url));
const issuer = 'https://bts-auth-test.cloudflareaccess.com';
const audience = 'bts-test-audience';
const email = 'owner@example.com';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-signing-key', alg: 'RS256', use: 'sig' };
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const unsigned = `${encode({ alg: 'RS256', kid: jwk.kid })}.${encode({ iss: issuer, aud: [audience], sub: 'test-owner', email, iat: now - 10, exp: now + 600 })}`;
const token = `${unsigned}.${sign('RSA-SHA256', Buffer.from(unsigned), privateKey).toString('base64url')}`;

test('owner authentication works in workerd without following certificate redirects', async t => {
  const script = `
    import { authorizeOwner, clearCertificateCache } from './server/auth.js';
    const env = ${JSON.stringify({ CF_ACCESS_TEAM_DOMAIN: issuer.slice(8), CF_ACCESS_AUD: audience, OWNER_EMAIL: email })};
    const key = ${JSON.stringify(jwk)};
    export default { async fetch(request) {
      clearCertificateCache();
      const mode = new URL(request.url).pathname;
      if (mode === '/request-contract') {
        let unsupported;
        try { new Request('https://example.com', { redirect: 'error' }); }
        catch (error) { unsupported = error.name; }
        return Response.json({ unsupported, supported: new Request('https://example.com', { redirect: 'manual' }).redirect });
      }
      const calls = [];
      const certificates = async (url, init) => {
        // This constructor is native workerd and rejects unsupported options.
        const outgoing = new Request(url, init);
        calls.push({ url: outgoing.url, redirect: outgoing.redirect });
        if (mode === '/redirect') return new Response(null, { status: 302, headers: { Location: 'https://example.com/untrusted-keys' } });
        if (mode === '/unavailable') return new Response('Unavailable', { status: 503 });
        if (mode === '/invalid-keys') return Response.json({ keys: [] });
        return Response.json({ keys: [key] });
      };
      try {
        const owner = await authorizeOwner(request, env, certificates);
        return Response.json({ owner, calls });
      } catch (error) {
        return Response.json({ code: error.code, calls }, { status: error.status || 500 });
      }
    } };
  `;
  const options = {
    modulesRoot: root,
    compatibilityDate: '2026-11-16',
    modules: [
      { type: 'ESModule', path: path.join(root, 'test-worker-entry.mjs'), contents: script },
      ...await Promise.all(['server/auth.js', 'server/http.js'].map(async file => ({
        type: 'ESModule', path: path.join(root, file), contents: await readFile(path.join(root, file), 'utf8')
      })))
    ]
  };
  const runtime = new Miniflare(convertV4MiniflareOptions ? convertV4MiniflareOptions(options) : options);
  t.after(() => runtime.dispose());

  const contract = await runtime.dispatchFetch('https://bts.test/request-contract');
  assert.deepEqual(await contract.json(), { unsupported: 'TypeError', supported: 'manual' });

  const headers = { 'Cf-Access-Jwt-Assertion': token };
  const verified = await runtime.dispatchFetch('https://bts.test/valid', { headers });
  assert.equal(verified.status, 200);
  assert.deepEqual(await verified.json(), {
    owner: { email }, calls: [{ url: `${issuer}/cdn-cgi/access/certs`, redirect: 'manual' }]
  });

  for (const mode of ['redirect', 'unavailable', 'invalid-keys']) {
    const response = await runtime.dispatchFetch(`https://bts.test/${mode}`, { headers });
    assert.equal(response.status, 503, mode);
    assert.deepEqual(await response.json(), {
      code: 'identity_unavailable', calls: [{ url: `${issuer}/cdn-cgi/access/certs`, redirect: 'manual' }]
    }, mode);
  }

  const invalid = await runtime.dispatchFetch('https://bts.test/valid', {
    headers: { 'Cf-Access-Jwt-Assertion': `${unsigned}.${Buffer.alloc(256).toString('base64url')}` }
  });
  assert.equal(invalid.status, 401);
  assert.equal((await invalid.json()).code, 'invalid_identity');
});
