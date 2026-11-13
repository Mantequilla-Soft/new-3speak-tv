import { useState } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import axios from 'axios';
import { toastIn } from '../../utils/toast';
import { CHECKER_URL } from '../../utils/config';
import { APP_VERSION } from '../../version';
import { useAppStore } from '../../lib/store';
import { Button, Dialog, DockTile, Field, Icon } from '../v2/ui';
import './StreamReportButton.scss';

// Every toast from this module is headed "Live"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Live');

// Report a live stream / room for abuse. POSTs to the checker's `/reports`
// collection (processed:false) for moderator triage — same triage pattern as
// the feedback reviews. Reasons mirror the checker's accepted set.
const REASONS = [
  { value: 'harassment', labelKey: 'live.report.reasons.harassment' },
  { value: 'sexual', labelKey: 'live.report.reasons.sexual' },
  { value: 'violence', labelKey: 'live.report.reasons.violence' },
  { value: 'selfharm', labelKey: 'live.report.reasons.selfharm' },
  { value: 'illegal', labelKey: 'live.report.reasons.illegal' },
  { value: 'spam', labelKey: 'live.report.reasons.spam' },
  { value: 'other', labelKey: 'live.report.reasons.other' },
];

/**
 * @param {string} roomName – the live room / stream id being reported
 * @param {string} host     – the streamer (Hive account) being reported
 * @param {string} [variant] – 'sidebar' (mobile action rail) | 'inline' (default)
 */
export default function StreamReportButton({ roomName, host, variant = 'inline' }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [detail, setDetail] = useState('');
  const [sending, setSending] = useState(false);
  const user = useAppStore((s) => s.user);

  const close = () => { if (!sending) { setOpen(false); setReason(''); setDetail(''); } };

  const submit = async () => {
    if (!reason || sending) return;
    setSending(true);
    try {
      await axios.post(`${CHECKER_URL}/reports`, {
        kind: 'stream',
        reason,
        detail: detail.trim(),
        roomName: roomName || null,
        reported: host || null,
        reporter: user || null,
        url: typeof window !== 'undefined' ? window.location.href : null,
        app_version: APP_VERSION,
        path: typeof window !== 'undefined' ? window.location.pathname : null,
      });
      toast.success(t('live.report.sent'));
      setOpen(false); setReason(''); setDetail('');
    } catch {
      toast.error(t('live.report.failed'));
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      {variant === 'sidebar' ? (
        <div className="actionItem" onClick={() => setOpen(true)} role="button" title={t('live.report.title')}>
          <div className="actionButton"><Icon name="flag" size={24} /></div>
          <span className="actionLabel">{t('common.actions.report')}</span>
        </div>
      ) : (
        <DockTile icon="flag" label={t('common.actions.report')} className="stream-report-trigger" onClick={() => setOpen(true)} title={t('live.report.title')} />
      )}

      {/* 39c: reasons as a two-column grid of choices, details, then submit. */}
      <Dialog
        open={open}
        onClose={close}
        tone="accent" // 39: "Report this stream" with the accent bar
        title={t('live.report.title')}
        dismissible={!sending}
        className="stream-report"
        footer={(
          // One 48px submit with the flag at its end (39c); the sheet's X cancels.
          <Button variant="primary" size={48} block next={false} trailing="flag" className="stream-report__submit is-next" onClick={submit} disabled={!reason || sending} loading={sending}>
            {sending ? t('live.report.sending') : t('live.report.submit')}
          </Button>
        )}
      >
        <p className="stream-report__sub">
          {host ? <><Trans i18nKey="live.report.reporting" values={{ host }} components={{ b: <b /> }} />{' '}</> : null}{t('live.report.intro')}
        </p>

        <div className="stream-report__reasons" role="radiogroup" aria-label={t('live.report.title')}>
          {REASONS.map((r) => (
            <button
              key={r.value}
              type="button"
              role="radio"
              className={`stream-report__reason${reason === r.value ? ' is-selected' : ''}`}
              onClick={() => setReason(r.value)}
              aria-checked={reason === r.value}
            >
              {t(r.labelKey)}
            </button>
          ))}
        </div>

        <Field
          as="textarea"
          className="stream-report__detail"
          aria-label={t('live.report.detailPlaceholder')}
          placeholder={t('live.report.detailPlaceholder')}
          value={detail}
          maxLength={4000}
          onChange={(e) => setDetail(e.target.value)}
        />
      </Dialog>
    </>
  );
}
