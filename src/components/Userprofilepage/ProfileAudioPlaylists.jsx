import AudioPlaylistTile from '../AudioPlaylistTile/AudioPlaylistTile';

// A creator's albums and audio playlists on their Overview. The data comes from
// useProfileAudioPlaylists (lib/profileLayout.js).
export default function ProfileAudioPlaylists({ playlists = [] }) {
  return (
    <div className="audio-tile-grid">
      {playlists.map((p) => <AudioPlaylistTile key={p.id} playlist={p} kind={p._kind} />)}
    </div>
  );
}
