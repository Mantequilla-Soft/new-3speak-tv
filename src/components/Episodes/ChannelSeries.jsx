import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '../v2/ui';
import { Icon } from '../v2/Icon';
import { isSeries, seriesParts } from '../../lib/series';
import SeriesModal from './SeriesModal';
import './Series.scss';

/**
 * A channel's series (lib/series.js) above its Shorts: one card per series with
 * its cover and part count, opening the series page. On your own channel, "New
 * series" makes one from your Shorts. Nothing for a visitor when there is none.
 */
export default function ChannelSeries({ owner, playlists, isOwnProfile }) {
  const { t } = useTranslation();
  const [creating, setCreating] = useState(false);
  const series = useMemo(() => (Array.isArray(playlists) ? playlists : []).filter((p) => p.owner === owner && isSeries(p)), [playlists, owner]);
  if (!series.length && !isOwnProfile) return null;
  return (
    <section className="channel-series" aria-label={t('episodes.series.channelTitle')} data-testid="channel-series">
      <div className="channel-series__head">
        <h2>{t('episodes.series.channelTitle')}</h2>
        {isOwnProfile && (
          <Button variant="secondary" size={36} icon="video_library" onClick={() => setCreating(true)}>
            {t('episodes.series.new')}
          </Button>
        )}
      </div>
      {series.length > 0 ? (
        <div className="channel-series__row">
          {series.map((s) => (
            <Link key={s.id} to={`/playlist/${s.id}`} className="channel-series__card">
              <span className="channel-series__cover">
                {s.thumbnail ? <img src={s.thumbnail} alt="" loading="lazy" /> : <Icon name="video_library" size={28} />}
              </span>
              <b title={s.name}>{s.name}</b>
              <span className="series-badge">{t('episodes.series.parts', { count: seriesParts(s).length })}</span>
            </Link>
          ))}
        </div>
      ) : (
        <p className="series-select__none">{t('episodes.series.channelEmpty')}</p>
      )}
      {isOwnProfile && <SeriesModal open={creating} onClose={() => setCreating(false)} owner={owner} />}
    </section>
  );
}
