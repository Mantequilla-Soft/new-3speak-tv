import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import './InfiniteSentinel.scss';

// Bottom-of-list sentinel: fires onLoadMore when it scrolls into view (600px
// early) so the next page is fetched before the user hits the actual end. A
// hidden list (display: none) never intersects, so it never loads.
export default function InfiniteSentinel({ hasMore, loading, onLoadMore }) {
  const { t } = useTranslation();
  const ref = useRef(null);
  useEffect(() => {
    if (!hasMore) return undefined;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && !loading) onLoadMore();
    }, { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loading, onLoadMore]);
  if (!hasMore) return null;
  return <div ref={ref} className="infinite-sentinel">{loading && <span className="infinite-sentinel__loading">{t('feeds.loadingMore')}</span>}</div>;
}
