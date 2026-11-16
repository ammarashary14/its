import { authorizeOwner } from './auth.js';
import { json, failure, requireMethod, requireSameOrigin, readJson } from './http.js';
import { tutoringEnabled, saveTutoring, listTutoring } from './tutoring-store.js';

export async function publicTutoring({ request, env, waitUntil }) {
  try {
    if (request.method === 'GET') return json({ enabled: await tutoringEnabled(env) });
    requireMethod(request, 'POST'); requireSameOrigin(request);
    return json(await saveTutoring(env, await readJson(request, 16 * 1024), { waitUntil }));
  } catch (error) { return failure(error); }
}
export async function ownerTutoring({ request, env }) {
  try {
    await authorizeOwner(request, env); requireMethod(request, 'GET');
    return json({ requests: await listTutoring(env), limit: 100 });
  } catch (error) { return failure(error); }
}
