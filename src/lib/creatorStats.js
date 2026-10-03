// Creator stats data layer — talks to the checker's /creator-stats endpoints
// (watch-duration stats + Hive engagement + GeoLite2 demographics).
// NOTE: deliberately NOT named "analytics" — ad-blockers/privacy extensions
// block requests matching that word (filename AND URL path), which broke the
// whole app for users with such extensions. Keep this name generic.
import { CHECKER_URL } from '../utils/config';
import { formatTimeAgo, formatNumber } from '../i18n';

async function get(path) {
  const r = await fetch(`${CHECKER_URL}${path}`);
  if (!r.ok) throw new Error(`analytics ${path} → ${r.status}`);
  const data = await r.json();
  if (data && data.success === false) throw new Error(data.error || 'analytics error');
  return data;
}

function qs(username, { days, content } = {}) {
  let s = `username=${encodeURIComponent(username)}`;
  if (days) s += `&days=${days}`;
  if (content && content !== 'all') s += `&content=${content}`;
  return s;
}

// Totals + metrics + best-performing videos. opts: { days, content }.
export function fetchCreatorOverview(username, opts) {
  return get(`/creator-stats/overview?${qs(username, opts)}`);
}

// Daily watch-time / views trend. opts: { days, content }.
export function fetchCreatorTimeseries(username, opts) {
  return get(`/creator-stats/timeseries?${qs(username, opts)}`);
}

// Per-video detail: retention curve + most-replayed buckets + stats.
export function fetchVideoAnalytics(username, permlink) {
  return get(`/creator-stats/video?username=${encodeURIComponent(username)}&permlink=${encodeURIComponent(permlink)}`);
}

// Lightweight check: does this video have any watch records? (gates the Stats button)
export function fetchVideoHasStats(username, permlink) {
  return get(`/creator-stats/has-data?username=${encodeURIComponent(username)}&permlink=${encodeURIComponent(permlink)}`);
}

// Viewer demographics (country / device / browser / time-of-day / new-vs-returning).
export function fetchCreatorDemographics(username, opts) {
  return get(`/creator-stats/demographics?${qs(username, opts)}`);
}

// ── formatting helpers ────────────────────────────────────────────────────
export function fmtDuration(totalSeconds) {
  const s = Math.max(0, Math.round(Number(totalSeconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

// Compact "time ago" for a post date (Hive timestamps have no timezone → treat as UTC).
export function timeAgo(dateString) {
  if (!dateString) return '';
  const hasTz = /[Zz]|[+-]\d{2}:\d{2}$/.test(dateString);
  return formatTimeAgo(hasTz ? dateString : `${dateString}Z`, { style: 'narrow' });
}

export function fmtCount(n) {
  return formatNumber(n, { compact: true });
}

// ISO 3166-1 alpha-2 → flag emoji (for the demographics list).
export function countryFlag(code) {
  if (!code || code.length !== 2) return '🌐';
  return code.toUpperCase().replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));
}

// Approx country centroids [lat, lng] for the world bubble map. Countries not
// listed still appear in the country bars, just without a bubble.
export const COUNTRY_CENTROIDS = {
  US: [39.8, -98.6], CA: [56.1, -106.3], MX: [23.6, -102.6], BR: [-14.2, -51.9], AR: [-38.4, -63.6],
  CO: [4.6, -74.3], CL: [-35.7, -71.5], PE: [-9.2, -75.0], VE: [6.4, -66.6], EC: [-1.8, -78.2],
  GB: [55.4, -3.4], IE: [53.4, -8.2], FR: [46.2, 2.2], ES: [40.5, -3.7], PT: [39.4, -8.2],
  DE: [51.2, 10.4], NL: [52.1, 5.3], BE: [50.5, 4.5], CH: [46.8, 8.2], AT: [47.5, 14.6],
  IT: [41.9, 12.6], PL: [51.9, 19.1], CZ: [49.8, 15.5], SE: [60.1, 18.6], NO: [60.5, 8.5],
  FI: [61.9, 25.7], DK: [56.3, 9.5], RU: [61.5, 105.3], UA: [48.4, 31.2], RO: [45.9, 24.9],
  GR: [39.1, 21.8], HU: [47.2, 19.5], TR: [39.0, 35.2], IL: [31.0, 34.9], AE: [23.4, 53.8],
  SA: [23.9, 45.1], EG: [26.8, 30.8], NG: [9.1, 8.7], ZA: [-30.6, 22.9], KE: [-0.0, 37.9],
  GH: [7.9, -1.0], MA: [31.8, -7.1], DZ: [28.0, 1.7], IN: [22.4, 78.7], PK: [30.4, 69.3],
  BD: [23.7, 90.4], CN: [35.9, 104.2], JP: [36.2, 138.3], KR: [35.9, 127.8], TW: [23.7, 121.0],
  HK: [22.3, 114.2], TH: [15.9, 100.99], VN: [14.1, 108.3], PH: [12.9, 121.8], ID: [-0.8, 113.9],
  MY: [4.2, 101.98], SG: [1.35, 103.8], AU: [-25.3, 133.8], NZ: [-40.9, 174.9],
};
export function countryLatLng(code) {
  return code ? COUNTRY_CENTROIDS[code.toUpperCase()] || null : null;
}

// Best-effort English country name.
let _regionNames = null;
export function countryName(code) {
  if (!code) return 'Unknown';
  try {
    if (!_regionNames) _regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
    return _regionNames.of(code.toUpperCase()) || code;
  } catch { return code; }
}
