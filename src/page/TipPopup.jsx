import { useParams, useSearchParams } from 'react-router-dom';
import TipModal from '../components/tip-reward/TipModal';

// The post a tip is for, as the link the memo carries. `kind` comes from the
// embed that opened this page: the audio embed says audio, the video player
// video or short.
function postLink(author, permlink, kind) {
  if (!permlink) return undefined;
  if (kind === 'audio') return `https://3speak.tv/audio/${author}/${permlink}`;
  if (kind === 'short') return `https://3speak.tv/shorts?v=${author}/${permlink}`;
  return `https://3speak.tv/watch?v=${author}/${permlink}`;
}

/**
 * /tip/@author[/permlink][?kind=video|short|audio]: the tip window on its own
 * page, no app shell (App.jsx renders it bare). The embeds (audio.3speak.tv,
 * play.3speak.tv) can't tip inside their iframe, so their Tip button opens this
 * as a popup; when the tip is sent or the window closed, it closes itself.
 * Opened as a plain tab (phones, a host that blocks popups) it goes on to the
 * post instead.
 */
export default function TipPopup() {
  const { author: rawAuthor, permlink } = useParams();
  const [searchParams] = useSearchParams();
  const author = String(rawAuthor || '').replace(/^@/, '').toLowerCase();
  const memoLink = postLink(author, permlink, searchParams.get('kind'));

  const onClose = () => {
    if (window.opener) {
      window.close();
      return;
    }
    window.location.assign(memoLink ? memoLink.replace('https://3speak.tv', '') : `/@${author}`);
  };

  return (
    <TipModal
      variant="page"
      recipient={author}
      permlink={permlink}
      memoLink={memoLink}
      isOpen
      onClose={onClose}
    />
  );
}
