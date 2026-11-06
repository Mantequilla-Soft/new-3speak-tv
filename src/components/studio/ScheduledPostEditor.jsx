import React, { useEffect, useState } from 'react';
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
import StepActions from '../embed-studio/StepActions';
import SettingInfo, { SettingSheet } from '../embed-studio/SettingInfo';
import { useTranslation } from 'react-i18next';
// Same look as the uploader's details step: the legacy studio's form base
// (.studio-main-container, .input-group, .preview-tags, …), the settings tiles and
// page type scale from EmbedDetails.scss (`.embed-details-page`), its bottom sheets
// (SettingSheet) and its action row (StepActions). EditScheduledPost.scss adds the
// thumbnail row, which the uploader handles on a separate step.
import '../legacy-studio/StudioPage.scss';
import '../embed-studio/EmbedDetails.scss';
import '../../page/EditScheduledPost.scss';

const REWARD_LABELS = {
  default: 'upload.details.rewards.default',
  powerup: 'upload.details.rewards.powerup',
  decline: 'upload.details.rewards.decline',
};

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
  // Bottom sheets, as on the uploader's details step.
  const [rewardsOpen, setRewardsOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleDraft, setScheduleDraft] = useState('');

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

  function openSchedule() {
    setScheduleDraft(scheduleDateTime || '');
    setScheduleOpen(true);
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
    return <div className="studio-main-container edit-scheduled-page embed-details-page"><p style={{ padding: 20 }}>{t('common.status.loading')}</p></div>;
  }
  if (error) {
    return (
      <div className="studio-main-container edit-scheduled-page embed-details-page">
        {showHeader && <div className="studio-page-header"><h1>{t('studio.scheduled.title')}</h1></div>}
        <div className="studio-page-content"><p style={{ padding: '0 20px' }}>{error}</p></div>
      </div>
    );
  }
  if (!post) return null;

  const { minFormatted, maxFormatted } = getMinMaxDates();

  return (
    <>
      <div className="studio-main-container edit-scheduled-page embed-details-page">
        {showHeader && (
          <div className="studio-page-header">
            <h1>{t('studio.scheduled.title')}</h1>
            <p className="permlink-line">
              {t('studio.scheduled.permlink')} <code>{permlink}</code>
            </p>
          </div>
        )}

        <div className="studio-page-content">
          <div className="video-detail-wrap">
            <div className="video-items">

              <div className="input-group">
                <label>{t('studio.scheduled.fields.title')}</label>
                <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
              </div>

              <div className="input-group">
                <label>{t('studio.scheduled.fields.description')}</label>
                <div className="wrap-dec">
                  <MarkdownComposer
                    value={description}
                    onChange={setDescription}
                    placeholder={t('studio.scheduled.descriptionPlaceholder')}
                  />
                </div>
              </div>

              <div className="input-group">
                <label>{t('studio.scheduled.fields.thumbnail')}</label>
                <div className="thumbnail-edit-row">
                  {thumbnail ? (
                    <img className="thumbnail-edit-preview" src={thumbnail} alt={t('studio.scheduled.thumbnailAlt')} />
                  ) : (
                    <div className="thumbnail-edit-preview thumbnail-edit-preview--placeholder">
                      {t('studio.scheduled.noThumbnail')}
                    </div>
                  )}
                  <div className="thumbnail-edit-controls">
                    <label className="thumbnail-edit-btn">
                      {thumbnailUploading ? t('studio.scheduled.uploading') : (thumbnail ? t('studio.scheduled.replace') : t('common.actions.upload'))}
                      <input
                        type="file"
                        accept="image/*"
                        onChange={onPickThumbnail}
                        disabled={thumbnailUploading}
                      />
                    </label>
                    {thumbnail && (
                      <button
                        type="button"
                        className="thumbnail-edit-btn thumbnail-edit-btn--ghost"
                        onClick={() => setThumbnail(null)}
                        disabled={thumbnailUploading}
                      >
                        {t('common.actions.remove')}
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div className="input-group">
                <label>{t('studio.scheduled.fields.tag')}</label>
                <input type="text" value={tagsInputValue} onChange={handleTagChange} />
                <div className="wrap">
                  <span>{t('studio.scheduled.tagsHint')} </span> <span>{t('studio.scheduled.tagsHintKey')}</span>
                </div>
                <div className="preview-tags">
                  <span>
                    {tagsPreview.map((item, index) => (
                      <span className="item" key={index} style={{ marginRight: '8px' }}>{item}</span>
                    ))}
                  </span>
                </div>
              </div>

              <div className="advance-option">
                <div className="beneficiary-wrap is-clickable" onClick={() => setRewardsOpen(true)}>
                  <div className="wrap">
                    <span>{t('upload.details.rewards.label')}<SettingInfo title={t('upload.details.rewards.label')}>{t('upload.details.rewards.info')}</SettingInfo></span>
                    <span>{t('upload.details.rewards.hint')}</span>
                  </div>
                  <div className="tile-value">{t(REWARD_LABELS[payoutOptions] || REWARD_LABELS.default)}</div>
                </div>
                <div className="beneficiary-wrap is-clickable" onClick={toggleBeneficiaryModal}>
                  <div className="wrap">
                    <span>{t('upload.details.beneficiaries.label')}<SettingInfo title={t('upload.details.beneficiaries.label')}>{t('upload.details.beneficiaries.info')}</SettingInfo></span>
                    <span>{t('upload.details.beneficiaries.hint')}</span>
                  </div>
                  <div className="tile-value">{list.length > 0
                    ? t('upload.details.beneficiaries.accounts', { count: list.length })
                    : t('upload.details.beneficiaries.none')}</div>
                </div>
                <div className="beneficiary-wrap schedule-tile is-clickable" onClick={openSchedule}>
                  <div className="wrap">
                    <span>{t('studio.scheduled.fields.scheduledFor')}</span>
                    <span>{scheduleDateTime
                      ? new Date(scheduleDateTime).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
                      : ''}</span>
                  </div>
                  <div className="tile-value">{t('upload.details.schedule.changeTime')}</div>
                </div>
              </div>

              <SettingSheet title={t('upload.details.rewards.label')} open={rewardsOpen} onClose={() => setRewardsOpen(false)}>
                <div className="option-sheet">
                  {[
                    { value: 'default', label: t('upload.details.rewards.default'), hint: t('upload.details.rewards.defaultHint') },
                    { value: 'powerup', label: t('upload.details.rewards.powerup'), hint: t('upload.details.rewards.powerupHint') },
                    { value: 'decline', label: t('upload.details.rewards.decline'), hint: t('upload.details.rewards.declineHint') },
                  ].map((opt) => (
                    <button
                      type="button"
                      key={opt.value}
                      className={`option-sheet__item${payoutOptions === opt.value ? ' is-active' : ''}`}
                      onClick={() => { setPayoutOptions(opt.value); setRewardsOpen(false); }}
                    >
                      <strong>{opt.label}</strong>
                      <span>{opt.hint}</span>
                    </button>
                  ))}
                </div>
              </SettingSheet>

              <SettingSheet title={t('studio.scheduled.fields.scheduledFor')} open={scheduleOpen} onClose={() => setScheduleOpen(false)}>
                <ScheduleCalendar
                  value={scheduleDraft}
                  min={minFormatted}
                  max={maxFormatted}
                  onChange={setScheduleDraft}
                />
                <p className="schedule-sheet__note">{t('studio.scheduled.range')}</p>
                <div className="sheet-actions">
                  <button
                    type="button"
                    className="sheet-actions__ok"
                    disabled={!scheduleDraft}
                    onClick={() => { setScheduleDateTime(scheduleDraft); setScheduleOpen(false); }}
                  >
                    {t('common.actions.ok')}
                  </button>
                </div>
              </SettingSheet>

            </div>
          </div>
          {/* The uploader's action row. Cancelling is a neutral outline like every
              other secondary action: 3Speak never uses red buttons. */}
          <StepActions
            placement="bottom"
            back={showBack ? { label: t('common.actions.back'), onClick: () => onClose?.(), disabled: saving } : null}
            secondary={[{ key: 'cancel', label: t('studio.scheduled.cancelPost'), onClick: handleCancel, disabled: saving }]}
            primary={[{
              key: 'save',
              label: saving ? t('common.actions.saving') : t('studio.scheduled.saveChanges'),
              onClick: handleSave,
              disabled: saving || thumbnailUploading,
            }]}
          />
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
