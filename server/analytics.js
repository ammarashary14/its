import { HttpError } from './http.js';
import { siteAnalyticsConfigured, loadSiteStats } from './site-analytics.js';

function cloudflareAnalyticsConfigured(env) {
  return Boolean(env.CF_ANALYTICS_API_TOKEN && /^[a-f0-9]{32}$/i.test(String(env.CF_ZONE_ID || '')));
}
export function analyticsConfigured(env) { return cloudflareAnalyticsConfigured(env) || siteAnalyticsConfigured(env); }
function count(value) {
  if (!Number.isFinite(value) || value < 0) throw new Error('Invalid analytics count');
  return value;
}
export async function loadStats(request, env, fetcher = fetch) {
  const input = new URL(request.url).searchParams.get('days') || '7';
  if (!['7', '30'].includes(input)) throw new HttpError(400, 'invalid_period', 'Choose a 7-day or 30-day period.');
  if (!cloudflareAnalyticsConfigured(env)) {
    if (siteAnalyticsConfigured(env)) return loadSiteStats(request, env);
    return { connected: false, reason: 'Website stats are not enabled yet.' };
  }
  const days = Number(input);
  const end = new Date(); end.setUTCHours(0, 0, 0, 0);
  const start = new Date(end); start.setUTCDate(start.getUTCDate() - days);
  const startDate = start.toISOString().slice(0, 10), endDate = end.toISOString().slice(0, 10);
  // The zone ID is restricted to hexadecimal above; dates are generated server-side.
  const query = `query { viewer { zones(filter: { zoneTag: "${env.CF_ZONE_ID}" }) { httpRequests1dGroups(limit: 31, orderBy: [date_ASC], filter: { date_geq: "${startDate}", date_lt: "${endDate}" }) { dimensions { date } sum { requests pageViews bytes } uniq { uniques } } } } }`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetcher('https://api.cloudflare.com/client/v4/graphql', {
      method: 'POST', redirect: 'manual', signal: controller.signal,
      headers: { Authorization: `Bearer ${env.CF_ANALYTICS_API_TOKEN}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query })
    });
    if (!response.ok) throw new Error('Analytics rejected request');
    const result = await response.json();
    if (result.errors?.length || !Array.isArray(result.data?.viewer?.zones) || result.data.viewer.zones.length !== 1) throw new Error('Analytics unavailable');
    const groups = result.data.viewer.zones[0].httpRequests1dGroups;
    if (!Array.isArray(groups) || groups.length > days) throw new Error('Invalid analytics response');
    const daily = groups.map(row => {
      const date = row.dimensions?.date;
      if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date < startDate || date >= endDate) throw new Error('Invalid analytics date');
      return { date, requests: count(row.sum?.requests), pageViews: count(row.sum?.pageViews), bytes: count(row.sum?.bytes), uniqueIPs: count(row.uniq?.uniques) };
    }).sort((a, b) => a.date.localeCompare(b.date));
    if (new Set(daily.map(row => row.date)).size !== daily.length) throw new Error('Duplicate analytics dates');
    const totals = daily.reduce((sum, row) => ({ requests: sum.requests + row.requests, pageViews: sum.pageViews + row.pageViews, bytes: sum.bytes + row.bytes }), { requests: 0, pageViews: 0, bytes: 0 });
    return { connected: true, days, totals, daily, period: { start: startDate, end: endDate, timeZone: 'UTC', endExclusive: true }, source: 'Cloudflare zone traffic', updatedAt: new Date().toISOString() };
  } catch { throw new HttpError(502, 'analytics_unavailable', 'Cloudflare traffic stats could not be loaded. Check the analytics connection and try again.'); }
  finally { clearTimeout(timer); }
}
