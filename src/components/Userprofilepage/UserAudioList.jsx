import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import { CHECKER_URL } from '../../utils/config';
import { useProfileAudioPlaylists } from '../../lib/profileLayout';
import AudioTile from '../AudioTile/AudioTile';
import AudioPlaylistTile from '../AudioPlaylistTile/AudioPlaylistTile';
import BarLoader from '../Loader/BarLoader';
import ProfileEmptyState from './ProfileEmptyState';
import './UserAudioList.scss';

// A podcast here = a public playlist of this creator's that holds nothing but
// audio. The checker's /audio/playlists returns every playlist with at least
// one track; `totalItems` counts its videos too, so equal counts mean audio-only.
const isAudioOnly = (p) => p.trackCount > 0 && p.trackCount === p.totalItems;

// `limit` renders only the newest N (the Overview tab shows a preview row, and
// has its own albums section, so podcasts only show on the full Audio tab).
function UserAudioList({ user, limit = 0, isOwnProfile = false }) {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: audio = [], isLoading } = useQuery({
    queryKey: ['user-audio', user],
    queryFn: async () => {
      const { data } = await axios.get(`${CHECKER_URL}/audio?owner=${encodeURIComponent(user)}&limit=100&sort=newest`);
      return data?.audio || [];
    },
    enabled: !!user,
  });
  const { data: playlists = [] } = useProfileAudioPlaylists(limit > 0 ? null : user);
  const podcasts = limit > 0 ? [] : playlists.filter(isAudioOnly);

  if (isLoading) return <BarLoader />;
  if (audio.length === 0 && podcasts.length === 0) {
    return <ProfileEmptyState kind="audio" isOwnProfile={isOwnProfile} username={user} />;
  }

  const shown = limit > 0 ? audio.slice(0, limit) : audio;
  const grid = audio.length > 0 && (
    <div className="audio-tile-grid user-audio-list-grid">
      {shown.map((item) => (
        <AudioTile key={item._id || item.permlink} item={item} contextItems={audio} />
      ))}
    </div>
  );

  if (podcasts.length === 0) return grid;

  // On a phone the two sections become sub-tabs (Playlists / Audio) instead of
  // one long stack; desktop keeps both headed sections. The sub-tab lives in the
  // URL (`?tab=audio&sub=audio`) so back-navigation from a tile lands on it.
  const sub = grid && searchParams.get('sub') === 'audio' ? 'audio' : 'playlists';
  const selectSub = (next) => {
    const params = new URLSearchParams(searchParams);
    params.set('sub', next);
    setSearchParams(params, { replace: true });
  };
  const subTab = (key, label, count) => (
    <button
      type="button"
      role="tab"
      aria-selected={sub === key}
      className={`user-audio-subtab${sub === key ? ' active' : ''}`}
      onClick={() => selectSub(key)}
    >
      {label} ({count})
    </button>
  );

  return (
    <>
      {grid && (
        <div className="user-audio-subtabs" role="tablist">
          {subTab('playlists', t('profile.tabs.playlists'), podcasts.length)}
          {subTab('audio', t('profile.tabs.audio'), audio.length)}
        </div>
      )}
      <section className={`user-audio-section${grid && sub !== 'playlists' ? ' is-sub-hidden' : ''}`}>
        <h3 className="user-audio-heading">{t('audio.page.sections.podcasts')}</h3>
        <div className="audio-tile-grid user-audio-list-grid">
          {podcasts.map((p) => <AudioPlaylistTile key={p.id} playlist={p} />)}
        </div>
      </section>
      {grid && (
        <section className={`user-audio-section${sub !== 'audio' ? ' is-sub-hidden' : ''}`}>
          <h3 className="user-audio-heading">{t('profile.audioTab.files')}</h3>
          {grid}
        </section>
      )}
    </>
  );
}

export default UserAudioList;
