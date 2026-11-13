import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../lib/store';
import { TAG_CATEGORIES } from '../utils/tagsV2';
import { toastIn } from '../utils/toast';
import {
  CHANNELS, getChannel, channelLabel, channelNumber, channelTitle, findNextOnChannel, loadLastChannel, surfUrl,
} from '../utils/surf';
import { useTranslation, Trans } from 'react-i18next';
import { Button, Eyebrow, Icon } from '../components/v2/ui';
import { cx } from '../components/v2/helpers';
import './Surf.scss';

const toast = toastIn('Channel Surfing');

/**
 * Channel Surfing: pick a topic, and the watch page keeps playing the best-ranked
 * videos on it, with a big Zap button to skip ahead and a channel rocker.
 */
function Surf() {
  const { t } = useTranslation();
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
        toast(t('feeds.surf.nothingOnAir', { channel: channelLabel(getChannel(slug)) || slug }));
        return;
      }
      navigate(surfUrl(video, slug));
    } catch {
      toast.error(t('feeds.surf.tuneFailed'));
    } finally {
      busyRef.current = false;
      setTuning(null);
    }
  };

  const surprise = () => {
    const pool = yours.length ? yours : CHANNELS;
    tuneIn(pool[Math.floor(Math.random() * pool.length)].slug);
  };

  // A row of the TV-style guide (34a): the channel number in a box, then the
  // channel. The channel you were on last is marked in cyan; the one being
  // tuned to shows static.
  const tile = (c) => {
    const isTuning = tuning === c.slug;
    return (
      <button
        key={c.slug}
        type="button"
        className={cx('surf-tile', c.isCategory && 'surf-tile--category', isTuning && 'is-tuning', last?.slug === c.slug && 'is-last')}
        onClick={() => tuneIn(c.slug)}
        disabled={!!tuning}
      >
        <span className="surf-tile__num">
          {channelNumber(c)}
          {isTuning && <span className="surf-tile__noise" aria-hidden="true" />}
        </span>
        <span className="surf-tile__body">
          <span className="surf-tile__label">
            {/* The channel number is the tile's mark (design 34); no emoji icons. */}
            {channelTitle(c)}
          </span>
          {isTuning && <span className="surf-tile__sub">{t('feeds.surf.tuning')}</span>}
        </span>
      </button>
    );
  };

  return (
    <div className="surf-page">
      <header className="surf-hero">
        <span className="surf-hero__icon" aria-hidden="true">
          <Icon name="live_tv" size={28} />
          <span className="surf-tile__noise" />
        </span>
        <div className="surf-hero__text">
          <h1>{t('feeds.surf.pageTitle')}</h1>
          <p>
            <Trans i18nKey="feeds.surf.intro" components={{ b: <strong /> }} />
          </p>
        </div>
        <div className="surf-hero__actions">
          {last && (
            <Button variant="primary" size={44} icon="play_arrow" onClick={() => tuneIn(last.slug)} disabled={!!tuning}>
              {t('feeds.surf.backTo', { number: channelNumber(last), emoji: '', title: channelTitle(last) })}
            </Button>
          )}
          <Button variant={last ? 'secondary' : 'primary'} size={44} icon="casino" onClick={surprise} disabled={!!tuning}>
            {t('feeds.surf.surprise')}
          </Button>
        </div>
      </header>

      {yours.length > 0 && (
        <section className="surf-section">
          <Eyebrow as="h2" className="surf-section__title">{t('feeds.surf.yourChannels')}</Eyebrow>
          <div className="surf-grid">{yours.map(tile)}</div>
        </section>
      )}

      {TAG_CATEGORIES.map((cat) => (
        <section className="surf-section" key={cat.slug}>
          <Eyebrow as="h2" className="surf-section__title">{t(cat.labelKey)}</Eyebrow>
          <div className="surf-grid">
            {[cat.slug, ...cat.topics.map((topic) => topic.slug)].map((slug) => tile(getChannel(slug)))}
          </div>
        </section>
      ))}
    </div>
  );
}

export default Surf;
