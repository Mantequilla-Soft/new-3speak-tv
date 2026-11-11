import { DATE_FILTERS } from '../../utils/dateFilters';
import { useTranslation } from 'react-i18next';
import { Icon } from '../v2/Icon';
import './FeedToolbar.scss';

const DEFAULT_TABS = [
  { key: 'all', labelKey: 'feeds.tabs.all' },
  { key: 'videos', labelKey: 'feeds.tabs.videos' },
  { key: 'shorts', labelKey: 'feeds.tabs.shorts' },
];

// The glyph for each content type (19c / 34b)
const TAB_ICONS = { all: 'apps', videos: 'smart_display', shorts: 'view_day', audio: 'graphic_eq' };

export function Pagination({ page, totalPages, onPageChange }) {
  const { t } = useTranslation();
  if (totalPages <= 1) return null;

  const maxVisible = 5;
  let start = Math.max(1, page - Math.floor(maxVisible / 2));
  let end = Math.min(totalPages, start + maxVisible - 1);
  if (end - start < maxVisible - 1) {
    start = Math.max(1, end - maxVisible + 1);
  }

  const pages = [];
  for (let i = start; i <= end; i++) {
    pages.push(i);
  }

  return (
    <nav className="feed-pagination">
      <button type="button" className="page-btn page-btn--arrow" disabled={page === 1} onClick={() => onPageChange(page - 1)} aria-label={t('common.actions.back')}>
        <Icon name="chevron_left" size={18} />
      </button>
      {start > 1 && (
        <>
          <button type="button" className="page-btn" onClick={() => onPageChange(1)}>1</button>
          {start > 2 && <span className="page-ellipsis">…</span>}
        </>
      )}
      {pages.map(p => (
        <button
          key={p}
          type="button"
          className={`page-btn ${p === page ? 'active' : ''}`}
          aria-current={p === page ? 'page' : undefined}
          onClick={() => onPageChange(p)}
        >
          {p}
        </button>
      ))}
      {end < totalPages && (
        <>
          {end < totalPages - 1 && <span className="page-ellipsis">…</span>}
          <button type="button" className="page-btn" onClick={() => onPageChange(totalPages)}>{totalPages}</button>
        </>
      )}
      <button type="button" className="page-btn page-btn--arrow" disabled={page === totalPages} onClick={() => onPageChange(page + 1)} aria-label={t('common.actions.next')}>
        <Icon name="chevron_right" size={18} />
      </button>
    </nav>
  );
}

// The feed toolbar (19c): a surface card with the content types as chips (the
// selected one in ink), the date range as a segmented track, and the pages.
export function FeedToolbar({ activeTab, onTabChange, dateFilter, onDateFilterChange, tabs = DEFAULT_TABS, page, totalPages, onPageChange }) {
  const { t } = useTranslation();
  return (
    <div className="feed-toolbar-wrap">
      <div className="feed-toolbar-tabs" role="tablist">
        {tabs.map(tab => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.key}
            className={`tab-btn ${activeTab === tab.key ? 'active' : ''}`}
            onClick={() => onTabChange(tab.key)}
          >
            {TAB_ICONS[tab.key] && <Icon name={TAB_ICONS[tab.key]} size={18} />}
            <span>{tab.labelKey ? t(tab.labelKey) : tab.label}</span>
          </button>
        ))}
      </div>
      <div className="feed-toolbar-right">
        <div className="feed-toolbar-date-filters v2-seg" role="group">
          {DATE_FILTERS.map(f => (
            <button
              key={f.key}
              type="button"
              aria-pressed={dateFilter === f.key}
              className={`date-filter-btn v2-seg__opt h32${dateFilter === f.key ? ' active is-on' : ''}`}
              onClick={() => onDateFilterChange(f.key)}
            >
              {t(f.labelKey)}
            </button>
          ))}
        </div>
        {page != null && totalPages != null && (
          <Pagination page={page} totalPages={totalPages} onPageChange={onPageChange} />
        )}
      </div>
    </div>
  );
}

export default FeedToolbar;
