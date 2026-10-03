import { IoChevronBack, IoChevronForward } from 'react-icons/io5';
import { DATE_FILTERS } from '../../utils/dateFilters';
import { useTranslation } from 'react-i18next';
import './FeedToolbar.scss';

const DEFAULT_TABS = [
  { key: 'all', labelKey: 'feeds.tabs.all' },
  { key: 'videos', labelKey: 'feeds.tabs.videos' },
  { key: 'shorts', labelKey: 'feeds.tabs.shorts' },
];

// DATE_FILTERS (utils/dateFilters) carries English labels; translate by key here
// and fall back to its label for any key not listed.
const DATE_FILTER_KEYS = {
  all: 'feeds.dateFilters.all',
  today: 'feeds.dateFilters.today',
  week: 'feeds.dateFilters.week',
  month: 'feeds.dateFilters.month',
};

export function Pagination({ page, totalPages, onPageChange }) {
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
    <div className="feed-pagination">
      <button type="button" className="page-btn" disabled={page === 1} onClick={() => onPageChange(page - 1)}>
        <IoChevronBack />
      </button>
      {start > 1 && (
        <>
          <button type="button" className="page-btn" onClick={() => onPageChange(1)}>1</button>
          {start > 2 && <span className="page-ellipsis">...</span>}
        </>
      )}
      {pages.map(p => (
        <button
          key={p}
          type="button"
          className={`page-btn ${p === page ? 'active' : ''}`}
          onClick={() => onPageChange(p)}
        >
          {p}
        </button>
      ))}
      {end < totalPages && (
        <>
          {end < totalPages - 1 && <span className="page-ellipsis">...</span>}
          <button type="button" className="page-btn" onClick={() => onPageChange(totalPages)}>{totalPages}</button>
        </>
      )}
      <button type="button" className="page-btn" disabled={page === totalPages} onClick={() => onPageChange(page + 1)}>
        <IoChevronForward />
      </button>
    </div>
  );
}

export function FeedToolbar({ activeTab, onTabChange, dateFilter, onDateFilterChange, tabs = DEFAULT_TABS, page, totalPages, onPageChange }) {
  const { t } = useTranslation();
  return (
    <div className="feed-toolbar-wrap">
      <div className="feed-toolbar-tabs">
        {tabs.map(tab => (
          <button
            key={tab.key}
            className={`tab-btn ${activeTab === tab.key ? 'active' : ''}`}
            onClick={() => onTabChange(tab.key)}
          >
            {tab.labelKey ? t(tab.labelKey) : tab.label}
          </button>
        ))}
      </div>
      <div className="feed-toolbar-right">
        <div className="feed-toolbar-date-filters">
          {DATE_FILTERS.map(f => (
            <button
              key={f.key}
              className={`date-filter-btn ${dateFilter === f.key ? 'active' : ''}`}
              onClick={() => onDateFilterChange(f.key)}
            >
              {f.labelKey ? t(f.labelKey) : DATE_FILTER_KEYS[f.key] ? t(DATE_FILTER_KEYS[f.key]) : f.label}
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
