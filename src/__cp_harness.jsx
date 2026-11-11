// TEMPORARY visual harness for the comments-player facelift agent. Delete me.
import './polyfills';
import './styles/design-system.scss';
import 'material-symbols/rounded.css';
import './index.css';
import '@fontsource/roboto/400.css';
import '@fontsource/roboto/500.css';
import '@fontsource/roboto/700.css';
import '@fontsource/roboto/900.css';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { initLanguage } from './i18n';
import VideoControls from './components/VideoControls/VideoControls';
import SubtitleOverlay from './components/SubtitleOverlay/SubtitleOverlay';
import PlaylistBar from './components/PlaylistBar/PlaylistBar';
import ReactionPlayer from './components/ReactionPlayer/ReactionPlayer';

const params = new URLSearchParams(window.location.search);
const theme = params.get('theme') || 'dark';
document.documentElement.setAttribute('data-theme', theme);

const noop = () => {};
const chapters = [
  { start: 0, end: 40, title: 'Setting the scene' },
  { start: 40, end: 80, title: 'Daytime visitors' },
  { start: 80, end: 150, title: 'Roe deer at dawn' },
  { start: 150, end: 192, title: 'Night teaser' },
];
const markers = [
  { time: 25, avatar: '/img/u/badadib/avatar/small', label: '@badadib', replyCount: 0 },
  { time: 70, avatar: '/img/u/badadib/avatar/small', label: '@badadib', replyCount: 3, isVideo: true },
  { time: 120, avatar: '/img/u/badadib/avatar/small', label: '@badadib', replyCount: 2 },
];
const heat = Array.from({ length: 40 }, (_, i) => Math.abs(Math.sin(i / 5)) * (i > 20 ? 1 : 0.5));
const videos = Array.from({ length: 6 }, (_, i) => ({ author: 'badadib', permlink: `p${i}`, title: `Test video ${i + 1}`, duration: 75 + i * 10 }));
const reactions = [
  { id: 'a', type: 'comment', author: 'badadib', avatar: '/img/u/badadib/avatar/small', body: 'Nice moment here', pct: 20, replyCount: 2 },
  { id: 'b', type: 'comment', author: 'badadib', avatar: '/img/u/badadib/avatar/small', body: 'Second reaction', pct: 60, replyCount: 0 },
];

function Player() {
  return (
    <div style={{ position: 'relative', aspectRatio: '16/9', width: '100%', maxWidth: 900, borderRadius: 24, overflow: 'hidden', background: 'repeating-linear-gradient(135deg, var(--thumb-a) 0 16px, var(--thumb-b) 16px 32px)' }}>
      <SubtitleOverlay currentTime={10} cues={[{ start: 0, end: 20, text: 'The kestrel lands on the wire' }]} style={{ fontSize: 'medium', bgOpacity: 0.7 }} />
      <VideoControls
        currentTime={73} duration={192} buffered={0.6} isPlaying isMuted={false} volume={0.8} isFullscreen={false}
        onSeekBackward={noop} onSeekForward={noop} onTogglePlay={noop} onToggleMute={noop} onVolumeChange={noop}
        onToggleFullscreen={noop} onSeek={noop} isVisible markers={markers} chapters={chapters} replayHeatmap={heat}
        onMarkerSelect={noop} onReactToMoment={noop} onCycleReactionSize={noop} reactionSizeLabel="Std"
        qualityLevels={[{ index: 0, height: 1080 }, { index: 1, height: 720 }, { index: 2, height: 480 }, { index: 3, height: 360 }]}
        currentQuality={-1} onQualityChange={noop} glowMode="page" onToggleGlow={noop} autoplayNext onToggleAutoplay={noop}
        subtitleLanguages={[{ lang: 'en' }, { lang: 'es' }, { lang: 'de' }]} selectedSubtitleLang="en" onSubtitleChange={noop}
        subtitleStyle={{ fontFamily: 'sans-serif', fontSize: 'large', color: '#ffffff', borderWidth: 0, bgOpacity: 0.7 }}
        onSubtitleStyleChange={noop} playbackRate={1} onPlaybackRateChange={noop}
      />
    </div>
  );
}

initLanguage().finally(() => {
  createRoot(document.getElementById('root')).render(
    <MemoryRouter>
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 24, background: 'var(--bg)', minHeight: '100vh' }}>
        <Player />
        <div style={{ maxWidth: 900 }}>
          <PlaylistBar playlist={{ id: 'x', name: 'Trail cams' }} videos={videos} currentIndex={2} onClose={noop} />
        </div>
        <div style={{ maxWidth: 380 }}>
          <ReactionPlayer reactions={reactions} selectedIndex={0} onSelectReaction={noop} onClose={noop} size="standard" onCycleSize={noop} currentTime={10} duration={192} />
        </div>
      </div>
    </MemoryRouter>,
  );
});
