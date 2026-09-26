import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MdCasino, MdPlayArrow } from 'react-icons/md';
import { useAppStore } from '../lib/store';
import { TAG_CATEGORIES } from '../utils/tagsV2';
import { toastIn } from '../utils/toast';
import {
  CHANNELS, getChannel, channelNumber, channelTitle, findNextOnChannel, loadLastChannel, surfUrl,
} from '../utils/surf';
import './Surf.scss';

const toast = toastIn('Channel Surf');

/**
 * Channel Surf: pick a topic, and the watch page keeps playing the best-ranked
 * videos on it, with a big Flip button to skip ahead and a channel rocker.
 */
function Surf() {
  const navigate = useNavigate();
  const interests = useAppStore((s) => s.interests);
  const [tuning, setTuning] = useState(null); // slug being tuned to
  const busyRef = useRef(false);
  const last = useMemo(() => loadLastChannel(), []);

  const yours = useMemo(
    () => (Array.isArray(interests) ? interests.map(getChannel).filter(Boolean) : []),
    [interests],
  );

  const tuneIn = async (slug) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setTuning(slug);
    try {
      const video = await findNextOnChannel(slug);
      if (!video) {
        toast(`Nothing on air on ${getChannel(slug)?.label || slug} right now`);
        return;
      }
      navigate(surfUrl(video, slug));
    } catch {
      toast.error('Could not tune in. Try again in a moment.');
    } finally {
      busyRef.current = false;
      setTuning(null);
    }
  };

  const surprise = () => {
    const pool = yours.length ? yours : CHANNELS;
    tuneIn(pool[Math.floor(Math.random() * pool.length)].slug);
  };

  const tile = (c) => (
    <button
      key={c.slug}
      type="button"
      className={`surf-tile${c.isCategory ? ' surf-tile--category' : ''}${tuning === c.slug ? ' is-tuning' : ''}`}
      onClick={() => tuneIn(c.slug)}
      disabled={!!tuning}
    >
      <span className="surf-tile__screen">
        <span className="surf-tile__emoji" aria-hidden="true">{c.emoji}</span>
        <span className="surf-tile__noise" aria-hidden="true" />
      </span>
      <span className="surf-tile__meta">
        <span className="surf-tile__num">CH {channelNumber(c)}</span>
        <span className="surf-tile__label">{tuning === c.slug ? 'Tuning…' : channelTitle(c)}</span>
      </span>
    </button>
  );

  return (
    <div className="surf-page">
      <header className="surf-hero">
        <div className="surf-hero__tv" aria-hidden="true">
          <span className="surf-hero__antenna" />
          <span className="surf-hero__screen"><span className="surf-hero__noise" />📺</span>
        </div>
        <div className="surf-hero__text">
          <h1>Channel Surf</h1>
          <p>
            Pick a channel and lean back. We line up the best videos on that topic one
            after another. Bored? Hit <strong>Flip</strong>. Want something else? Change the channel.
          </p>
          <div className="surf-hero__actions">
            {last && (
              <button type="button" className="surf-btn surf-btn--primary" onClick={() => tuneIn(last.slug)} disabled={!!tuning}>
                <MdPlayArrow aria-hidden="true" /> Back to CH {channelNumber(last)} {last.emoji} {channelTitle(last)}
              </button>
            )}
            <button type="button" className={`surf-btn${last ? '' : ' surf-btn--primary'}`} onClick={surprise} disabled={!!tuning}>
              <MdCasino aria-hidden="true" /> Surprise me
            </button>
          </div>
        </div>
      </header>

      {yours.length > 0 && (
        <section className="surf-section">
          <h2>Your channels</h2>
          <div className="surf-grid">{yours.map(tile)}</div>
        </section>
      )}

      {TAG_CATEGORIES.map((cat) => (
        <section className="surf-section" key={cat.slug}>
          <h2><span aria-hidden="true">{cat.emoji}</span> {cat.label}</h2>
          <div className="surf-grid">
            {[cat.slug, ...cat.topics.map((t) => t.slug)].map((slug) => tile(getChannel(slug)))}
          </div>
        </section>
      ))}
    </div>
  );
}

export default Surf;
