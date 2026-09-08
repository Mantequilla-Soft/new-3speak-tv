import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { toastIn } from '../../utils/toast';
import { MdPeopleAlt } from 'react-icons/md';
import { useAppStore } from '../../lib/store';
import { CHECKER_API_KEY } from '../../utils/config';
import { getMinMaxDates, formatDateTimeLocal } from '../../utils/schedulingHelpers';
import { uploadThumbnail } from '../../utils/uploadThumbnail';
import MarkdownComposer from './MarkdownComposer';
import Beneficiary_modal from '../modal/Beneficiary_modal';
// Form look is inherited from the legacy studio's stylesheet (.studio-main-container,
// .input-group, .preview-tags, .advance-option, .bene-btn-wrap, .submit-btn-wrap, …)
// plus EditScheduledPost.scss for the thumbnail row + the secondary buttons.
import '../legacy-studio/StudioPage.scss';
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
 */
export default function ScheduledPostEditor({ permlink, onClose, onSaved, onCancelled, showHeader = true }) {
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
          setError('Scheduled post not found (it may have already been published or cancelled).');
          return;
        }
        setPost(found);
        setTitle(found.title || '');
        setDescription(found.description || '');
        const t = Array.isArray(found.tags) ? found.tags : [];
        setTagsPreview(t);
        setTagsInputValue(tagsToText(t));
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
      .catch((err) => setError(err?.message || 'Failed to load scheduled post'))
      .finally(() => setLoading(false));
  }, [user, permlink]);

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
      toast.success('Thumbnail uploaded');
    } catch (err) {
      console.error('thumbnail upload:', err);
      toast.error(err?.message || 'Thumbnail upload failed');
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
        throw new Error(`Beneficiaries total ${totalWeight / 100}% exceeds 100%`);
      }
      const scheduledOnIso = new Date(scheduleDateTime).toISOString();
      const url = `${CHECKER_BASE.replace(/\/$/, '')}/scheduled-posts/update`;
      const resp = await axios.post(url, {
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
      if (!resp.data?.success) throw new Error(resp.data?.error || 'Update failed');
      toast.success('Scheduled post updated');
      onSaved?.({ title, description, thumbnail, scheduledOn: scheduledOnIso });
    } catch (err) {
      console.error('update scheduled post:', err);
      toast.error(err?.response?.data?.error || err?.message || 'Update failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleCancel() {
    if (!post) return;
    if (!window.confirm('Cancel this scheduled post? It will not be broadcast.')) return;
    setSaving(true);
    try {
      const url = `${CHECKER_BASE.replace(/\/$/, '')}/scheduled-posts/cancel`;
      await axios.post(url, { owner: user, permlink }, {
        headers: CHECKER_API_KEY ? { Authorization: `Bearer ${CHECKER_API_KEY}` } : {},
      });
      toast.success('Scheduled post cancelled');
      onCancelled?.();
    } catch (err) {
      console.error('cancel scheduled post:', err);
      toast.error(err?.response?.data?.error || err?.message || 'Cancel failed');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="studio-main-container edit-scheduled-page"><p style={{ padding: 20 }}>Loading…</p></div>;
  }
  if (error) {
    return (
      <div className="studio-main-container edit-scheduled-page">
        {showHeader && <div className="studio-page-header"><h1>Edit scheduled post</h1></div>}
        <div className="studio-page-content"><p style={{ padding: '0 20px' }}>{error}</p></div>
      </div>
    );
  }
  if (!post) return null;

  const { minFormatted, maxFormatted } = getMinMaxDates();

  return (
    <>
      <div className="studio-main-container edit-scheduled-page">
        {showHeader && (
          <div className="studio-page-header">
            <h1>Edit scheduled post</h1>
            <p className="permlink-line">
              Permlink: <code>{permlink}</code>
            </p>
          </div>
        )}

        <div className="studio-page-content">
          <div className="video-detail-wrap">
            <div className="video-items">

              <div className="input-group">
                <label>Title</label>
                <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
              </div>

              <div className="input-group">
                <label>Description</label>
                <div className="wrap-dec">
                  <MarkdownComposer
                    value={description}
                    onChange={setDescription}
                    placeholder="Write your video description here... Supports markdown formatting!"
                  />
                </div>
              </div>

              <div className="input-group">
                <label>Thumbnail</label>
                <div className="thumbnail-edit-row">
                  {thumbnail ? (
                    <img className="thumbnail-edit-preview" src={thumbnail} alt="thumbnail" />
                  ) : (
                    <div className="thumbnail-edit-preview thumbnail-edit-preview--placeholder">
                      No thumbnail
                    </div>
                  )}
                  <div className="thumbnail-edit-controls">
                    <label className="thumbnail-edit-btn">
                      {thumbnailUploading ? 'Uploading…' : (thumbnail ? 'Replace' : 'Upload')}
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
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div className="input-group">
                <label>Tag</label>
                <input type="text" value={tagsInputValue} onChange={handleTagChange} />
                <div className="wrap">
                  <span>Separate multiple tags with </span> <span>Space</span>
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
                <div className="beneficiary-wrap mb">
                  <div className="wrap">
                    <span>Rewards Distribution</span>
                    <span>Optional "Hive Reward Pool" distribution method.</span>
                  </div>
                  <div className="select-wrap">
                    <select value={payoutOptions} onChange={(e) => setPayoutOptions(e.target.value)}>
                      <option value="default"> Default 50% 50% </option>
                      <option value="powerup">Power up 100%</option>
                      <option value="decline">Decline Payout</option>
                    </select>
                  </div>
                </div>
                <div className="beneficiary-wrap">
                  <div className="wrap">
                    <span>Beneficiaries</span>
                    <span>Other accounts that should get a % of the post rewards.</span>
                  </div>
                  <div className="bene-btn-wrap" onClick={toggleBeneficiaryModal}>
                    {list.length > 0 && <span>{list.length}</span>}
                    <span> BENEFICIARIES</span>
                    <MdPeopleAlt />
                  </div>
                </div>
              </div>

              <div className="schedule-box-wrap" style={{ marginTop: '12px' }}>
                <div className="input-group">
                  <label>Scheduled for</label>
                  <input
                    type="datetime-local"
                    value={scheduleDateTime}
                    min={minFormatted}
                    max={maxFormatted}
                    onChange={(e) => setScheduleDateTime(e.target.value)}
                  />
                  <div className="wrap">
                    <span>Range: at least 15 minutes from now, up to 90 days.</span>
                  </div>
                </div>
              </div>

              <div className="submit-btn-wrap">
                <button
                  type="button"
                  className="es-btn-secondary"
                  onClick={() => onClose?.()}
                  disabled={saving}
                >
                  Back
                </button>
                <button
                  type="button"
                  className="es-btn-danger"
                  onClick={handleCancel}
                  disabled={saving}
                >
                  Cancel scheduled post
                </button>
                <button
                  className="es-btn-save"
                  onClick={handleSave}
                  disabled={saving || thumbnailUploading}
                >
                  {saving ? 'Saving…' : 'Save changes'}
                </button>
              </div>

            </div>
          </div>
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
