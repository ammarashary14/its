import { HttpError, json, failure, requireMethod, requireSameOrigin, readJson } from './http.js';

const PUBLIC_PATHS = new Set(['/', '/curriculum', '/team', '/tutoring', '/community', '/contact', '/apply', '/schools', '/sponsors', '/donate']);
export function siteAnalyticsConfigured(env) {
  return env.BTS_SITE_ANALYTICS_ENABLED === 'true' && typeof env.BTS_DB?.prepare === 'function';
}
function unavailable() {
  return new HttpError(503, 'analytics_unavailable', 'Website stats could not be loaded or recorded. Check the database connection and analytics migration.');
}
function database(env) {
  if (!siteAnalyticsConfigured(env)) throw new HttpError(503, 'analytics_not_configured', 'Website stats are not enabled yet.');
  return env.BTS_DB;
}
export function normalizePublicPath(value) {
  if (typeof value !== 'string' || value.length > 30 || !value.startsWith('/') || /[?#%\\\s]/.test(value)) {
    throw new HttpError(400, 'invalid_page', 'Choose a public website page.');
  }
  const path = value === '/index' || value === '/index.html' ? '/' : value.replace(/\.html$/, '');
  if (!PUBLIC_PATHS.has(path)) throw new HttpError(400, 'invalid_page', 'Choose a public website page.');
  return path;
}
export async function recordPageView(env, rawPath, now = new Date()) {
  const path = normalizePublicPath(rawPath);
  const day = now.toISOString().slice(0, 10);
  const db = database(env);
  try {
    // This aggregate is the complete event record. No request identifiers or
    // visitor metadata are read or retained, and each accepted event adds one.
    const result = await db.prepare('INSERT INTO site_page_views (day, path, page_views) VALUES (?, ?, 1) ON CONFLICT(day, path) DO UPDATE SET page_views = site_page_views.page_views + 1').bind(day, path).run();
    if (result?.success !== true || result?.meta?.changes !== 1) throw new Error('Write failed');
  } catch { throw unavailable(); }
}
export async function pageView({ request, env }) {
  try {
    requireMethod(request, 'POST'); requireSameOrigin(request);
    const input = await readJson(request, 1024);
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 1 || !Object.hasOwn(input, 'path')) {
      throw new HttpError(400, 'invalid_page', 'Send only the public page path.');
    }
    await recordPageView(env, input.path);
    return json({ success: true });
  } catch (error) { return failure(error); }
}
function validCount(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid aggregate count');
  return value;
}
function rows(result) {
  if (result?.success !== true || !Array.isArray(result.results)) throw new Error('Read failed');
  return result.results;
}
export async function loadSiteStats(request, env, now = new Date()) {
  const input = new URL(request.url).searchParams.get('days') || '7';
  if (!['7', '30'].includes(input)) throw new HttpError(400, 'invalid_period', 'Choose a 7-day or 30-day period.');
  const db = database(env);
  const days = Number(input);
  const end = new Date(now); end.setUTCHours(0, 0, 0, 0);
  const start = new Date(end); start.setUTCDate(start.getUTCDate() - days + 1);
  const afterEnd = new Date(end); afterEnd.setUTCDate(afterEnd.getUTCDate() + 1);
  const startDate = start.toISOString().slice(0, 10), endDate = end.toISOString().slice(0, 10);
  const daily = [];
  for (let index = 0; index < days; index++) {
    const day = new Date(start); day.setUTCDate(day.getUTCDate() + index);
    daily.push({ date: day.toISOString().slice(0, 10), pageViews: 0, applications: 0 });
  }
  const byDay = new Map(daily.map(value => [value.date, value]));
  try {
    const [viewResult, applicationResult] = await Promise.all([
      db.prepare('SELECT day, path, page_views FROM site_page_views WHERE day >= ? AND day <= ? ORDER BY day ASC, path ASC').bind(startDate, endDate).all(),
      // Only counts leave the applications table. No names, email addresses,
      // answers, status details, or other applicant data enter analytics.
      db.prepare('SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS applications FROM applications WHERE created_at >= ? AND created_at < ? GROUP BY substr(created_at, 1, 10) ORDER BY day ASC').bind(start.toISOString(), afterEnd.toISOString()).all()
    ]);
    const viewRows = rows(viewResult), applicationRows = rows(applicationResult);
    if (viewRows.length > days * PUBLIC_PATHS.size || applicationRows.length > days) throw new Error('Invalid aggregate data');
    const pagesByPath = new Map(), seenViews = new Set(), seenApplications = new Set();
    for (const row of viewRows) {
      const day = byDay.get(row.day), key = `${row.day}:${row.path}`;
      if (!day || !PUBLIC_PATHS.has(row.path) || seenViews.has(key)) throw new Error('Invalid aggregate data');
      seenViews.add(key);
      const views = validCount(row.page_views);
      day.pageViews = validCount(day.pageViews + views);
      pagesByPath.set(row.path, validCount((pagesByPath.get(row.path) || 0) + views));
    }
    for (const row of applicationRows) {
      const day = byDay.get(row.day);
      if (!day || seenApplications.has(row.day)) throw new Error('Invalid aggregate data');
      seenApplications.add(row.day); day.applications = validCount(row.applications);
    }
    const pages = [...pagesByPath].filter(([, pageViews]) => pageViews > 0).map(([path, pageViews]) => ({ path, pageViews })).sort((a, b) => b.pageViews - a.pageViews || a.path.localeCompare(b.path));
    const totals = daily.reduce((sum, row) => ({
      pageViews: validCount(sum.pageViews + row.pageViews), applications: validCount(sum.applications + row.applications), activePages: pages.length
    }), { pageViews: 0, applications: 0, activePages: pages.length });
    return {
      connected: true, provider: 'site', days, totals, daily, pages,
      period: { start: startDate, end: endDate, timeZone: 'UTC', endExclusive: false },
      source: 'BTS website page views', updatedAt: now.toISOString()
    };
  } catch { throw unavailable(); }
}
