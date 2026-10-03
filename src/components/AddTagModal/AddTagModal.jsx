import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import PropTypes from 'prop-types';
import { useTranslation, Trans } from 'react-i18next';
import { X } from 'lucide-react';
import { toastIn } from '../../utils/toast';
import { TailChase } from 'ldrs/react';
import 'ldrs/react/TailChase.css';
import { Orbit } from 'ldrs/react';
import 'ldrs/react/Orbit.css';
import { useAppStore } from '../../lib/store';
import { tagVideoWithAioha, isLoggedIn } from '../../hive-api/aioha';
import { recordViewerTag, getViewerTags, getMyViewerTag } from '../../utils/viewerTag';
import { getVideoTagsV2, getTagLabel, getCategoryOf } from '../../utils/tagsV2';
import TagsV2Picker from '../tooltip/TagsV2Picker';
// Reuses the vote dialog's popup shell (already a bottom sheet on mobile) and the
// tag-tile styles, so tagging looks identical wherever it's offered.
import '../tooltip/UpvoteTooltip.scss';
import './AddTagModal.scss';

// Every toast from this module is headed "Video"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Video');

// Full-strength weight for the topic tally. This is NOT a Hive vote — it's only
// how much this tag counts toward the video's topic consensus. Tagging from the
// card NEVER broadcasts a vote op, so no vote UI or wording appears here.
const TAG_WEIGHT = 10000;

/**
 * "Add tag" from the card ⋮ menu — assign a topic to a video. Tagging ONLY:
 * it broadcasts the `3speak-viewer-tag` custom_json (the authoritative, signed
 * record) and mirrors it into the checker's queryable index. It deliberately
 * casts NO vote and shows no vote controls, weight slider, or payout estimate —
 * voting lives exclusively in the vote dialog on the watch page.
 *
 * One tag per (viewer, video): picking another replaces the previous one, which
 * is why we preselect whatever they chose before.
 */
function AddTagModal({ isOpen, onClose, author, permlink, title }) {
  const { t } = useTranslation();
  const user = useAppStore((s) => s.user);
  const [tag, setTag] = useState('');
  const [tagPct, setTagPct] = useState({});
  const [existing, setExisting] = useState(undefined); // undefined = still loading
  const [saving, setSaving] = useState(false);
  // v2-tagged videos get the new category → topic picker (see utils/tagsV2.js).
  const [autoTagsV2, setAutoTagsV2] = useState([]);

  // Load the crowd consensus (for the % on each tile) + this user's existing tag.
  useEffect(() => {
    if (!isOpen || !author || !permlink) return undefined;
    let alive = true;
    setExisting(undefined);
    setTag('');
    setAutoTagsV2([]);

    getVideoTagsV2(author, permlink).then(({ tags }) => {
      if (!alive) return;
      setAutoTagsV2(tags);
      // Default to the auto-tag's CATEGORY (the reliable level) — but only if
      // nothing is picked yet, so this user's own earlier tag still wins,
      // whichever of the two lookups resolves first.
      const parent = tags.length ? getCategoryOf(tags[0]) : null;
      if (parent) setTag((cur) => cur || parent);
    });

    getViewerTags(author, permlink).then((d) => {
      if (!alive || !d?.counts) return;
      const map = {};
      for (const c of d.counts) map[c.tag] = c.pct;
      setTagPct(map);
    });

    if (user) {
      getMyViewerTag(user, author, permlink).then((r) => {
        if (!alive) return;
        setExisting(r?.tag || null);
        if (r?.tag) setTag(r.tag); // preselect — submitting replaces it
      });
    } else {
      setExisting(null);
    }
    return () => { alive = false; };
  }, [isOpen, author, permlink, user]);

  // Escape to close (but not mid-broadcast).
  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape' && !saving) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, saving, onClose]);

  if (!isOpen) return null;

  const submit = async () => {
    if (!isLoggedIn() || !user) {
      toast.error(t('modals.addTag.loginRequired'));
      return;
    }
    if (!tag) {
      toast.error(t('modals.addTag.pickTopic'));
      return;
    }
    setSaving(true);
    try {
      await tagVideoWithAioha(author, permlink, tag, TAG_WEIGHT);
      // Mirror into the checker (best-effort — the on-chain custom_json is the
      // source of truth, so a failed mirror must not report the tag as failed).
      await recordViewerTag(user, author, permlink, tag, TAG_WEIGHT);
      toast.success(t('modals.addTag.tagged', { label: getTagLabel(tag) }));
      onClose();
    } catch (err) {
      console.error('Tag failed:', err);
      toast.error(t('modals.addTag.failed', { error: err.message || t('modals.addTag.pleaseTryAgain') }));
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="vote-popup-overlay" onMouseDown={() => { if (!saving) onClose(); }}>
      <div
        className="vote-popup add-tag-popup"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button className="vote-popup-close" onClick={onClose} disabled={saving}>
          <X size={18} />
        </button>

        <p className="vote-popup-label">{t('modals.addTag.title')}</p>
        {title && <p className="add-tag-title">{title}</p>}

        {existing === undefined ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0' }}>
            <Orbit size="24" speed="1.5" color="red" />
          </div>
        ) : (
          <>
            <div className="viewer-tag-select" onClick={(e) => e.stopPropagation()}>
              <span>{t('modals.addTag.question')}</span>
              <TagsV2Picker
                value={tag}
                onChange={setTag}
                tagPct={tagPct}
                disabled={saving}
                suggested={autoTagsV2}
              />
            </div>

            {existing && (
              <p className="vote-popup-note">
                <Trans i18nKey="modals.addTag.existing" values={{ label: getTagLabel(existing) }} components={{ b: <b /> }} />
              </p>
            )}

            <button
              className="vote-popup-submit"
              onClick={submit}
              disabled={saving || !tag}
            >
              {saving ? <TailChase size="18" speed="1.5" color="white" /> : t('modals.addTag.submit')}
            </button>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}

AddTagModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  author: PropTypes.string.isRequired,
  permlink: PropTypes.string.isRequired,
  title: PropTypes.string,
};

export default AddTagModal;
