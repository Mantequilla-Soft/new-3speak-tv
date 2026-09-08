import { useState } from 'react';
import { toastIn } from '../../utils/toast';
import { MdPeopleAlt, MdClose } from 'react-icons/md';
import MarkdownComposer from '../studio/MarkdownComposer';
import { useAppStore } from '../../lib/store';
import { publishSnap, SNAP_TAG, MAX_USER_TAGS } from '../../lib/snaps';

// Every toast from this module is headed "Post"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Post');

/**
 * Owner-only composer for a written "snap" — same fields as the shorts description
 * tab (body via MarkdownComposer, tags, rewards distribution, beneficiaries, NSFW),
 * minus the video-only "Allow Remix/Clip". Publishes under @peak.snaps and calls
 * onPosted(snap) with an optimistic snap object so the list can show it immediately.
 */
export default function SnapComposer({ onPosted }) {
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
    if (!account) { toast.error('Enter an account'); return; }
    if (!pct || pct <= 0) { toast.error('Enter a percent above 0'); return; }
    if (beneficiaries.some((b) => b.account === account)) { toast.error('Already added'); return; }
    if (totalBenWeight + pct > 10000) { toast.error('Beneficiaries can’t exceed 100%'); return; }
    setBeneficiaries([...beneficiaries, { account, weight: pct }]);
    setBenAccount('');
    setBenPercent('');
  };
  const removeBeneficiary = (account) => setBeneficiaries(beneficiaries.filter((b) => b.account !== account));

  const addTag = (raw) => {
    const t = String(raw || '').toLowerCase().replace(/^#/, '').replace(/[^a-z0-9-]/g, '');
    if (!t) { setTagInput(''); return; }
    if (t === SNAP_TAG || tags.includes(t)) { setTagInput(''); return; } // built-in / duplicate
    if (tags.length >= MAX_USER_TAGS) { toast.error(`Up to ${MAX_USER_TAGS} tags`); return; }
    setTags([...tags, t]);
    setTagInput('');
  };
  const removeTag = (t) => setTags(tags.filter((x) => x !== t));
  const onTagKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === ',') { e.preventDefault(); addTag(tagInput); }
    else if (e.key === 'Backspace' && !tagInput && tags.length) { removeTag(tags[tags.length - 1]); }
  };

  const handlePost = async () => {
    if (!user) { toast.error('Please log in'); return; }
    const text = body.trim();
    if (!text) { toast.error('Write something first'); return; }

    // Include a tag still being typed, dedupe, and cap.
    const pending = tagInput.trim().toLowerCase().replace(/^#/, '').replace(/[^a-z0-9-]/g, '');
    const userTags = [...new Set([...tags, ...(pending && pending !== SNAP_TAG ? [pending] : [])])].slice(0, MAX_USER_TAGS);
    setPosting(true);
    try {
      const res = await publishSnap({ user, body: text, tags: userTags, rewards, beneficiaries, nsfw });
      toast.success('Snap posted!');
      const snap = res.indexed || {
        _id: `${user}/${res.permlink}`,
        owner: user,
        permlink: res.permlink,
        title: '',
        body: text,
        tags: [SNAP_TAG, ...userTags, ...(nsfw ? ['nsfw'] : [])],
        nsfw,
        created: new Date().toISOString(),
      };
      // reset
      setBody(''); setTags([]); setTagInput(''); setRewards('default'); setNsfw(false);
      setBeneficiaries([]); setShowOptions(false);
      onPosted?.(snap);
    } catch (e) {
      toast.error(e?.message || 'Could not post the snap');
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
        placeholder="Share an update with your followers…"
        previewContext="snap"
      />

      <div className="snap-composer-row">
        <input
          className="snap-tags-input"
          placeholder={tags.length >= MAX_USER_TAGS ? 'Tag limit reached' : 'Add a tag, then space or enter…'}
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={onTagKeyDown}
          disabled={tags.length >= MAX_USER_TAGS}
        />
        <button type="button" className="snap-options-toggle" onClick={() => setShowOptions((v) => !v)}>
          {showOptions ? 'Hide options' : 'More options'}
        </button>
      </div>

      <div className="snap-tag-chips">
        <span className="snap-tag-chip built-in" title="Added to every community post">{SNAP_TAG}</span>
        {tags.map((t) => (
          <span key={t} className="snap-tag-chip">
            {t}
            <button type="button" onClick={() => removeTag(t)} aria-label={`Remove ${t}`}><MdClose /></button>
          </span>
        ))}
        <span className="snap-tag-count">{tags.length}/{MAX_USER_TAGS}</span>
      </div>

      {showOptions && (
        <div className="snap-options">
          <label className="snap-field">
            <span className="snap-field-label">Rewards Distribution</span>
            <select value={rewards} onChange={(e) => setRewards(e.target.value)}>
              <option value="default">Default 50% / 50%</option>
              <option value="powerup">Power up 100%</option>
              <option value="decline">Decline payout</option>
            </select>
          </label>

          <div className="snap-field">
            <span className="snap-field-label">Beneficiaries</span>
            <div className="snap-benefic-add">
              <input
                placeholder="account"
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
              <button type="button" onClick={addBeneficiary}><MdPeopleAlt /> Add</button>
            </div>
            {beneficiaries.length > 0 && (
              <ul className="snap-benefic-list">
                {beneficiaries.map((b) => (
                  <li key={b.account}>
                    <span>@{b.account} — {Math.round(b.weight / 100)}%</span>
                    <button type="button" onClick={() => removeBeneficiary(b.account)} aria-label="Remove"><MdClose /></button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <label className="snap-toggle">
            <input type="checkbox" checked={nsfw} onChange={(e) => setNsfw(e.target.checked)} />
            <span>Mark as adult / NSFW</span>
          </label>
        </div>
      )}

      <div className="snap-composer-actions">
        <button type="button" className="snap-post-btn" disabled={posting || !body.trim()} onClick={handlePost}>
          {posting ? 'Posting…' : 'Post snap'}
        </button>
      </div>
    </div>
  );
}
