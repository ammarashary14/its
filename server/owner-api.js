import { authorizeOwner } from './auth.js';
import { readContent, publishContent } from './content-store.js';
import { analyticsConfigured, loadStats } from './analytics.js';
import { json, failure, requireMethod, requireSameOrigin, readJson } from './http.js';

export async function publicContent({ request, env }) {
  try { requireMethod(request, 'GET'); return json(await readContent(env, { publicView: true })); }
  catch (error) { return failure(error); }
}
export async function ownerSession({ request, env }) {
  try {
    const user = await authorizeOwner(request, env);
    requireMethod(request, 'GET');
    return json({ owner: true, email: user.email, analyticsConfigured: analyticsConfigured(env) });
  } catch (error) { return failure(error); }
}
export async function ownerContent({ request, env }) {
  try { await authorizeOwner(request, env); requireMethod(request, 'GET'); return json(await readContent(env)); }
  catch (error) { return failure(error); }
}
export async function ownerPublish({ request, env }) {
  try {
    await authorizeOwner(request, env);
    requireMethod(request, 'POST'); requireSameOrigin(request);
    return json(await publishContent(env, await readJson(request)));
  } catch (error) { return failure(error); }
}
export async function ownerStats({ request, env }) {
  try { await authorizeOwner(request, env); requireMethod(request, 'GET'); return json(await loadStats(request, env)); }
  catch (error) {
    if (error?.code === 'analytics_unavailable') return json({ connected: false, reason: error.message, code: error.code }, error.status);
    return failure(error);
  }
}
