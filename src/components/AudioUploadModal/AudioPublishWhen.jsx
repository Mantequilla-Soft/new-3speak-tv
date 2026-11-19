import { useTranslation } from 'react-i18next';
import { Segmented } from '../v2/ui';
import { ScheduleDayStrip, formatScheduleWhen } from '../studio/ScheduleCalendar';
import { getMinMaxDates } from '../../utils/schedulingHelpers';

export const PUBLISH_WHEN = ['now', 'schedule', 'draft'];

// The checker takes a scheduled post from 5 minutes ahead; the audio is uploaded
// first, so a picked time has to leave room for that too.
export const SCHEDULE_MIN_LEAD_MIN = 10;

/** A picked time (datetime-local) that is missing or closer than SCHEDULE_MIN_LEAD_MIN. */
export function scheduleTooSoon(scheduleAt, now = Date.now()) {
  const at = scheduleAt ? new Date(scheduleAt).getTime() : NaN;
  return !Number.isFinite(at) || at - now < SCHEDULE_MIN_LEAD_MIN * 60 * 1000;
}

/**
 * When a standalone audio post goes out (the single-post details step): now,
 * at a time (the video studio's day strip, 15 minutes to 90 days ahead), or not
 * yet: saved as a draft to publish from the studio's Drafts. A scheduled post
 * and a draft go through the checker's scheduled posts, which publish them as
 * the creator with the @threespeak posting authority (asked for once).
 * `scheduleAt` is a datetime-local string, as the video studio keeps it.
 */
export default function AudioPublishWhen({ value, onChange, scheduleAt, onScheduleAt }) {
  const { t } = useTranslation();
  const { minFormatted, maxFormatted } = getMinMaxDates();
  const pick = (next) => {
    onChange(next);
    if (next === 'schedule' && !scheduleAt) onScheduleAt(minFormatted);
  };
  return (
    <div className="audio-publish-when" data-testid="audio-publish-when">
      <span className="audio-upload-box-eyebrow">{t('episodes.when.label')}</span>
      <Segmented
        label={t('episodes.when.label')}
        value={value}
        onChange={pick}
        options={[
          { value: 'now', label: t('episodes.when.now'), icon: 'bolt' },
          { value: 'schedule', label: t('episodes.when.schedule'), icon: 'event' },
          { value: 'draft', label: t('episodes.when.draft'), icon: 'edit_note' },
        ]}
      />
      {value === 'schedule' && (
        <div className="audio-publish-when__schedule">
          <ScheduleDayStrip value={scheduleAt} min={minFormatted} max={maxFormatted} onChange={onScheduleAt} />
          {scheduleAt && <p className="audio-upload-step-help">{t('episodes.when.scheduledFor', { when: formatScheduleWhen(scheduleAt) })}</p>}
          {/* Picked a while ago and the time has come too close: Next waits for a later one. */}
          {scheduleAt && scheduleTooSoon(scheduleAt) && (
            <p className="audio-upload-step-help is-error" role="alert">{t('episodes.when.tooSoon', { minutes: SCHEDULE_MIN_LEAD_MIN })}</p>
          )}
        </div>
      )}
      <p className="audio-upload-step-help">
        {value === 'draft' ? t('episodes.when.draftHint') : value === 'schedule' ? t('episodes.when.scheduleHint') : t('episodes.when.nowHint')}
      </p>
    </div>
  );
}
