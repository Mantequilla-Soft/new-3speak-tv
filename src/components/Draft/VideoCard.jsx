import "./VideoCard.scss";
import dayjs from "dayjs";
import utc from 'dayjs/plugin/utc';
import { useNavigate } from 'react-router-dom';
import { fixVideoThumbnail } from '../../utils/fixThumbnails';
import fallbackImg from '../../assets/image/speak.jpg';
import { useTranslation } from 'react-i18next';
import { DockTile, StatusPill } from '../v2/ui';
dayjs.extend(utc);

// 1:13 / 1:02:03 for the duration under the title (Roboto Mono).
function fmtLength(sec) {
  const s = Math.round(Number(sec) || 0);
  if (s <= 0) return '';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

// Relative under 7 days, a date after that (STYLE_GUIDE §10).
function fmtWhen(date) {
  if (!date) return '';
  const d = dayjs(date);
  if (!d.isValid()) return '';
  return dayjs().diff(d, 'day') < 7 ? d.fromNow() : d.format('D MMM YYYY');
}

// One row of the Studio list (21d): content as a card, not a table row.
// thumb · title + date and length · status pill · action tiles.
const VideoCard = ({ video, onEdit, onStats }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const handleNavigate = () => {
    navigate(`/@${video?.owner}/${video.permlink ?? "unknown"}`);
  };

  // Status: tone per STYLE_GUIDE §2 (approved = cyan, failed = accent, pending = muted).
  const status = (() => {
    switch (video.status) {
      case 'published':
        return { tone: 'cyan', label: t('upload.drafts.status.published') };
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
  const unlisted = video.unlisted === true || video.listed_on_3speak === false;
  const length = fmtLength(video.duration);
  const when = fmtWhen(video.created_at);
  const published = video.status === 'published';
  const editable = published || video.status === 'scheduled';

  return (
    <article className="studio-row">
      <div className="studio-row__thumb v2-thumb r16">
        <img
          src={fixVideoThumbnail(video)}
          alt=""
          loading="lazy"
          onError={(e) => (e.currentTarget.src = fallbackImg)}
        />
        {length && <span className="v2-media-pill is-br num">{length}</span>}
      </div>

      <div className="studio-row__main">
        <h3 className="studio-row__title" title={video.title || ''}>{video.title || ""}</h3>
        <div className="studio-row__meta">
          {when}
          {when && length && ' · '}
          {length && <span className="num">{length}</span>}
        </div>
        {video.status === 'scheduled' && video.publish_data && (
          <div className="studio-row__when">
            {t('upload.drafts.publishesAt', { date: dayjs(typeof video.publish_data === 'number' ? video.publish_data * 1000 : video.publish_data).format('MMM D, YYYY [at] h:mm A') })}
          </div>
        )}
      </div>

      <div className="studio-row__status">
        <StatusPill tone={status.tone}>{status.label}</StatusPill>
        {unlisted && <StatusPill tone="muted" icon="link">{t('cards.status.unlisted')}</StatusPill>}
      </div>

      <div className="studio-row__acts">
        {editable && (
          <DockTile
            className="studio-row__act"
            icon="edit"
            label={t('common.actions.edit')}
            onClick={() => onEdit(video.id)}
          />
        )}
        {/* Scheduled posts don't have a public URL yet, so only published ones get View and Stats. */}
        {published && (
          <DockTile
            className="studio-row__act"
            icon="visibility"
            label={t('common.actions.view')}
            onClick={handleNavigate}
          />
        )}
        {published && onStats && (
          <DockTile
            className="studio-row__act"
            icon="bar_chart"
            label={t('nav.profile.analytics')}
            onClick={() => onStats(video)}
          />
        )}
      </div>
    </article>
  );
};

export default VideoCard;
