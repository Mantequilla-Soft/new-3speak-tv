import { useState, useRef, useCallback, useEffect } from 'react';
import { Icon } from '../v2/Icon';
import './PullToRefresh.scss';

const THRESHOLD = 70;
const MAX_PULL = 120;

const PullToRefresh = ({ onRefresh, children }) => {
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef(null);
  const containerRef = useRef(null);

  const handleTouchStart = useCallback((e) => {
    if (refreshing) return;
    if (window.scrollY > 5) return; // only trigger at top
    startY.current = e.touches[0].clientY;
  }, [refreshing]);

  const handleTouchMove = useCallback((e) => {
    if (startY.current == null || refreshing) return;
    const dy = e.touches[0].clientY - startY.current;
    if (dy < 0) { startY.current = null; return; }
    // Diminishing pull distance
    const distance = Math.min(dy * 0.5, MAX_PULL);
    setPullDistance(distance);
  }, [refreshing]);

  const handleTouchEnd = useCallback(async () => {
    if (startY.current == null) return;
    startY.current = null;
    if (pullDistance >= THRESHOLD && !refreshing) {
      setRefreshing(true);
      setPullDistance(THRESHOLD);
      try { await onRefresh(); } catch (_) {}
      setRefreshing(false);
    }
    setPullDistance(0);
  }, [pullDistance, refreshing, onRefresh]);

  // Only show on mobile
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.matchMedia('(max-width: 1024px)').matches);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  if (!isMobile) return children;

  return (
    <div
      ref={containerRef}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <div
        className={`ptr-indicator ${refreshing ? 'ptr-refreshing' : ''}`}
        style={{ height: pullDistance > 10 ? pullDistance : 0, opacity: pullDistance > 10 ? Math.min(pullDistance / THRESHOLD, 1) : 0 }}
      >
        <div className={`ptr-spinner ${pullDistance >= THRESHOLD || refreshing ? 'ptr-active' : ''}`}>
          <Icon name={refreshing ? 'progress_activity' : 'refresh'} size={22} />
        </div>
      </div>
      {children}
    </div>
  );
};

export default PullToRefresh;
