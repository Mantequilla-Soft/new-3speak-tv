/**
 * On the host's own stream recording (VOD) without chapters: chapters made from
 * the stream's highlights (lib/streamClips.js chaptersFromHighlights: the
 * moments chat lit up or boosts came in, and the clips viewers made), shown as
 * a short list with "Use as chapters", which opens the edit dialog with them
 * filled in. Nothing is written until the host saves there.
 *
 * Renders nothing for anyone else, for a stream with too few highlights, or
 * when the stream's server no longer has them (moments are kept 30 days).
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHangout } from '../../context/HangoutContext';
import { findRoomEndpoint } from '../../utils/hangoutsEndpoints';
import { chaptersFromHighlights, clipClock, fetchStreamHighlights } from '../../lib/streamClips';
import { Button, Icon } from '../v2/ui';
import './StreamClips.scss';

const PREVIEW = 6;

export default function StreamChapters({ room, duration = 0, onUse }) {
  const { t } = useTranslation();
  const { sessionToken } = useHangout();
  const [chapters, setChapters] = useState([]);

  useEffect(() => {
    setChapters([]);
    if (!room || !sessionToken) return undefined;
    let alive = true;
    (async () => {
      try {
        const ep = await findRoomEndpoint(room);
        const data = await fetchStreamHighlights(ep?.api, room, sessionToken);
        if (alive && data?.isHost) setChapters(chaptersFromHighlights(data, duration));
      } catch { /* no highlights: no card */ }
    })();
    return () => { alive = false; };
  }, [room, sessionToken, duration]);

  if (!chapters.length) return null;
  const more = chapters.length - PREVIEW;

  return (
    <section className="stream-chapters" aria-labelledby="stream-chapters-title">
      <div className="stream-chapters__text">
        <h3 id="stream-chapters-title" className="stream-chapters__title"><Icon name="format_list_numbered" size={18} />{t('streamClips.chapters.title')}</h3>
        <p className="stream-chapters__sub">{t('streamClips.chapters.sub')}</p>
      </div>
      <ol className="stream-chapters__list">
        {chapters.slice(0, PREVIEW).map((c) => (
          <li key={c.start}><b className="num">{clipClock(c.start)}</b><span>{c.title}</span></li>
        ))}
      </ol>
      {more > 0 && <p className="stream-chapters__more">{t('streamClips.chapters.more', { count: more })}</p>}
      <Button variant="primary" size={40} icon="edit" onClick={() => onUse?.(chapters)}>{t('streamClips.chapters.use')}</Button>
    </section>
  );
}
