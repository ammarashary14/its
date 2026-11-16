import { authorizeOwner } from './auth.js';
import { HttpError, json, failure, requireMethod, requireSameOrigin, readJson } from './http.js';
import { applicationIntakeEnabled, saveApplication, listApplications, emailConfigured, readApplicationSettings, saveApplicationSettings, decideApplication } from './applications-store.js';

export async function publicApplications({ request, env, waitUntil }) {
  try {
    if (request.method === 'GET') return json({ enabled: await applicationIntakeEnabled(env) });
    requireMethod(request, 'POST');
    requireSameOrigin(request);
    return json(await saveApplication(env, await readJson(request, 256 * 1024), { waitUntil }));
  } catch (error) { return failure(error); }
}
export async function ownerApplications({ request, env }) {
  try {
    await authorizeOwner(request, env); requireMethod(request, 'GET');
    return json({ applications: await listApplications(env), canSend: emailConfigured(env), limit: 100 });
  } catch (error) { return failure(error); }
}
export async function ownerApplicationSettings({ request, env }) {
  try {
    await authorizeOwner(request, env);
    if (request.method === 'GET') return json(await readApplicationSettings(env));
    if (request.method !== 'PUT') throw new HttpError(405, 'method_not_allowed', 'This request method is not supported.');
    requireSameOrigin(request);
    return json(await saveApplicationSettings(env, await readJson(request, 64 * 1024)));
  } catch (error) { return failure(error); }
}
export async function ownerApplicationDecision({ request, env }) {
  try {
    const user = await authorizeOwner(request, env); requireMethod(request, 'POST'); requireSameOrigin(request);
    return json(await decideApplication(env, await readJson(request, 64 * 1024), user.email));
  } catch (error) { return failure(error); }
}
