import { useEffect, useState } from 'react';
import axios from 'axios';
import { toastIn } from '../../utils/toast';
import { useAppStore } from '../../lib/store';
import { CHECKER_API_KEY } from '../../utils/config';
import { getMinMaxDates, formatDateTimeLocal } from '../../utils/schedulingHelpers';
import ScheduleCalendar from './ScheduleCalendar';
import { uploadThumbnail } from '../../utils/uploadThumbnail';
import { proveScheduledPost, scheduledPostWriteError } from '../../utils/scheduledPostProof';
import MarkdownComposer from './MarkdownComposer';
import Beneficiary_modal from '../modal/Beneficiary_modal';
import SettingInfo from '../embed-studio/SettingInfo';
import { useTranslation } from 'react-i18next';
import { Button, ChoiceCard, Icon } from '../v2/ui';
import { cx } from '../v2/helpers';
import { formatDate } from '../../i18n';
// Edit scheduled post (44c): v2 cards, its own stylesheet. The calendar and
// the payout choice sit inline instead of in sheets.
import '../../page/EditScheduledPost.scss';

// Every toast from this module is headed "Post"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Post');

const CHECKER_BASE =
  import.meta.env.VITE_SCHEDULED_POSTS_API_URL || 'https://prod-checker.okinoko.io';

function tagsToText(tags) {
  return Array.isArray(tags) ? tags.join(' ') : '';
}
function tagsFromText(text) {
  return String(text || '')
    .split(/[\s,]+/)
    .map(t => t.trim().toLowerCase())
    .filter(Boolean)
    .filter((t, i, a) => a.indexOf(t) === i);
}

// @threespeakfund is always present at >=10%, flagged `locked` so the shared
// Beneficiary modal renders it without a delete control and only allows raising.
const TS_FUND_ACCOUNT = 'threespeakfund';
const TS_FUND_MIN_PERCENT = 10;
// @encoder.pay 1% video-encoding split, set at upload time for non-Pro embed
// posts. We don't force-add it here (Pro posts never carry it), but when the
// post already has it we re-lock it so editing can't delete or reduce it.
const ENCODER_ACCOUNT = 'encoder.pay';
const ENCODER_MIN_PERCENT = 1;

function benesToList(bs) {
  const items = Array.isArray(bs) ? bs : [];
  let tsFundFound = false;
  const mapped = items.map((b) => {
    if (b.account === TS_FUND_ACCOUNT) {
      tsFundFound = true;
      const pct = Math.max(TS_FUND_MIN_PERCENT, (Number(b.weight) || 0) / 100);
      return { account: TS_FUND_ACCOUNT, percent: pct, locked: true, minPercent: TS_FUND_MIN_PERCENT };
    }
    if (b.account === ENCODER_ACCOUNT) {
      const pct = Math.max(ENCODER_MIN_PERCENT, (Number(b.weight) || 0) / 100);
      return { account: ENCODER_ACCOUNT, percent: pct, locked: true, minPercent: ENCODER_MIN_PERCENT };
    }
    return { account: b.account, percent: (Number(b.weight) || 0) / 100 };
  });
  if (!tsFundFound) {
    mapped.unshift({
      account: TS_FUND_ACCOUNT,
      percent: TS_FUND_MIN_PERCENT,
      locked: true,
      minPercent: TS_FUND_MIN_PERCENT,
    });
  }
  return mapped;
}
function listToBenes(list) {
  return (Array.isArray(list) ? list : [])
    .map((b) => ({
      account: String(b.account || '').trim().toLowerCase(),
      weight: Math.max(0, Math.min(10000, Math.round((Number(b.percent) || 0) * 100))),
    }))
    .filter((b) => b.account && b.weight > 0)
    .sort((a, b) => a.account.localeCompare(b.account));
}

/**
 * Self-contained editor for a scheduled post. Used both by the standalone
 * /edit-scheduled page and by the watch-page popup (EditScheduledModal).
 *
 * Props:
 *   permlink     the scheduled post's permlink
 *   onClose      () => void                 — "Back"/close
 *   onSaved      (changes) => void          — after a successful save
 *   onCancelled  () => void                 — after the post is cancelled
 *   showHeader   bool (default true)        — render the title/permlink header
 *   showBack     bool (default true)        — render the Back button (the popup
 *                                             has its own X, so it turns this off)
 */
export default function ScheduledPostEditor({ permlink, onClose, onSaved, onCancelled, showHeader = true, showBack = true }) {
  const { t } = useTranslation();
  const { user } = useAppStore();

  const [loading, setLoading] = useState(true);
  const [post, setPost] = useState(null);
  const [error, setError] = useState(null);

  // Edit fields
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tagsInputValue, setTagsInputValue] = useState('');
  const [tagsPreview, setTagsPreview] = useState([]);
  const [thumbnail, setThumbnail] = useState(null);
  const [thumbnailUploading, setThumbnailUploading] = useState(false);
  const [payoutOptions, setPayoutOptions] = useState('default');
  const [scheduleDateTime, setScheduleDateTime] = useState('');

  // Beneficiary modal state — same contract as EmbedUploadContext.
  const [isBeneficiaryModalOpen, setIsBeneficiaryModalOpen] = useState(false);
  const [list, setList] = useState([]);            // [{account, percent}]
  const [, setBeneficiaries] = useState('');        // modal writes a string here (unused by us)
  const [, setBeneficiaryList] = useState([]);      // modal side-effect counter (unused by us)
  const [remaingPercent, setRemaingPercent] = useState(100);

  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user || !permlink) return;
    setLoading(true);
    axios
      .get(`${CHECKER_BASE.replace(/\/$/, '')}/scheduled-posts/${encodeURIComponent(user)}`, {
        params: { status: 'scheduled', limit: 100 },
      })
      .then((res) => {
        const found = (res.data?.scheduled_posts || []).find((p) => p.permlink === permlink);
        if (!found) {
          setError(t('studio.scheduled.notFound'));
          return;
        }
        setPost(found);
        setTitle(found.title || '');
        setDescription(found.description || '');
        const tags = Array.isArray(found.tags) ? found.tags : [];
        setTagsPreview(tags);
        setTagsInputValue(tagsToText(tags));
        setThumbnail(found.thumbnail || null);
        setPayoutOptions(found.payoutOptions || 'default');
        setScheduleDateTime(
          found.scheduledOn ? formatDateTimeLocal(new Date(found.scheduledOn)) : '',
        );
        const benList = benesToList(found.beneficiaries);
        setList(benList);
        const used = benList.reduce((s, b) => s + (b.percent || 0), 0);
        setRemaingPercent(Math.max(0, 100 - used));
      })
      .catch((err) => setError(err?.message || t('studio.scheduled.loadFailed')))
      .finally(() => setLoading(false));
  }, [user, permlink, t]);

  function handleTagChange(e) {
    const value = e.target.value;
    setTagsInputValue(value);
    setTagsPreview(tagsFromText(value));
  }

  async function onPickThumbnail(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setThumbnailUploading(true);
    try {
      const url = await uploadThumbnail(file, user);
      setThumbnail(url);
      toast.success(t('studio.scheduled.thumbnailUploaded'));
    } catch (err) {
      console.error('thumbnail upload:', err);
      toast.error(err?.message || t('studio.scheduled.thumbnailFailed'));
    } finally {
      setThumbnailUploading(false);
    }
  }

  function toggleBeneficiaryModal() {
    setIsBeneficiaryModalOpen((v) => !v);
  }

  async function handleSave() {
    if (!post) return;
    setSaving(true);
    try {
      const cleanedBenes = listToBenes(list);
      const totalWeight = cleanedBenes.reduce((s, b) => s + b.weight, 0);
      if (totalWeight > 10000) {
        throw new Error(t('studio.scheduled.beneficiariesExceed', { total: totalWeight / 100 }));
      }
      const scheduledOnIso = new Date(scheduleDateTime).toISOString();
      const url = `${CHECKER_BASE.replace(/\/$/, '')}/scheduled-posts/update`;
      // The owner's signature, right before the write (utils/scheduledPostProof.js).
      const proof = await proveScheduledPost({ action: 'update', owner: user, permlink });
      const resp = await axios.post(url, {
        ...proof,
        owner: user,
        permlink,
        updates: {
          title,
          description,
          scheduledOn: scheduledOnIso,
          thumbnail,
          tags: tagsPreview,
          payoutOptions,
          beneficiaries: cleanedBenes,
        },
      }, {
        headers: CHECKER_API_KEY ? { Authorization: `Bearer ${CHECKER_API_KEY}` } : {},
      });
      if (!resp.data?.success) throw new Error(resp.data?.error || t('studio.scheduled.updateFailed'));
      toast.success(t('studio.scheduled.updated'));
      onSaved?.({ title, description, thumbnail, scheduledOn: scheduledOnIso });
    } catch (err) {
      console.error('update scheduled post:', err);
      toast.error(scheduledPostWriteError(err, t('studio.scheduled.updateFailed')));
    } finally {
      setSaving(false);
    }
  }

  async function handleCancel() {
    if (!post) return;
    if (!window.confirm(t('studio.scheduled.cancelConfirm'))) return;
    setSaving(true);
    try {
      const url = `${CHECKER_BASE.replace(/\/$/, '')}/scheduled-posts/cancel`;
      const proof = await proveScheduledPost({ action: 'cancel', owner: user, permlink });
      await axios.post(url, { ...proof, owner: user, permlink }, {
        headers: CHECKER_API_KEY ? { Authorization: `Bearer ${CHECKER_API_KEY}` } : {},
      });
      toast.success(t('studio.scheduled.cancelled'));
      onCancelled?.();
    } catch (err) {
      console.error('cancel scheduled post:', err);
      toast.error(scheduledPostWriteError(err, t('studio.scheduled.cancelFailed')));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="edit-scheduled-page is-loading" role="status">
        <Icon name="progress_activity" size={18} className="v2-spin" />
        <span>{t('common.status.loading')}</span>
      </div>
    );
  }
  if (error) {
    return (
      <div className="edit-scheduled-page">
        {showHeader && <div className="esp-head"><h1>{t('studio.scheduled.title')}</h1></div>}
        <div className="v2-failure" role="alert"><b>{error}</b></div>
        {showBack && (
          <div className="esp-actions">
            <Button variant="secondary" size={48} icon="arrow_back" onClick={() => onClose?.()}>{t('common.actions.back')}</Button>
          </div>
        )}
      </div>
    );
  }
  if (!post) return null;

  const { minFormatted, maxFormatted } = getMinMaxDates();
  const when = scheduleDateTime ? new Date(scheduleDateTime) : null;
  const inPast = !!when && when.getTime() < Date.now();
  const payoutChoices = [
    { value: 'default', label: t('upload.details.rewards.default'), hint: t('upload.details.rewards.defaultHint') },
    { value: 'powerup', label: t('upload.details.rewards.powerup'), hint: t('upload.details.rewards.powerupHint') },
    { value: 'decline', label: t('upload.details.rewards.decline'), hint: t('upload.details.rewards.declineHint') },
  ];

  return (
    <>
      <div className="edit-scheduled-page">
        {showHeader && (
          <div className="esp-head">
            <h1>{t('studio.scheduled.title')}</h1>
            <p className="permlink-line">
              {t('studio.scheduled.permlink')} <code>{permlink}</code>
            </p>
          </div>
        )}

        <div className="esp-grid">
          <section className="esp-card">
            <div className="v2-field">
              <label className="v2-eyebrow" htmlFor="esp-title">{t('studio.scheduled.fields.title')}</label>
              <input id="esp-title" className="v2-input h44" type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>

            <div className="v2-field">
              <span className="v2-eyebrow">{t('studio.scheduled.fields.description')}</span>
              <div className="wrap-dec">
                <MarkdownComposer
                  value={description}
                  onChange={setDescription}
                  placeholder={t('studio.scheduled.descriptionPlaceholder')}
                />
              </div>
            </div>

            <div className="v2-field">
              <span className="v2-eyebrow">{t('studio.scheduled.fields.thumbnail')}</span>
              <div className="thumbnail-edit-row">
                <div className="thumbnail-edit-preview v2-thumb r12">
                  {thumbnail ? (
                    <img src={thumbnail} alt={t('studio.scheduled.thumbnailAlt')} />
                  ) : (
                    <span className="thumbnail-edit-preview__empty">{t('studio.scheduled.noThumbnail')}</span>
                  )}
                </div>
                <div className="thumbnail-edit-controls">
                  <label className={cx('v2-btn v2-btn--secondary h40 thumbnail-edit-btn', thumbnailUploading && 'is-busy')} aria-disabled={thumbnailUploading || undefined}>
                    <Icon name={thumbnailUploading ? 'progress_activity' : 'upload'} size={18} className={thumbnailUploading ? 'v2-spin' : ''} />
                    <span className="v2-btn__label">{thumbnailUploading ? t('studio.scheduled.uploading') : (thumbnail ? t('studio.scheduled.replace') : t('common.actions.upload'))}</span>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={onPickThumbnail}
                      disabled={thumbnailUploading}
                    />
                  </label>
                  {thumbnail && (
                    <Button
                      variant="ghost"
                      icon="delete"
                      className="thumbnail-edit-btn--ghost"
                      onClick={() => setThumbnail(null)}
                      disabled={thumbnailUploading}
                    >
                      {t('common.actions.remove')}
                    </Button>
                  )}
                </div>
              </div>
            </div>

            <div className="v2-field">
              <label className="v2-eyebrow" htmlFor="esp-tags">{t('studio.scheduled.fields.tag')}</label>
              <input id="esp-tags" className="v2-input" type="text" value={tagsInputValue} onChange={handleTagChange} />
              <span className="v2-field__hint">{t('studio.scheduled.tagsHint')} <b>{t('studio.scheduled.tagsHintKey')}</b></span>
              {tagsPreview.length > 0 && (
                <div className="preview-tags">
                  {tagsPreview.map((item, index) => (
                    <span className="item" key={index}>{item}</span>
                  ))}
                </div>
              )}
            </div>
          </section>

          <div className="esp-side">
            <section className="esp-card">
              <h2 className="esp-card__title">{t('studio.scheduled.fields.scheduledFor')}</h2>
              <ScheduleCalendar
                value={scheduleDateTime}
                min={minFormatted}
                max={maxFormatted}
                onChange={setScheduleDateTime}
              />
              {when && !inPast && (
                <p className="esp-note is-cyan">
                  <Icon name="schedule_send" size={16} />
                  {t('studio.schedule.publishAt', { when: formatDate(when, { dateStyle: 'medium', timeStyle: 'short' }) })}
                </p>
              )}
              {inPast && (
                <p className="esp-note is-accent" role="alert">
                  <Icon name="error" size={16} />
                  {t('studio.schedule.pastWarning')}
                </p>
              )}
              <p className="esp-note">{t('studio.scheduled.range')}</p>
            </section>

            <section className="esp-card">
              <h2 className="esp-card__title">
                {t('upload.details.rewards.label')}
                <SettingInfo title={t('upload.details.rewards.label')}>{t('upload.details.rewards.info')}</SettingInfo>
              </h2>
              <div className="esp-payout" role="radiogroup" aria-label={t('upload.details.rewards.label')}>
                {payoutChoices.map((opt) => (
                  <ChoiceCard
                    key={opt.value}
                    tone="cyan"
                    selected={(payoutOptions || 'default') === opt.value}
                    title={opt.label}
                    sub={opt.hint}
                    onClick={() => setPayoutOptions(opt.value)}
                  />
                ))}
              </div>

              <button type="button" className="esp-bene" onClick={toggleBeneficiaryModal}>
                <span className="esp-bene__icon"><Icon name="group" size={18} /></span>
                <span className="esp-bene__body">
                  <b>{t('upload.details.beneficiaries.label')}</b>
                  <span>{t('upload.details.beneficiaries.hint')}</span>
                </span>
                <span className="esp-bene__value">{list.length > 0
                  ? t('upload.details.beneficiaries.accounts', { count: list.length })
                  : t('upload.details.beneficiaries.none')}</span>
                <Icon name="chevron_right" size={18} className="esp-bene__go" />
              </button>
            </section>
          </div>
        </div>

        {/* Cancelling is the destructive action, so it is the accent tint; the
            way on (Save) is the one solid accent button. */}
        <div className="esp-actions">
          {showBack && (
            <Button variant="secondary" size={48} icon="arrow_back" onClick={() => onClose?.()} disabled={saving}>
              {t('common.actions.back')}
            </Button>
          )}
          <span className="esp-actions__spacer" aria-hidden="true" />
          <Button variant="danger" size={48} icon="event_busy" onClick={handleCancel} disabled={saving}>
            {t('studio.scheduled.cancelPost')}
          </Button>
          <Button
            variant="primary"
            size={48}
            trailing="check"
            className="is-next"
            onClick={handleSave}
            disabled={saving || thumbnailUploading}
          >
            {saving ? t('common.actions.saving') : t('studio.scheduled.saveChanges')}
          </Button>
        </div>
      </div>

      {/* Conditional render — the modal's base CSS is fullscreen-fixed with no
          display:none fallback, so it appears as soon as it's mounted. */}
      {isBeneficiaryModalOpen && (
        <Beneficiary_modal
          isOpen={isBeneficiaryModalOpen}
          close={toggleBeneficiaryModal}
          setBeneficiaries={setBeneficiaries}
          setBeneficiaryList={setBeneficiaryList}
          setList={setList}
          list={list}
          setRemaingPercent={setRemaingPercent}
          remaingPercent={remaingPercent}
        />
      )}
    </>
  );
}
