import { useState } from 'react';
import { toastIn } from '../../utils/toast';
import { Icon } from '../v2/Icon';
import { Button, Checkbox } from '../v2/ui';
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
          className="snap-tags-input v2-input"
          placeholder={tags.length >= MAX_USER_TAGS ? t('profile.snaps.tagLimitReached') : t('profile.snaps.tagPlaceholder')}
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={onTagKeyDown}
          disabled={tags.length >= MAX_USER_TAGS}
        />
        <Button
          variant="ghost"
          size={40}
          className="snap-options-toggle"
          icon="tune"
          trailing={showOptions ? 'expand_less' : 'expand_more'}
          aria-expanded={showOptions}
          onClick={() => setShowOptions((v) => !v)}
        >
          {showOptions ? t('profile.snaps.hideOptions') : t('profile.snaps.moreOptions')}
        </Button>
      </div>

      <div className="snap-tag-chips">
        <span className="snap-tag-chip built-in" title={t('profile.snaps.builtInTag')}>{SNAP_TAG}</span>
        {tags.map((tag) => (
          <span key={tag} className="snap-tag-chip">
            {tag}
            <button type="button" onClick={() => removeTag(tag)} aria-label={t('profile.snaps.removeTag', { tag })}><Icon name="close" size={14} /></button>
          </span>
        ))}
        <span className="snap-tag-count">{tags.length}/{MAX_USER_TAGS}</span>
      </div>

      {showOptions && (
        <div className="snap-options">
          <label className="snap-field">
            <span className="snap-field-label">{t('profile.snaps.rewards')}</span>
            <select className="v2-input is-select" value={rewards} onChange={(e) => setRewards(e.target.value)}>
              <option value="default">{t('profile.snaps.rewardsDefault')}</option>
              <option value="powerup">{t('profile.snaps.rewardsPowerup')}</option>
              <option value="decline">{t('profile.snaps.rewardsDecline')}</option>
            </select>
          </label>

          <div className="snap-field">
            <span className="snap-field-label">{t('profile.snaps.beneficiaries')}</span>
            <div className="snap-benefic-add">
              <input
                className="v2-input"
                placeholder={t('profile.snaps.accountPlaceholder')}
                value={benAccount}
                onChange={(e) => setBenAccount(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addBeneficiary(); } }}
              />
              <input
                className="v2-input snap-benefic-pct"
                type="number" min="1" max="100" placeholder="%"
                value={benPercent}
                onChange={(e) => setBenPercent(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addBeneficiary(); } }}
              />
              <Button variant="secondary" icon="group_add" onClick={addBeneficiary}>{t('common.actions.add')}</Button>
            </div>
            {beneficiaries.length > 0 && (
              <ul className="snap-benefic-list">
                {beneficiaries.map((b) => (
                  <li key={b.account}>
                    <span>@{b.account}</span>
                    <b className="num">{Math.round(b.weight / 100)}%</b>
                    <button type="button" onClick={() => removeBeneficiary(b.account)} aria-label={t('common.actions.remove')}><Icon name="close" size={16} /></button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <Checkbox className="snap-toggle" checked={nsfw} onChange={(e) => setNsfw(e.target.checked)} label={t('profile.snaps.markNsfw')} />
        </div>
      )}

      <div className="snap-composer-actions">
        <Button variant="primary" className="snap-post-btn" disabled={posting || !body.trim()} loading={posting} onClick={handlePost} trailing="send">
          {posting ? t('profile.snaps.posting') : t('profile.snaps.postSnap')}
        </Button>
      </div>
    </div>
  );
}
