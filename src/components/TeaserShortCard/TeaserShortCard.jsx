import { useTranslation } from 'react-i18next';
import { Button, Icon } from '../v2/ui';
import { openTeaserEditor, rememberTeaserSource, teaserEligible, teaserSourceFor } from '../../lib/teaserSourceFile';
import './TeaserShortCard.scss';

/**
 * "Make a Short from this video" on a finished upload's screen. Shorts bring
 * viewers to long videos, and right after the upload the file is still here:
 * the Shorts editor opens with the whole video on its track
 * (lib/teaserSourceFile.js), the creator picks the moment and trims it, and the
 * Short links back to the video (EmbedUploadContext teaserOf, set by EditorModal).
 *
 * `video`: the long video just published, { file, author, permlink, duration }
 * (seconds); only 5 to 30 minutes and at most 1 GB get the card (teaserEligible).
 * `teaserOf`: on a Short's own finished screen, the video it teases; the card
 * then offers another moment of the same video, while this tab still has it.
 * Renders nothing when there is nothing to make a Short from.
 */
export default function TeaserShortCard({ video = null, teaserOf = null }) {
  const { t } = useTranslation();
  const another = !video && !!teaserSourceFor(teaserOf);
  if (!another && !(video?.author && video.permlink && teaserEligible(video))) return null;
  if (video?.file && !String(video.file.type || 'video/').startsWith('video/')) return null;

  const open = () => {
    const src = another ? teaserSourceFor(teaserOf) : rememberTeaserSource(video);
    openTeaserEditor(src);
  };

  return (
    <div className="teaser-short-card">
      <span className="teaser-short-card__icon"><Icon name="movie_edit" size={24} /></span>
      <div className="teaser-short-card__body">
        <div className="teaser-short-card__title">{t(another ? 'upload.done.teaser.anotherTitle' : 'upload.done.teaser.title')}</div>
        <p className="teaser-short-card__text">{t(another ? 'upload.done.teaser.anotherText' : 'upload.done.teaser.text')}</p>
      </div>
      <Button variant="secondary" size={40} trailing="arrow_forward" className="teaser-short-card__btn" onClick={open}>
        {t(another ? 'upload.done.teaser.anotherButton' : 'upload.done.teaser.button')}
      </Button>
    </div>
  );
}
