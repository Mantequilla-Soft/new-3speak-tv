// The watch page's v2 panels (02, 22b, 33a): supporters and voters, chapter
// cards, the up-next list and the media states over the player. Kept out of
// PlayVideo so that file stays about wiring, and so the side panel (narrow) and
// the card beside the description (wide) draw the same rows.
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import AccountImg from '../HiveAvatar/AccountImg';
import { Icon } from '../v2/Icon';
import { cx } from '../v2/helpers';
import { useSupporters, formatSupportTotal } from '../../lib/supports';
import { useRewardDisplay } from '../../utils/hivePrice';
import { formatTimeAgo } from '../../i18n';
import { fixVideoThumbnail, fallbackImg } from '../../utils/fixThumbnails';

export const compactNumber = (n) => {
  const v = Number(n) || 0;
  try { return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(v); } catch { return String(v); }
};

export const clockTime = (sec) => {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
};

// Hive answers vote times in UTC without the zone mark.
const hiveDate = (s) => (s ? new Date(String(s).endsWith('Z') ? s : `${s}Z`) : null);

/**
 * The creator's biggest supporters. `avatars` (02): a wrap of 40px avatars, the
 * top one ringed in accent and the next two in cyan; name and total in the
 * tooltip. Otherwise (22b): rank, avatar, name, total.
 */
export function SupportersPane({ author, avatars = false }) {
  const { t } = useTranslation();
  const { data, isLoading } = useSupporters(author);
  const list = data?.supporters || [];
  if (isLoading) return <div className="wv2-rows is-loading" aria-busy="true"><span className="v2-skeleton is-line" /><span className="v2-skeleton is-line" /></div>;
  if (!list.length) return <p className="wv2-pane-empty">{t('profile.supports.emptyReceived', { user: author })}</p>;
  if (avatars) {
    return (
      <ol className="wv2-supporter-grid">
        {list.map((s, i) => {
          const amount = formatSupportTotal(s.hbd_total, s.sats_total);
          const name = s.tipper;
          const label = `${name ? `@${name}` : t('profile.supports.lightningSupporter')} · ${amount}`;
          const ring = i === 0 ? 'is-top' : i < 3 ? 'is-next' : '';
          return (
            <li key={name || `lightning-${i}`}>
              {name ? (
                <Link to={`/@${name}`} className={cx('wv2-supporter-dot', ring)} title={label} aria-label={label}>
                  <AccountImg account={name} alt="" loading="lazy" />
                </Link>
              ) : (
                <span className={cx('wv2-supporter-dot is-bolt', ring)} title={label} aria-label={label} role="img">
                  <Icon name="bolt" size={18} />
                </span>
              )}
            </li>
          );
        })}
      </ol>
    );
  }
  return (
    <ol className="wv2-rows wv2-supporters">
      {list.map((s, i) => {
        const amount = formatSupportTotal(s.hbd_total, s.sats_total);
        const name = s.tipper;
        return (
          <li key={name || `lightning-${i}`} className="wv2-supporter">
            <span className={cx('wv2-supporter__rank', i === 0 && 'is-top')}>{i + 1}</span>
            {name
              ? <AccountImg account={name} alt="" loading="lazy" className="wv2-supporter__avatar" />
              : <span className="wv2-supporter__avatar is-bolt"><Icon name="bolt" size={18} /></span>}
            {name
              ? <Link to={`/@${name}`} className="wv2-supporter__name">@{name}</Link>
              : <span className="wv2-supporter__name">{t('profile.supports.lightningSupporter')}</span>}
            <span className="money wv2-supporter__amount">{amount}</span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Who voted and what each vote is worth (02 voters): a summary row (count and
 * total) above rows of avatar, name and age, weight, value. The first value is
 * in accent: it is the biggest.
 */
export function VotersPane({ voters, total, offChain, offChainCount }) {
  const { t } = useTranslation();
  const { label } = useRewardDisplay();
  if (offChain) {
    return (
      <div className="wv2-rows">
        <div className="wv2-voters__sum">
          <b>{t('notifications.cards.voters', { count: offChainCount || 0 })}</b>
        </div>
        <p className="wv2-pane-empty">
          <Icon name="how_to_vote" size={18} />
          <span>{t('watch.actions.voteOffChain')}</span>
        </p>
      </div>
    );
  }
  return (
    <div className="wv2-rows wv2-voters">
      <div className="wv2-voters__sum">
        <b>{t('notifications.cards.voters', { count: voters.length })}</b>
        <span>{t('engagement.payout.total')}</span>
        <b className="money">{label(total || 0)}</b>
      </div>
      {voters.length === 0 ? (
        <p className="wv2-pane-empty">{t('watch.topics.noVotes')}</p>
      ) : (
        <>
          <div className="wv2-voter is-head" aria-hidden="true">
            <span />
            <span>{t('watch.voters.voter')}</span>
            <span className="is-num">{t('watch.voters.weight')}</span>
            <span className="is-num">{t('watch.voters.value')}</span>
          </div>
          {voters.map((v, i) => {
            const at = hiveDate(v.time);
            return (
              <div className="wv2-voter" key={v.username}>
                <AccountImg account={v.username} alt="" loading="lazy" className="wv2-voter__avatar" />
                <span className="wv2-voter__who">
                  <Link to={`/@${v.username}`}>{v.username}</Link>
                  {at && <span>{formatTimeAgo(at, { style: 'narrow' })}</span>}
                </span>
                <span className="wv2-voter__weight num">{v.weight != null ? `${Math.round(v.weight)}%` : ''}</span>
                <b className={cx('wv2-voter__value num', i === 0 && 'is-top')}>{label(v.reward || 0)}</b>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

/** Chapter cards under the player (02): the playing one in cyan. */
export function ChapterCards({ chapters, current, onSeek }) {
  if (!chapters?.length) return null;
  return (
    <div className={cx('wv2-chapters', chapters.length > 4 && 'is-scroll')}>
      {chapters.map((c, i) => (
        <button
          key={`${c.start}-${i}`}
          type="button"
          className={cx('wv2-chapter', i === current && 'is-on')}
          onClick={() => onSeek?.(c.start)}
          aria-current={i === current ? 'true' : undefined}
        >
          <span className="wv2-chapter__thumb" aria-hidden="true" />
          <span className="wv2-chapter__row">
            <span className="wv2-chapter__at num">{clockTime(c.start)}</span>
            <span className="wv2-chapter__title">{c.title}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

/** Chapters as a list (the narrow layout's Chapters tab, and the summary sheet). */
export function ChapterList({ chapters, current, onSeek, className }) {
  if (!chapters?.length) return null;
  return (
    <div className={cx('wv2-chapter-list', className)}>
      {chapters.map((c, i) => (
        <button
          key={`${c.start}-${i}`}
          type="button"
          className={cx('wv2-chapter-row', i === current && 'is-on')}
          onClick={() => onSeek?.(c.start)}
        >
          <span className="wv2-chapter-row__thumb" aria-hidden="true" />
          <span className="wv2-chapter-row__text">
            <span className="wv2-chapter__at num">{clockTime(c.start)}</span>
            <b>{c.title}</b>
          </span>
        </button>
      ))}
    </div>
  );
}

const authorOf = (v) => v?.author?.username || v?.author?.id || v?.author || v?.owner;

/** The narrow layout's Up next tab: compact rows. */
export function UpNextList({ videos }) {
  if (!videos?.length) return null;
  return (
    <div className="wv2-upnext">
      {videos.map((v, i) => {
        const a = authorOf(v);
        const duration = v?.spkvideo?.duration || v?.duration;
        return (
          <Link key={`${a}/${v.permlink}-${i}`} to={`/@${a}/${v.permlink}`} className="wv2-upnext__row">
            <span className="wv2-upnext__thumb">
              <img src={fixVideoThumbnail(v)} alt="" loading="lazy" onError={(e) => { e.currentTarget.src = fallbackImg; }} />
              {duration > 0 && <span className="v2-media-pill is-br num">{clockTime(duration)}</span>}
            </span>
            <span className="wv2-upnext__text">
              <b>{v.title}</b>
              <span>@{a}</span>
            </span>
          </Link>
        );
      })}
    </div>
  );
}

/**
 * A state drawn over the player (33a): media gone, scheduled, a server that did
 * not answer. Icon well in the state's tone, a bold line, what to do next.
 */
export function MediaState({ icon, tone = 'muted', title, children, action }) {
  return (
    <div className={cx('wv2-media-state', `is-${tone}`)} role="status">
      <div className="wv2-media-state__card">
        <span className="wv2-media-state__icon"><Icon name={icon} size={24} /></span>
        <b>{title}</b>
        {children && <p>{children}</p>}
        {action}
      </div>
    </div>
  );
}
