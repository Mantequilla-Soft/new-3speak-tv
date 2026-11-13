import "./VideoCard.scss";
import { useEffect, useRef, useState } from 'react';
import dayjs from "dayjs";
import utc from 'dayjs/plugin/utc';
import { useNavigate } from 'react-router-dom';
import { fixVideoThumbnail } from '../../utils/fixThumbnails';
import fallbackImg from '../../assets/image/speak.jpg';
import { useTranslation } from 'react-i18next';
import { DockTile, Menu, MenuRow } from '../v2/ui';
import { useEscapeLayer } from '../../hooks/useDialog';
import { fmtCount } from '../../lib/creatorStats';
import { toastIn } from '../../utils/toast';
dayjs.extend(utc);

const toast = toastIn('Video');

// 1:13 / 1:02:03 for the duration next to the date.
function fmtLength(sec) {
  const s = Math.round(Number(sec) || 0);
  if (s <= 0) return '';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

// Relative under 7 days, a date after that (STYLE_GUIDE §10): "Oct 20".
function fmtWhen(date) {
  if (!date) return '';
  const d = dayjs(date);
  if (!d.isValid()) return '';
  if (dayjs().diff(d, 'day') < 7) return d.fromNow();
  return d.format(d.year() === dayjs().year() ? 'MMM D' : 'MMM D, YYYY');
}

// One row of the Studio list (21d): content as a card, not a table row.
// thumb 160 · title + date · status · views · Edit / Stats / More tiles.
// `views`: views in the last 28 days (null while unknown or not published).
const VideoCard = ({ video, onEdit, onStats, views = null }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const moreRef = useRef(null);
  const menuRef = useRef(null);
  const watchPath = `/@${video?.owner}/${video.permlink ?? "unknown"}`;

  useEscapeLayer(menuRef, () => setMenuOpen(false), { active: menuOpen });
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onDown = (e) => {
      if (moreRef.current?.contains(e.target) || menuRef.current?.contains(e.target)) return;
      setMenuOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [menuOpen]);

  const unlisted = video.unlisted === true || video.listed_on_3speak === false;
  // Status tone per STYLE_GUIDE §2: live/public = cyan, failed or busy = accent, the rest muted.
  const status = (() => {
    switch (video.status) {
      case 'published':
        return unlisted
          ? { tone: 'muted', label: t('cards.status.unlisted') }
          : { tone: 'cyan', label: t('studio.drafts.public') };
      case 'scheduled':
        return { tone: 'muted', label: t('upload.drafts.status.scheduled') };
      case 'failed':
      case 'publish_manual':
        return { tone: 'accent', label: t('upload.drafts.status.failed') };
      case 'draft':
        return { tone: 'muted', label: t('cards.status.draft') };
      case 'deleted':
        return { tone: 'muted', label: t('cards.status.deleted') };
      case 'encoding':
      case 'processing':
      case 'uploaded':
        return { tone: 'accent', label: t('cards.status.processing') };
      default:
        return { tone: 'muted', label: video.status };
    }
  })();
  const length = fmtLength(video.duration);
  const when = fmtWhen(video.created_at);
  const published = video.status === 'published';
  const editable = published || video.status === 'scheduled';

  const copyLink = async () => {
    setMenuOpen(false);
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${watchPath}`);
      toast.success(t('common.actions.copied'));
    } catch { /* clipboard blocked: nothing to undo */ }
  };

  return (
    <article className="studio-row">
      <div className="studio-row__thumb v2-thumb r16">
        <img
          src={fixVideoThumbnail(video)}
          alt=""
          loading="lazy"
          onError={(e) => (e.currentTarget.src = fallbackImg)}
        />
      </div>

      <div className="studio-row__main">
        <h3 className="studio-row__title" title={video.title || ''}>{video.title || ""}</h3>
        <div className="studio-row__meta">
          {when}
          {when && length && ' · '}
          {length}
        </div>
        {video.status === 'scheduled' && video.publish_data && (
          <div className="studio-row__when">
            {t('upload.drafts.publishesAt', { date: dayjs(typeof video.publish_data === 'number' ? video.publish_data * 1000 : video.publish_data).format('MMM D, YYYY [at] h:mm A') })}
          </div>
        )}
      </div>

      <span className={`studio-row__status is-${status.tone}`}>{status.label}</span>

      <div className="studio-row__views">
        <b>{published && views != null ? fmtCount(views) : '–'}</b>
        <span>{t('studio.drafts.views')}</span>
      </div>

      <div className="studio-row__acts">
        <DockTile
          className="studio-row__act"
          icon="edit"
          iconSize={20}
          label={t('common.actions.edit')}
          disabled={!editable}
          onClick={() => onEdit(video.id)}
        />
        {/* Scheduled posts don't have a public URL yet, so only published ones get Stats and View. */}
        <DockTile
          className="studio-row__act"
          icon="bar_chart"
          iconSize={20}
          label={t('studio.drafts.stats')}
          disabled={!published || !onStats}
          onClick={() => onStats?.(video)}
        />
        <div className="studio-row__more" ref={moreRef}>
          <DockTile
            className="studio-row__act"
            icon="more_horiz"
            iconSize={20}
            label={t('studio.drafts.more')}
            disabled={!published}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
          />
          {menuOpen && (
            <Menu className="studio-row__menu" ref={menuRef}>
              <MenuRow icon="visibility" onClick={() => { setMenuOpen(false); navigate(watchPath); }}>
                {t('common.actions.view')}
              </MenuRow>
              <MenuRow icon="link" onClick={copyLink}>
                {t('common.actions.copyLink')}
              </MenuRow>
            </Menu>
          )}
        </div>
      </div>
    </article>
  );
};

export default VideoCard;
