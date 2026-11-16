import { readFile, writeFile, rm, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { createCloudflareApi } from './cloudflare-api.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const DEPLOY_TARGET = Object.freeze({
  accountId: '76e1181b5afd1df4b6b15e2864218e21',
  workerName: 'its',
  hostname: 'breakingthesky.com',
  ownerEmail: 'ammarashary@gmail.com',
  ownerEmails: Object.freeze(['ammarashary@gmail.com', 'breakingtheskyadmissions@gmail.com']),
  databaseName: 'bts-site',
  binding: 'BTS_DB',
  runtimeConfig: '.bts-cloudflare.runtime.json'
});

function uuid(value) { return typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value); }
function assertSource(source, env = {}) {
  if (!source || source.name !== DEPLOY_TARGET.workerName || source.main !== 'server/worker.js' || source.assets?.directory !== './dist' || source.assets?.binding !== 'ASSETS') {
    throw new Error('This deployment script only supports the BTS its Worker and its existing static assets configuration.');
  }
  for (const id of [source.account_id, env.CLOUDFLARE_ACCOUNT_ID, env.CF_ACCOUNT_ID]) {
    if (id && id !== DEPLOY_TARGET.accountId) throw new Error('Cloudflare account does not match the BTS deployment account. No resources were changed.');
  }
  if (source.d1_databases !== undefined && !Array.isArray(source.d1_databases)) throw new Error('The D1 configuration is invalid.');
  if ((source.d1_databases || []).some(database => database.binding !== DEPLOY_TARGET.binding || database.database_name !== DEPLOY_TARGET.databaseName || !uuid(database.database_id)) || (source.d1_databases || []).length > 1) {
    throw new Error('The source contains a different database binding. Review it before configuring the dedicated BTS database.');
  }
}

export function deploymentPlan(source, env = {}) {
  assertSource(source, env);
  return {
    worker: DEPLOY_TARGET.workerName,
    hostname: DEPLOY_TARGET.hostname,
    database: DEPLOY_TARGET.databaseName,
    steps: ['Verify D1 access', 'Configure owner-only Cloudflare Access', 'Reuse or create the BTS database', 'Apply repository migrations', 'Deploy the website with its database and owner identity']
  };
}

export function selectDatabase(output, source = {}) {
  let list;
  try { list = typeof output === 'string' ? JSON.parse(output.trim()) : output; } catch { throw new Error('Wrangler did not return a readable database list. No database was selected.'); }
  if (!Array.isArray(list)) throw new Error('Wrangler did not return a database list.');
  const matches = list.filter(database => database?.name === DEPLOY_TARGET.databaseName);
  if (matches.length > 1 || (matches.length === 1 && !uuid(matches[0].uuid))) throw new Error('The BTS database could not be identified unambiguously.');
  const found = matches[0] || null;
  const configured = source.d1_databases?.[0];
  if (configured && (!found || found.uuid !== configured.database_id)) throw new Error('The configured BTS database does not match the account database. No replacement database will be created.');
  return found;
}

export function runtimeConfiguration(source, { databaseId, teamDomain, audience, ready = false }) {
  assertSource(source);
  if (!uuid(databaseId) || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.cloudflareaccess\.com$/i.test(teamDomain || '') || typeof audience !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(audience)) {
    throw new Error('Cloudflare did not return valid database and owner identity identifiers.');
  }
  return {
    ...source,
    account_id: DEPLOY_TARGET.accountId,
    keep_vars: true,
    d1_databases: [{ binding: DEPLOY_TARGET.binding, database_name: DEPLOY_TARGET.databaseName, database_id: databaseId, migrations_dir: 'migrations' }],
    vars: {
      ...source.vars,
      OWNER_EMAIL: DEPLOY_TARGET.ownerEmail,
      OWNER_EMAILS: DEPLOY_TARGET.ownerEmails.join(','),
      ADMISSIONS_EMAIL: 'breakingtheskyadmissions@gmail.com',
      APPLICATION_EMAIL_PROVIDER: 'gmail',
      BTS_SITE_ANALYTICS_ENABLED: 'true',
      CF_ACCESS_TEAM_DOMAIN: teamDomain,
      CF_ACCESS_AUD: audience,
      BTS_APPLICATIONS_ENABLED: ready ? 'true' : 'false',
      BTS_TUTORING_ENABLED: ready ? 'true' : 'false'
    }
  };
}

function commandDescription(args) {
  if (args[0] === 'deploy') return 'Worker deployment';
  if (args[0] === 'd1' && args[1] === 'list') return 'D1 database lookup';
  if (args[0] === 'd1' && args[1] === 'create') return 'D1 database creation';
  if (args[0] === 'd1' && args[1] === 'migrations') return 'D1 schema migration';
  return 'Cloudflare setup command';
}

/** Wrangler receives credentials through its inherited environment, never argv. */
export async function executeWrangler(args, { cwd, env }) {
  const entrypoint = path.join(cwd, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
  try { await access(entrypoint); } catch { throw new Error('Wrangler is not installed. Run npm install before the Cloudflare deploy command.'); }
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entrypoint, ...args], {
      cwd,
      env: { ...env, CI: 'true', WRANGLER_HIDE_BANNER: 'true', WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG_SANITIZE: 'true' },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = ''; let stderr = ''; let limitReached = false;
    const timeout = setTimeout(() => child.kill('SIGTERM'), 5 * 60 * 1000);
    const collect = (chunk, isError) => {
      if (isError) stderr += chunk.toString(); else stdout += chunk.toString();
      if (stdout.length + stderr.length > 8 * 1024 * 1024) { limitReached = true; child.kill('SIGTERM'); }
    };
    child.stdout.on('data', chunk => collect(chunk, false)); child.stderr.on('data', chunk => collect(chunk, true));
    child.on('error', () => { clearTimeout(timeout); reject(new Error(`${commandDescription(args)} could not start.`)); });
    child.on('close', code => {
      clearTimeout(timeout);
      if (code !== 0 || limitReached) {
        // Do not forward provider responses or command output; they may contain sensitive data.
        const permission = /not authorized|unauthorized|authentication|permission|10000|9109/i.test(stdout + stderr);
        reject(new Error(`${commandDescription(args)} failed.${permission ? ' Check the selected build token has the required account permissions, including D1 Edit.' : ' Review the Cloudflare account setup and retry this build.'}`));
      } else resolve({ stdout });
    });
  });
}

export async function deployCloudflare({ cwd = ROOT, env = process.env, runWrangler = executeWrangler, api: suppliedApi, configureAccess, log = console.log, checkOnly = false } = {}) {
  let source;
  try { source = JSON.parse(await readFile(path.join(cwd, 'wrangler.jsonc'), 'utf8')); } catch { throw new Error('The source Wrangler configuration must be valid JSON.'); }
  const plan = deploymentPlan(source, env);
  if (checkOnly) { log(`BTS deployment plan: ${plan.steps.join(' → ')}. No remote requests were made.`); return plan; }
  const childEnv = { ...env, CLOUDFLARE_ACCOUNT_ID: DEPLOY_TARGET.accountId };
  const invoke = args => runWrangler(args, { cwd, env: childEnv });
  let token = env.CLOUDFLARE_API_TOKEN || env.CF_API_TOKEN;
  if (!token) {
    // Wrangler 4.163's JSON auth command writes directly to captured stdout, not its debug log.
    // Do not print, persist, or forward this response.
    let credentials;
    try { credentials = JSON.parse((await invoke(['auth', 'token', '--json'])).stdout); }
    catch { throw new Error('Cloudflare deployment credentials are unavailable. Select the BTS API token in Workers → Settings → Build. If needed, add it only as a Cloudflare build secret named CLOUDFLARE_API_TOKEN.'); }
    if (!['api_token', 'oauth'].includes(credentials?.type) || typeof credentials.token !== 'string' || !credentials.token) {
      throw new Error('Use the scoped BTS API token for deployment. Global API key authentication is not supported by this setup.');
    }
    token = credentials.token;
  }
  const api = suppliedApi || createCloudflareApi({ token });
  const configPath = path.join(cwd, DEPLOY_TARGET.runtimeConfig);
  let createdConfig = false;
  try {
    log('Checking access to the dedicated BTS database…');
    let database = selectDatabase((await invoke(['d1', 'list', '--json'])).stdout, source);
    const configure = configureAccess || (await import('./cloudflare-access.mjs')).configureOwnerAccess;
    log('Configuring owner-only sign-in on breakingthesky.com…');
    const identity = await configure({ api, accountId: DEPLOY_TARGET.accountId, hostname: DEPLOY_TARGET.hostname, ownerEmail: DEPLOY_TARGET.ownerEmail, ownerEmails: [...DEPLOY_TARGET.ownerEmails] });
    if (!database) {
      log('Creating the dedicated bts-site database…');
      await invoke(['d1', 'create', DEPLOY_TARGET.databaseName, '--binding', DEPLOY_TARGET.binding, '--update-config=false']);
      database = selectDatabase((await invoke(['d1', 'list', '--json'])).stdout, source);
      if (!database) throw new Error('Cloudflare did not confirm creation of the BTS database. Deployment stopped.');
    }
    const options = { databaseId: database.uuid, teamDomain: identity.teamDomain, audience: identity.audience };
    const serialize = ready => {
      const text = JSON.stringify(runtimeConfiguration(source, { ...options, ready }), null, 2) + '\n';
      if (text.includes(token)) throw new Error('A deployment credential must never appear in the runtime configuration.');
      return text;
    };
    await writeFile(configPath, serialize(false), { flag: 'wx', mode: 0o600 }); createdConfig = true;
    log('Applying BTS database migrations…');
    await invoke(['d1', 'migrations', 'apply', DEPLOY_TARGET.databaseName, '--remote', '--config', configPath]);
    await writeFile(configPath, serialize(true), { mode: 0o600 });
    log('Deploying the website, saved content, and private application inbox…');
    await invoke(['deploy', '--config', configPath]);
    log('Cloudflare deployment completed: https://breakingthesky.com. Decision email sending still requires its separate email-sender connection.');
    return { databaseId: database.uuid, teamDomain: identity.teamDomain, audience: identity.audience, appId: identity.appId, hostname: DEPLOY_TARGET.hostname };
  } finally {
    if (createdConfig) await rm(configPath, { force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const arguments_ = process.argv.slice(2);
  if (arguments_.some(argument => argument !== '--check')) { console.error('Usage: npm run deploy -- [--check]'); process.exitCode = 1; }
  else deployCloudflare({ checkOnly: arguments_.includes('--check') }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
