import { useState } from 'react';
import dayjs from 'dayjs';
import { useTranslation } from 'react-i18next';
import { Button, DockTile } from '../v2/ui';
import DialogShell from '../modal/DialogShell';
import { ScheduleDayStrip, formatScheduleWhen } from '../studio/ScheduleCalendar';
import { getMinMaxDates } from '../../utils/schedulingHelpers';
import { publishDraft, deleteDraft } from '../../utils/scheduledPosts';
import { scheduledPostWriteError } from '../../utils/scheduledPostProof';
import { toastIn } from '../../utils/toast';
import usePublishQuota from '../../hooks/usePublishQuota';
import PublishLimitNote from '../PublishLimit/PublishLimitNote';
import {
  isPublishBlocked, loadPublishQuota, nextFreeLocalValue, publishLimitFromError, refreshPublishQuota,
} from '../../lib/publishQuota';
import fallbackImg from '../../assets/image/speak.jpg';
import './VideoCard.scss';

const toast = toastIn('Post');

/**
 * One draft in the studio's Drafts tab (utils/scheduledPosts.js drafts): a post
 * saved from the video or audio details step with its upload, kept on the
 * checker until the creator publishes it now, schedules it, or throws it away.
 * Same row as VideoCard (21d). `onChanged` refreshes the lists after an action.
 */
export default function DraftCard({ draft, owner, onChanged }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [when, setWhen] = useState('');
  const audio = draft.kind === 'audio';
  const saved = draft.updatedAt || draft.createdAt;

  // ⏳ The free plan's daily publish limit (lib/publishQuota.js): publishing a
  // video draft now, or at a picked time, takes a slot. Audio is never limited.
  // "Publish now" on a taken slot opens the schedule dialog on the next free
  // time instead (`nowTaken` says why there).
  const limited = !audio;
  const publishKind = draft.kind === 'short' ? 'short' : 'video';
  const [nowTaken, setNowTaken] = useState(null);
  const whenCheck = usePublishQuota({
    kind: publishKind, at: when || null, exclude: draft.permlink, enabled: limited && scheduleOpen && !!when, debounceMs: 400,
  });
  const offerFreeTime = (info) => {
    const { minFormatted, minDate } = getMinMaxDates();
    setNowTaken(info);
    setWhen(nextFreeLocalValue(info.nextFreeAt, minDate.getTime()) || minFormatted);
    setScheduleOpen(true);
  };

  const run = async (fn, done, { now = false } = {}) => {
    setBusy(true);
    try {
      await fn();
      toast.success(done);
      if (limited) refreshPublishQuota();
      onChanged?.();
    } catch (err) {
      // A 429 over the daily publish limit: worded by scheduledPostWriteError,
      // and a refused "publish now" gets the schedule dialog on the next free time.
      const limit = publishLimitFromError(err);
      if (limit) refreshPublishQuota();
      toast.error(scheduledPostWriteError(err, t('episodes.drafts.actionFailed')));
      if (limit && now) offerFreeTime(limit);
    } finally {
      setBusy(false);
    }
  };
  const publishNow = async () => {
    if (limited) {
      setBusy(true);
      const quota = await loadPublishQuota(owner, { kind: publishKind, fresh: true });
      setBusy(false);
      if (isPublishBlocked(quota)) { offerFreeTime(quota); return; }
    }
    run(
      () => publishDraft({ owner, permlink: draft.permlink }),
      t('episodes.drafts.publishing'),
      { now: true },
    );
  };
  const openSchedule = () => {
    setNowTaken(null);
    setWhen(getMinMaxDates().minFormatted);
    setScheduleOpen(true);
  };
  const closeSchedule = () => { setScheduleOpen(false); setNowTaken(null); };
  const schedule = () => run(async () => {
    await publishDraft({ owner, permlink: draft.permlink, scheduledOn: new Date(when).toISOString() });
    closeSchedule();
  }, t('upload.publishing.scheduled'));
  const remove = () => {
    if (!window.confirm(t('episodes.drafts.deleteConfirm'))) return;
    run(() => deleteDraft({ owner, permlink: draft.permlink }), t('episodes.drafts.deleted'));
  };
  const { minFormatted, maxFormatted } = getMinMaxDates();

  return (
    <article className="studio-row studio-row--draft" data-testid="draft-card">
      <div className="studio-row__thumb v2-thumb r16">
        <img
          src={draft.thumbnail || fallbackImg}
          alt=""
          loading="lazy"
          onError={(e) => (e.currentTarget.src = fallbackImg)}
        />
      </div>

      <div className="studio-row__main">
        <h3 className="studio-row__title" title={draft.title || ''}>{draft.title || t('studio.drafts.untitled')}</h3>
        <div className="studio-row__meta">
          {saved ? t('episodes.drafts.savedOn', { date: dayjs(saved).format('MMM D, YYYY') }) : ''}
        </div>
      </div>

      <span className="studio-row__status is-muted">{t('cards.status.draft')}</span>

      <div className="studio-row__views">
        <b>{audio ? t('episodes.drafts.kindAudio') : t('episodes.drafts.kindVideo')}</b>
        <span>{t('episodes.drafts.kind')}</span>
      </div>

      <div className="studio-row__acts">
        <DockTile className="studio-row__act" icon="send" iconSize={20} label={t('episodes.drafts.publishNow')} disabled={busy} onClick={publishNow} />
        <DockTile className="studio-row__act" icon="event" iconSize={20} label={t('episodes.drafts.schedule')} disabled={busy} onClick={openSchedule} />
        <DockTile className="studio-row__act" icon="delete" iconSize={20} label={t('episodes.drafts.delete')} disabled={busy} onClick={remove} />
      </div>

      <DialogShell
        open={scheduleOpen}
        onClose={closeSchedule}
        busy={busy}
        title={t('episodes.drafts.scheduleTitle')}
        footer={(
          <Button variant="primary" size={48} trailing="event" disabled={!when || busy || whenCheck.blocked} loading={busy} onClick={schedule}>
            {t('upload.details.schedule.scheduleFor', { when: formatScheduleWhen(when) })}
          </Button>
        )}
      >
        {/* ⏳ Why "Publish now" landed here: the slot now is taken, the picker
            starts on the next free time. */}
        {nowTaken && !whenCheck.blocked && <PublishLimitNote mode="publish" now info={nowTaken} user={owner} newTab className="publish-limit-note--above" />}
        <ScheduleDayStrip value={when} min={minFormatted} max={maxFormatted} onChange={setWhen} />
        {/* ⏳ The picked time is taken: what takes it, and the next free time. */}
        <PublishLimitNote mode="publish" info={whenCheck.quota} onUseTime={setWhen} action="use" user={owner} newTab className="publish-limit-note--below" />
        <p className="schedule-sheet__note">{t('upload.details.schedule.note')}</p>
      </DialogShell>
    </article>
  );
}
