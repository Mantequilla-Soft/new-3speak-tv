import { useState } from 'react';
import { toastIn } from '../../utils/toast';
import { MdPeopleAlt, MdClose } from 'react-icons/md';
import MarkdownComposer from '../studio/MarkdownComposer';
import { useAppStore } from '../../lib/store';
import { publishSnap, SNAP_TAG, MAX_USER_TAGS } from '../../lib/snaps';
import { useTranslation } from 'react-i18next';

// Every toast from this module is headed "Post"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Post');

/**
 * Owner-only composer for a written "snap" — same fields as the shorts description
 * tab (body via MarkdownComposer, tags, rewards distribution, beneficiaries, NSFW),
 * minus the video-only "Allow Remix/Clip". Publishes under @peak.snaps and calls
 * onPosted(snap) with an optimistic snap object so the list can show it immediately.
 */
// `community` (a hive-<digits> id) files the post under that community's
// Discussion tab instead of it being only an update to the author's followers.
export default function SnapComposer({ onPosted, community = '', placeholder }) {
  const { t } = useTranslation();
  const user = useAppStore((s) => s.user);

  const [body, setBody] = useState('');
  const [tags, setTags] = useState([]);        // user tags (the built-in `community` is added on top)
  const [tagInput, setTagInput] = useState('');
  const [rewards, setRewards] = useState('default');
  const [nsfw, setNsfw] = useState(false);
  const [beneficiaries, setBeneficiaries] = useState([]); // { account, weight } (weight: 10000 = 100%)
  const [benAccount, setBenAccount] = useState('');
  const [benPercent, setBenPercent] = useState('');
  const [showOptions, setShowOptions] = useState(false);
  const [posting, setPosting] = useState(false);

  const totalBenWeight = beneficiaries.reduce((s, b) => s + Number(b.weight || 0), 0);

  const addBeneficiary = () => {
    const account = benAccount.toLowerCase().replace(/^@/, '').trim();
    const pct = Math.round(Number(benPercent) * 100); // percent → weight
    if (!account) { toast.error(t('profile.snaps.enterAccount')); return; }
    if (!pct || pct <= 0) { toast.error(t('profile.snaps.enterPercent')); return; }
    if (beneficiaries.some((b) => b.account === account)) { toast.error(t('profile.snaps.alreadyAdded')); return; }
    if (totalBenWeight + pct > 10000) { toast.error(t('profile.snaps.beneficiariesMax')); return; }
    setBeneficiaries([...beneficiaries, { account, weight: pct }]);
    setBenAccount('');
    setBenPercent('');
  };
  const removeBeneficiary = (account) => setBeneficiaries(beneficiaries.filter((b) => b.account !== account));

  const addTag = (raw) => {
    const tag = String(raw || '').toLowerCase().replace(/^#/, '').replace(/[^a-z0-9-]/g, '');
    if (!tag) { setTagInput(''); return; }
    if (tag === SNAP_TAG || tags.includes(tag)) { setTagInput(''); return; } // built-in / duplicate
    if (tags.length >= MAX_USER_TAGS) { toast.error(t('profile.snaps.tagLimit', { max: MAX_USER_TAGS })); return; }
    setTags([...tags, tag]);
    setTagInput('');
  };
  const removeTag = (tag) => setTags(tags.filter((x) => x !== tag));
  const onTagKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === ',') { e.preventDefault(); addTag(tagInput); }
    else if (e.key === 'Backspace' && !tagInput && tags.length) { removeTag(tags[tags.length - 1]); }
  };

  const handlePost = async () => {
    if (!user) { toast.error(t('profile.snaps.pleaseLogIn')); return; }
    const text = body.trim();
    if (!text) { toast.error(t('profile.snaps.writeSomething')); return; }

    // Include a tag still being typed, dedupe, and cap.
    const pending = tagInput.trim().toLowerCase().replace(/^#/, '').replace(/[^a-z0-9-]/g, '');
    const userTags = [...new Set([...tags, ...(pending && pending !== SNAP_TAG ? [pending] : [])])].slice(0, MAX_USER_TAGS);
    setPosting(true);
    try {
      const res = await publishSnap({ user, body: text, tags: userTags, rewards, beneficiaries, nsfw, community });
      toast.success(t('profile.snaps.snapPosted'));
      const snap = res.indexed || {
        _id: `${user}/${res.permlink}`,
        owner: user,
        permlink: res.permlink,
        title: '',
        body: text,
        tags: [SNAP_TAG, ...userTags, ...(nsfw ? ['nsfw'] : [])],
        nsfw,
        community: community || null,
        created: new Date().toISOString(),
      };
      // reset
      setBody(''); setTags([]); setTagInput(''); setRewards('default'); setNsfw(false);
      setBeneficiaries([]); setShowOptions(false);
      onPosted?.(snap);
    } catch (e) {
      toast.error(e?.message || t('profile.snaps.snapFailed'));
    } finally {
      setPosting(false);
    }
  };

  if (!user) return null;

  return (
    <div className="snap-composer">
      <MarkdownComposer
        value={body}
        onChange={setBody}
        placeholder={placeholder ?? t('profile.snaps.composerPlaceholder')}
        previewContext="snap"
      />

      <div className="snap-composer-row">
        <input
          className="snap-tags-input"
          placeholder={tags.length >= MAX_USER_TAGS ? t('profile.snaps.tagLimitReached') : t('profile.snaps.tagPlaceholder')}
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={onTagKeyDown}
          disabled={tags.length >= MAX_USER_TAGS}
        />
        <button type="button" className="snap-options-toggle" onClick={() => setShowOptions((v) => !v)}>
          {showOptions ? t('profile.snaps.hideOptions') : t('profile.snaps.moreOptions')}
        </button>
      </div>

      <div className="snap-tag-chips">
        <span className="snap-tag-chip built-in" title={t('profile.snaps.builtInTag')}>{SNAP_TAG}</span>
        {tags.map((tag) => (
          <span key={tag} className="snap-tag-chip">
            {tag}
            <button type="button" onClick={() => removeTag(tag)} aria-label={t('profile.snaps.removeTag', { tag })}><MdClose /></button>
          </span>
        ))}
        <span className="snap-tag-count">{tags.length}/{MAX_USER_TAGS}</span>
      </div>

      {showOptions && (
        <div className="snap-options">
          <label className="snap-field">
            <span className="snap-field-label">{t('profile.snaps.rewards')}</span>
            <select value={rewards} onChange={(e) => setRewards(e.target.value)}>
              <option value="default">{t('profile.snaps.rewardsDefault')}</option>
              <option value="powerup">{t('profile.snaps.rewardsPowerup')}</option>
              <option value="decline">{t('profile.snaps.rewardsDecline')}</option>
            </select>
          </label>

          <div className="snap-field">
            <span className="snap-field-label">{t('profile.snaps.beneficiaries')}</span>
            <div className="snap-benefic-add">
              <input
                placeholder={t('profile.snaps.accountPlaceholder')}
                value={benAccount}
                onChange={(e) => setBenAccount(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addBeneficiary(); } }}
              />
              <input
                type="number" min="1" max="100" placeholder="%"
                value={benPercent}
                onChange={(e) => setBenPercent(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addBeneficiary(); } }}
              />
              <button type="button" onClick={addBeneficiary}><MdPeopleAlt /> {t('common.actions.add')}</button>
            </div>
            {beneficiaries.length > 0 && (
              <ul className="snap-benefic-list">
                {beneficiaries.map((b) => (
                  <li key={b.account}>
                    <span>@{b.account} — {Math.round(b.weight / 100)}%</span>
                    <button type="button" onClick={() => removeBeneficiary(b.account)} aria-label={t('common.actions.remove')}><MdClose /></button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <label className="snap-toggle">
            <input type="checkbox" checked={nsfw} onChange={(e) => setNsfw(e.target.checked)} />
            <span>{t('profile.snaps.markNsfw')}</span>
          </label>
        </div>
      )}

      <div className="snap-composer-actions">
        <button type="button" className="snap-post-btn" disabled={posting || !body.trim()} onClick={handlePost}>
          {posting ? t('profile.snaps.posting') : t('profile.snaps.postSnap')}
        </button>
      </div>
    </div>
  );
}
