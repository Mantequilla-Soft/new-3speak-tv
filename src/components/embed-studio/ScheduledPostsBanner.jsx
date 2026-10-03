import React, { useEffect, useState } from 'react';
import axios from 'axios';
import './ScheduledPostsBanner.scss';
import { useTranslation, Trans } from 'react-i18next';

const CHECKER_BASE =
  import.meta.env.VITE_SCHEDULED_POSTS_API_URL || 'https://prod-checker.okinoko.io';

function fmtWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

/**
 * Render the logged-in user's scheduled posts as a banner above their video list.
 * Only renders anything when there's at least one entry with status === 'scheduled'.
 * @param {{ username: string }} props
 */
export default function ScheduledPostsBanner({ username }) {
  const { t } = useTranslation();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!username) {
      setItems([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    axios
      .get(`${CHECKER_BASE.replace(/\/$/, '')}/scheduled-posts/${encodeURIComponent(username)}`, {
        params: { status: 'scheduled', limit: 50 },
      })
      .then((res) => {
        if (cancelled) return;
        setItems(Array.isArray(res.data?.scheduled_posts) ? res.data.scheduled_posts : []);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn('ScheduledPostsBanner fetch failed:', err);
        setError(err?.message || 'Failed to load scheduled posts');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [username]);

  if (loading && items.length === 0) return null; // first load — keep UI quiet
  if (error && items.length === 0) return null;   // fail-quiet; logged to console
  if (items.length === 0) return null;

  return (
    <div className="scheduled-posts-banner">
      <h3 className="scheduled-posts-banner__title">
        {t('upload.scheduled.bannerTitle')} <span className="scheduled-posts-banner__count">({items.length})</span>
      </h3>
      <div className="scheduled-posts-banner__list">
        {items.map((p) => (
          <div key={p.id || `${p.owner}/${p.permlink}`} className="scheduled-posts-banner__item">
            {p.thumbnail ? (
              <img className="scheduled-posts-banner__thumb" src={p.thumbnail} alt="" />
            ) : (
              <div className="scheduled-posts-banner__thumb scheduled-posts-banner__thumb--placeholder" />
            )}
            <div className="scheduled-posts-banner__meta">
              <div className="scheduled-posts-banner__heading">{p.title || t('upload.scheduled.untitled')}</div>
              <div className="scheduled-posts-banner__when">
                <Trans i18nKey="upload.scheduled.scheduledOn" values={{ when: fmtWhen(p.scheduledOn) }} components={{ b: <strong /> }} />
              </div>
              {p.description ? (
                <div className="scheduled-posts-banner__desc">{p.description}</div>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
