import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import HiveAvatar from '../HiveAvatar/HiveAvatar';
import { Icon } from '../v2/Icon';
import { Dialog, EmptyState } from '../v2/ui';
import { useStorySeenBy, keepStoryAsShort, useInvalidateStories } from '../../lib/stories';
import { formatTimeAgo } from '../../i18n';
import { toastIn } from '../../utils/toast';
import './StoryOwnerTools.scss';

const toast = toastIn('Shorts');

/**
 * The poster's own buttons on a LIVE story in the story viewer (45b): who has
 * seen it, and "Keep as short", which turns it into an ordinary short that
 * stays. Both go away with the story's 24h, so the caller renders this only
 * while it is live.
 *
 * Clicks stop here: the caption block around it toggles on any click (and the
 * seen-by dialog is a portal whose events still bubble through this element).
 *
 * variant "panel" (24d, the phone story viewer): a scrim card at the foot of
 * the story, "Seen by N" with the first faces, then tiles: keep it, share it.
 * The keep question replaces the tiles while it is asked (45b).
 */
function StoryOwnerTools({ author, hivePermlink, onKept, onShare, variant }) {
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

  const seenDialog = (
    <Dialog
      open={sheetOpen}
      onClose={() => setSheetOpen(false)}
      title={t('shorts.storyTools.seenBy', { count })}
      sub={t('shorts.storyTools.seenNote')}
      width={400}
      closeLabel={t('common.actions.close')}
      className="storySeenSheet"
      bodyClassName="storySeenSheet__body"
    >
      {isLoading ? (
        <div className="storySeenSheet__loading" aria-busy="true">
          <Icon name="progress_activity" size={20} className="v2-spin" />
        </div>
      ) : viewers.length === 0 ? (
        <EmptyState icon="visibility_off" title={t('shorts.storyTools.seenEmpty')} />
      ) : (
        <ul className="storySeenSheet__list">
          {viewers.map((v) => (
            <li key={v.username}>
              <Link to={`/@${v.username}`} onClick={() => setSheetOpen(false)}>
                <HiveAvatar username={v.username} size={null} alt={v.username} imgClassName="storySeenSheet__avatar" />
                <span className="storySeenSheet__name">@{v.username}</span>
              </Link>
              {v.at && <span className="storySeenSheet__when">{formatTimeAgo(v.at)}</span>}
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );

  if (variant === 'panel') {
    return (
      <div className="storyOwnerPanel" onClick={stop}>
        <button type="button" className="storyOwnerPanel__seen" onClick={() => setSheetOpen(true)}>
          <Icon name="visibility" size={20} className="storyOwnerPanel__eye" />
          <b>{t('shorts.storyTools.seenBy', { count })}</b>
          {viewers.length > 0 && (
            <span className="storyOwnerPanel__faces" aria-hidden="true">
              {viewers.slice(0, 4).map((v) => (
                <HiveAvatar key={v.username} username={v.username} size={null} alt="" imgClassName="storyOwnerPanel__face" />
              ))}
            </span>
          )}
        </button>

        {confirming ? (
          <div className="storyOwnerPanel__confirm" role="group" aria-label={t('shorts.storyTools.keepConfirm')}>
            <p className="storyOwnerPanel__hint">{t('shorts.storyTools.keepHint')}</p>
            <b className="storyOwnerPanel__q">{t('shorts.storyTools.keepConfirm')}</b>
            <div className="storyOwnerPanel__answers">
              <button type="button" className="storyOwnerPanel__answer" onClick={() => setConfirming(false)} disabled={keeping}>
                {t('common.actions.cancel')}
              </button>
              <button type="button" className="storyOwnerPanel__answer is-primary" onClick={keep} disabled={keeping} aria-busy={keeping || undefined}>
                {keeping && <Icon name="progress_activity" size={16} className="v2-spin" />}
                {keeping ? t('shorts.storyTools.keeping') : t('shorts.storyTools.keepYes')}
              </button>
            </div>
          </div>
        ) : (
          <div className="storyOwnerPanel__tiles">
            <button type="button" className="storyOwnerPanel__tile" onClick={() => setConfirming(true)} title={t('shorts.storyTools.keepHint')}>
              <Icon name="push_pin" size={20} />
              <span>{t('shorts.storyTools.keep')}</span>
            </button>
            {onShare && (
              <button type="button" className="storyOwnerPanel__tile" onClick={onShare}>
                <Icon name="ios_share" size={20} />
                <span>{t('common.actions.share')}</span>
              </button>
            )}
          </div>
        )}

        {seenDialog}
      </div>
    );
  }

  return (
    <div className="storyOwnerTools" onClick={stop}>
      <button type="button" className="storyOwnerTools__btn" onClick={() => setSheetOpen(true)}>
        <Icon name="visibility" size={16} />
        {t('shorts.storyTools.seenBy', { count })}
      </button>

      {confirming ? (
        <span className="storyOwnerTools__confirm" role="group" aria-label={t('shorts.storyTools.keepConfirm')}>
          <span className="storyOwnerTools__q">{t('shorts.storyTools.keepConfirm')}</span>
          <button type="button" className="storyOwnerTools__btn" onClick={() => setConfirming(false)} disabled={keeping}>
            {t('common.actions.cancel')}
          </button>
          <button type="button" className="storyOwnerTools__btn storyOwnerTools__btn--primary" onClick={keep} disabled={keeping} aria-busy={keeping || undefined}>
            {keeping && <Icon name="progress_activity" size={16} className="v2-spin" />}
            {keeping ? t('shorts.storyTools.keeping') : t('shorts.storyTools.keepYes')}
          </button>
        </span>
      ) : (
        <button type="button" className="storyOwnerTools__btn" onClick={() => setConfirming(true)} title={t('shorts.storyTools.keepHint')}>
          <Icon name="bookmark_add" size={16} />
          {t('shorts.storyTools.keep')}
        </button>
      )}

      {seenDialog}
    </div>
  );
}

export default StoryOwnerTools;
