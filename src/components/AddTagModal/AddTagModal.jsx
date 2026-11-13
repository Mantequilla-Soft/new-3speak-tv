import { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { useTranslation, Trans } from 'react-i18next';
import { toastIn } from '../../utils/toast';
import { useAppStore } from '../../lib/store';
import { tagVideoWithAioha, isLoggedIn } from '../../hive-api/aioha';
import { recordViewerTag, getViewerTags, getMyViewerTag } from '../../utils/viewerTag';
import { getVideoTagsV2, getTagLabel, getCategoryOf } from '../../utils/tagsV2';
import TagsV2Picker from '../tooltip/TagsV2Picker';
import DialogShell from '../modal/DialogShell';
import { Button } from '../v2/ui';
import { Icon } from '../v2/Icon';
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

  // Design 43b "tag this video" on the 07/17 side sheet: the question under
  // the heading, the note about an earlier tag, every category with its topic
  // chips, and "Submit tag" pinned at the bottom (no X, Escape or backdrop
  // while the tag is being broadcast).
  return (
    <DialogShell
      onClose={onClose}
      busy={saving}
      side
      tone="cyan"
      title={t('modals.addTag.title')}
      width={420}
      zIndex={1100}
      isolate
      overlayClassName="vote-popup-overlay"
      className="add-tag-popup"
      footer={existing === undefined ? null : (
        <Button variant="primary" size={48} block trailing="sell" className="dlg-main vote-popup-submit" onClick={submit} disabled={saving || !tag} loading={saving}>
          {t('modals.addTag.submit')}
        </Button>
      )}
    >
      {title && <p className="add-tag-title">{title}</p>}
      {existing === undefined ? (
        <div className="add-tag-loading" role="status">
          <Icon name="progress_activity" size={24} className="v2-spin" />
        </div>
      ) : (
        <>
          <div className="add-tag-question" onClick={(e) => e.stopPropagation()}>
            <p className="add-tag-ask">{t('modals.addTag.question')}</p>
            {existing && (
              <p className="add-tag-note">
                <Trans i18nKey="modals.addTag.existing" values={{ label: getTagLabel(existing) }} components={{ b: <b /> }} />
              </p>
            )}
            <TagsV2Picker
              value={tag}
              onChange={setTag}
              tagPct={tagPct}
              disabled={saving}
              suggested={autoTagsV2}
              layout="groups"
            />
          </div>
        </>
      )}
    </DialogShell>
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
