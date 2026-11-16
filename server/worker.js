import { publicContent, ownerSession, ownerContent, ownerPublish, ownerStats } from './owner-api.js';
import { publicApplications, ownerApplications, ownerApplicationSettings, ownerApplicationDecision } from './applications-api.js';
import { json } from './http.js';

// The same authenticated handlers also back the existing Pages Functions.
// Keep API requests out of the static-assets fallback, including unknown routes.
const routes = new Map([
  ['/api/content', publicContent],
  ['/api/owner/session', ownerSession],
  ['/api/owner/content', ownerContent],
  ['/api/owner/publish', ownerPublish],
  ['/api/owner/stats', ownerStats],
  ['/api/applications', publicApplications],
  ['/api/owner/applications', ownerApplications],
  ['/api/owner/application-settings', ownerApplicationSettings],
  ['/api/owner/applications/decision', ownerApplicationDecision]
]);

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    const handler = routes.get(path);
    if (handler) return handler({ request, env });
    if (path === '/api' || path.startsWith('/api/')) {
      return json({ error: 'This API endpoint does not exist.', code: 'not_found' }, 404);
    }
    if (!env.ASSETS?.fetch) {
      return json({ error: 'Website assets are not available.', code: 'assets_not_configured' }, 503);
    }
    return env.ASSETS.fetch(request);
  }
};
