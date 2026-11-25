import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Banner, Button } from '../v2/ui';
import { ENABLE_SUBS } from '../../utils/config';
import { proPlansPath } from '../../lib/uploadQuota';
import { getMinMaxDates } from '../../utils/schedulingHelpers';
import {
  conflictLines, formatPublishTime, isPublishBlocked, nextFreeLocalValue, nextFreeText, publishRuleText,
} from '../../lib/publishQuota';
import './PublishLimitNote.scss';

/**
 * ⏳ The free plan's daily PUBLISH limit (lib/publishQuota.js) as a warning, for
 * a quota that holds the publish back or a 429 the checker already sent:
 *
 *   mode 'upload'   before a file is picked: a warning, never a block. "On the
 *                   free plan you can publish 1 video per 24 hours. “Trip” was
 *                   published at … You can still upload it and schedule it.
 *                   Earliest free time: …" (a Short, which cannot be scheduled:
 *                   "It can be posted from …").
 *   mode 'publish'  where the post goes out: "You cannot publish this now." (or
 *                   "This time is taken." for a picked time), the rule, what
 *                   takes the slot, the earliest free time, and with `onUseTime`
 *                   a one-tap button that hands that time over as a schedule
 *                   picker value.
 *
 * Renders nothing without a blocking answer (null = no limit known: the fail-open case).
 *
 * @param {object|null} info       usePublishQuota().quota, or parsePublishLimit()'s refusal
 * @param {'upload'|'publish'} mode
 * @param {boolean} [now]          the time in question is "publish now" (else a picked time)
 * @param {function} [onUseTime]   (value: "YYYY-MM-DDTHH:mm") => void, offered when a free time is known
 * @param {'schedule'|'use'} [action] the button says "Schedule for <time>" (switches to
 *                                  scheduling) or "Use <time>" (inside a picker)
 * @param {string|null} user       the viewer, for the Get Pro link (their wallet)
 * @param {boolean} [newTab]       open Get Pro in a new tab (from a screen holding unsaved work)
 */
export default function PublishLimitNote({ info, mode = 'publish', now = false, onUseTime, action = 'schedule', user, newTab = false, className, children }) {
  const { t, i18n } = useTranslation();
  if (!isPublishBlocked(info)) return null;
  const lang = i18n?.language;
  const short = info.kind === 'short';
  const time = formatPublishTime(info.nextFreeAt, lang);

  let lead = null;
  let tail;
  if (mode === 'upload') {
    tail = short
      ? (time ? t('publishLimits.uploadShort', { time }) : t('publishLimits.uploadShortLater'))
      : (time ? t('publishLimits.uploadSchedule', { time }) : t('publishLimits.uploadScheduleLater'));
  } else {
    lead = t(now ? 'publishLimits.nowTaken' : 'publishLimits.timeTaken');
    // A Short cannot be scheduled from the studio: it waits for its time instead.
    tail = short && now ? (time ? t('publishLimits.shortFrom', { time }) : t('publishLimits.later')) : nextFreeText(t, info, lang);
  }
  const text = [lead, publishRuleText(t, info), ...conflictLines(t, info, lang), tail].filter(Boolean).join(' ');
  const value = onUseTime && Number.isFinite(info.nextFreeAt)
    ? nextFreeLocalValue(info.nextFreeAt, getMinMaxDates().minDate.getTime())
    : '';

  const goPro = ENABLE_SUBS && user ? (
    <>{' '}<Link to={proPlansPath(user)} className="publish-limit-note__pro" {...(newTab ? { target: '_blank', rel: 'noopener' } : {})}>{t('uploadLimits.goPro')}</Link></>
  ) : null;

  return (
    <Banner tone="warn" icon="schedule" className={['publish-limit-note', `is-${mode}`, className].filter(Boolean).join(' ')}>
      {text}
      {children ? <> {children}</> : null}
      {goPro}
      {value && (
        <span className="publish-limit-note__actions">
          <Button variant="secondary" size={40} icon="event" onClick={() => onUseTime(value)}>
            {action === 'use'
              ? t('publishLimits.useTime', { time: formatPublishTime(new Date(value).getTime(), lang) })
              : t('upload.details.schedule.scheduleFor', { when: formatPublishTime(new Date(value).getTime(), lang) })}
          </Button>
        </span>
      )}
    </Banner>
  );
}
