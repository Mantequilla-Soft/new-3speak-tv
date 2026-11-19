import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../v2/ui';
import './StreamVolume.scss';

// The viewer's sound for live streams: one level for every stream, kept on
// this device. The SDK applies it (StandaloneWatch `audioVolume`/`audioMuted`).
const STORE_KEY = '3speak-stream-volume';

const clamp01 = (v) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1);

function readSaved() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    return { volume: clamp01(Number(s?.volume ?? 1)), muted: s?.muted === true };
  } catch {
    return { volume: 1, muted: false };
  }
}

/** { volume 0..1, muted, setVolume(v), toggleMute() }, remembered across streams. */
export function useStreamVolume() {
  const [state, setState] = useState(readSaved);
  const save = useCallback((next) => {
    setState(next);
    try { localStorage.setItem(STORE_KEY, JSON.stringify(next)); } catch { /* this visit only */ }
  }, []);
  const setVolume = useCallback((v) => {
    const volume = clamp01(v);
    // Sliding to zero is muting; sliding up again unmutes.
    save({ volume, muted: volume === 0 });
  }, [save]);
  const toggleMute = useCallback(() => {
    // Unmuting a level of zero would still be silent: come back at half.
    save(state.muted ? { volume: state.volume || 0.5, muted: false } : { ...state, muted: true });
  }, [save, state]);
  return { volume: state.volume, muted: state.muted, setVolume, toggleMute };
}

const iconFor = (volume, muted) => (muted || volume === 0 ? 'volume_off' : volume < 0.5 ? 'volume_down' : 'volume_up');

/**
 * Mute button and level slider for a live stream.
 *  - `overlay`: over the player, bottom left (the slider only where there is
 *    a mouse: on a touch screen the hardware buttons set the level).
 *  - `rail`: the phone stream page's action rail, a mute switch.
 */
export default function StreamVolumeControl({ volume, muted, onVolume, onToggleMute, variant = 'overlay' }) {
  const { t } = useTranslation();
  const icon = iconFor(volume, muted);
  const muteLabel = muted ? t('player.controls.unmute') : t('player.controls.mute');

  if (variant === 'rail') {
    return (
      <div className="actionItem" onClick={onToggleMute} role="button" aria-pressed={muted} aria-label={muteLabel}>
        <div className="actionButton"><Icon name={icon} size={24} /></div>
        <span className="actionLabel">{t('misc.watchStream.sound')}</span>
      </div>
    );
  }
  return (
    <div className="stream-volume" onClick={(e) => e.stopPropagation()}>
      <button type="button" className="stream-volume__btn" onClick={onToggleMute} aria-pressed={muted} aria-label={muteLabel} title={muteLabel}>
        <Icon name={icon} size={20} />
      </button>
      <input
        type="range"
        className="stream-volume__slider"
        min={0}
        max={100}
        step={1}
        value={Math.round((muted ? 0 : volume) * 100)}
        onChange={(e) => onVolume(Number(e.target.value) / 100)}
        aria-label={t('misc.watchStream.volume')}
        title={t('misc.watchStream.volume')}
      />
    </div>
  );
}
