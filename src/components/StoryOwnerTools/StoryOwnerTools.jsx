import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { MdVisibility, MdBookmarkAdded } from 'react-icons/md';
import { useTranslation } from 'react-i18next';
import HiveAvatar from '../HiveAvatar/HiveAvatar';
import { useStorySeenBy, keepStoryAsShort, useInvalidateStories } from '../../lib/stories';
import { formatTimeAgo } from '../../i18n';
import { toastIn } from '../../utils/toast';
import './StoryOwnerTools.scss';

const toast = toastIn('Shorts');

/**
 * The poster's own buttons on a LIVE story in the story viewer: who has seen it,
 * and "Keep as short", which turns it into an ordinary short that stays. Both go
 * away with the story's 24h, so the caller renders this only while it is live.
 *
 * Clicks stop here: the caption block around it toggles on any click.
 */
function StoryOwnerTools({ author, hivePermlink, onKept }) {
  const { t } = useTranslation();
  const invalidateStories = useInvalidateStories();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [keeping, setKeeping] = useState(false);
  const { count, viewers, isLoading } = useStorySeenBy(author, hivePermlink);

  const stop = (e) => e.stopPropagation();

  const keep = async (e) => {
    e.stopPropagation();
    if (keeping) return;
    setKeeping(true);
    try {
      await keepStoryAsShort(author, hivePermlink);
      toast.success(t('shorts.storyTools.kept'));
      invalidateStories();
      onKept?.();
    } catch (err) {
      toast.error(err?.message || t('shorts.storyTools.keepFailed'));
    } finally {
      setKeeping(false);
      setConfirming(false);
    }
  };

  return (
    <div className="storyOwnerTools" onClick={stop}>
      <button type="button" className="storyOwnerTools__btn" onClick={() => setSheetOpen(true)}>
        <MdVisibility aria-hidden="true" />
        {t('shorts.storyTools.seenBy', { count })}
      </button>

      {confirming ? (
        <span className="storyOwnerTools__confirm">
          <span>{t('shorts.storyTools.keepConfirm')}</span>
          <button type="button" className="storyOwnerTools__btn storyOwnerTools__btn--primary" onClick={keep} disabled={keeping}>
            {keeping ? t('shorts.storyTools.keeping') : t('shorts.storyTools.keepYes')}
          </button>
          <button type="button" className="storyOwnerTools__btn" onClick={() => setConfirming(false)} disabled={keeping}>
            {t('common.actions.cancel')}
          </button>
        </span>
      ) : (
        <button type="button" className="storyOwnerTools__btn" onClick={() => setConfirming(true)} title={t('shorts.storyTools.keepHint')}>
          <MdBookmarkAdded aria-hidden="true" />
          {t('shorts.storyTools.keep')}
        </button>
      )}

      {sheetOpen && createPortal(
        <div className="storySeenOverlay" onClick={() => setSheetOpen(false)}>
          <div className="storySeenSheet" role="dialog" aria-label={t('shorts.storyTools.seenTitle')} onClick={stop}>
            <div className="storySeenSheet__head">
              <h3>{t('shorts.storyTools.seenTitle')}</h3>
              <button type="button" className="storySeenSheet__close" onClick={() => setSheetOpen(false)} aria-label={t('common.actions.close')}>×</button>
            </div>
            <p className="storySeenSheet__note">{t('shorts.storyTools.seenNote')}</p>
            {isLoading ? null : viewers.length === 0 ? (
              <p className="storySeenSheet__empty">{t('shorts.storyTools.seenEmpty')}</p>
            ) : (
              <ul className="storySeenSheet__list">
                {viewers.map((v) => (
                  <li key={v.username}>
                    <Link to={`/@${v.username}`} onClick={() => setSheetOpen(false)}>
                      <HiveAvatar username={v.username} size={null} alt={v.username} imgClassName="storySeenSheet__avatar" />
                      <span className="storySeenSheet__name">{v.username}</span>
                    </Link>
                    {v.at && <span className="storySeenSheet__when">{formatTimeAgo(v.at)}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

export default StoryOwnerTools;
