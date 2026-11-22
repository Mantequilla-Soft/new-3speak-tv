import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Banner } from '../v2/ui';
import { ENABLE_SUBS } from '../../utils/config';
import { DEFAULT_AUDIO_MAX_SECONDS, isUsedUp, proPlansPath, uploadLimitMessage, usedUpInfo } from '../../lib/uploadQuota';

/**
 * ⏳ The daily limit for one kind of upload (lib/uploadQuota.js), as a compact
 * line beside the picker:
 *   room left  → "Free plan: 1 video per day. 1 left today. Go Pro"   (info)
 *   used up    → "You have reached today's free video limit. Next upload at 14:32. Go Pro"   (warn)
 * A warm-up account (entry.plan 'warmup') gets its own wording ("During your
 * warm-up: 3 videos per day.") and no Go Pro link: it has no Hive account and
 * no `user` to link. Renders nothing without a known limit (`entry` null and no
 * `refusal`), which is the fail-open case: off, not deployed, unreadable, Pro.
 *
 * @param {'video'|'short'|'audio'} kind
 * @param {object|null} entry    useUploadQuota()'s counter for that kind
 * @param {object|null} refusal  a refusal the server already sent (parseUploadLimit), wins over the counter
 * @param {string|null} user     the viewer, for the Go Pro link (their wallet)
 * @param {boolean} [warn]      something about the files at hand breaks the limit (`children` says what)
 * @param {boolean} [newTab]    open Go Pro in a new tab (from a modal holding unsaved work)
 */
export default function UploadQuotaNote({ kind, entry, refusal = null, user, warn = false, newTab = false, className, children }) {
  const { t, i18n } = useTranslation();
  const info = refusal || (isUsedUp(entry) ? usedUpInfo(entry, kind) : null);
  if (!info && !entry) return null;

  const goPro = ENABLE_SUBS && user ? (
    <>{' '}<Link to={proPlansPath(user)} className="upload-quota-note__pro" {...(newTab ? { target: '_blank', rel: 'noopener' } : {})}>{t('uploadLimits.goPro')}</Link></>
  ) : null;

  if (info) {
    return (
      <Banner tone="warn" icon="schedule" className={['upload-quota-note', 'is-used-up', className].filter(Boolean).join(' ')}>
        {uploadLimitMessage(t, info, i18n?.language)}
        {children ? <> {children}</> : null}
        {goPro}
      </Banner>
    );
  }

  const minutes = Math.round((entry.maxSeconds || DEFAULT_AUDIO_MAX_SECONDS) / 60);
  // Audio without a length limit (max_seconds null) says only the count.
  const freeKey = kind === 'audio' ? (entry.maxSeconds ? 'audio' : 'audioCount') : kind === 'short' ? 'short' : 'video';
  const planKey = entry.plan === 'warmup' && kind !== 'audio' ? 'warmup' : 'free';
  return (
    <Banner tone={warn ? 'warn' : 'info'} icon="schedule" className={['upload-quota-note', warn && 'is-over', className].filter(Boolean).join(' ')}>
      {t(`uploadLimits.${planKey}.${freeKey}`, { count: entry.limit, minutes })}
      {' '}
      {t('uploadLimits.left', { count: entry.remaining })}
      {children ? <> {children}</> : null}
      {goPro}
    </Banner>
  );
}
