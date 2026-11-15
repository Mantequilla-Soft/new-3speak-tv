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

  const run = async (fn, done) => {
    setBusy(true);
    try {
      await fn();
      toast.success(done);
      onChanged?.();
    } catch (err) {
      toast.error(scheduledPostWriteError(err, t('episodes.drafts.actionFailed')));
    } finally {
      setBusy(false);
    }
  };
  const publishNow = () => run(
    () => publishDraft({ owner, permlink: draft.permlink }),
    t('episodes.drafts.publishing'),
  );
  const openSchedule = () => {
    setWhen(getMinMaxDates().minFormatted);
    setScheduleOpen(true);
  };
  const schedule = () => run(async () => {
    await publishDraft({ owner, permlink: draft.permlink, scheduledOn: new Date(when).toISOString() });
    setScheduleOpen(false);
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
        onClose={() => setScheduleOpen(false)}
        busy={busy}
        title={t('episodes.drafts.scheduleTitle')}
        footer={(
          <Button variant="primary" size={48} trailing="event" disabled={!when || busy} loading={busy} onClick={schedule}>
            {t('upload.details.schedule.scheduleFor', { when: formatScheduleWhen(when) })}
          </Button>
        )}
      >
        <ScheduleDayStrip value={when} min={minFormatted} max={maxFormatted} onChange={setWhen} />
        <p className="schedule-sheet__note">{t('upload.details.schedule.note')}</p>
      </DialogShell>
    </article>
  );
}
