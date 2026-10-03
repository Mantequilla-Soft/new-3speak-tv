import { t, formatTimeAgo, formatDate } from '../i18n';

// labelKey is an i18n key: translate at render with t(f.labelKey).
export const DATE_FILTERS = [
  { key: 'all', labelKey: 'feeds.dateFilters.all' },
  { key: 'today', labelKey: 'feeds.dateFilters.today' },
  { key: 'week', labelKey: 'feeds.dateFilters.week' },
  { key: 'month', labelKey: 'feeds.dateFilters.month' },
];

export function getSinceTimestamp(filterKey) {
  if (filterKey === 'all') return 0;
  const now = new Date();
  if (filterKey === 'today') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.floor(start.getTime() / 1000);
  }
  if (filterKey === 'week') {
    const day = now.getDay();
    const diff = day === 0 ? 6 : day - 1; // Monday as start of week
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - diff);
    return Math.floor(start.getTime() / 1000);
  }
  if (filterKey === 'month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return Math.floor(start.getTime() / 1000);
  }
  return 0;
}

export function formatRelativeDate(timestamp) {
  if (!timestamp) return '';
  const date = new Date(typeof timestamp === 'number' && timestamp < 1e12 ? timestamp * 1000 : timestamp);
  const now = new Date();
  const diffMs = now - date;
  const diffMin = Math.floor(diffMs / 60000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return t('feeds.dateFilters.justNow');
  // "3m ago" / "3h ago" / "3d ago" in the current language.
  if (diffDays < 7) return formatTimeAgo(date, { style: 'narrow' });
  return formatDate(date, { month: 'short', day: 'numeric' });
}
