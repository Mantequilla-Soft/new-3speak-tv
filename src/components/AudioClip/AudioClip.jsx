import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { IconButton } from "../v2/ui";
import "./AudioClip.scss";

const fmt = (s) => {
  const v = Number.isFinite(s) && s > 0 ? s : 0;
  return `${Math.floor(v / 60)}:${String(Math.floor(v % 60)).padStart(2, "0")}`;
};

/**
 * A short audio clip in the v2 look, in place of the browser's own
 * <audio controls> bar: a round play button, the seek bar and the time in mono,
 * on a bg well. For previews (a track before it is published, an ad's voice
 * spot), not for listening sessions: those go through the global audio player.
 */
export default function AudioClip({ src, preload = "metadata", autoPlay = false, className = "" }) {
  const { t } = useTranslation();
  const ref = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => { setPlaying(false); setTime(0); }, [src]);

  const toggle = () => {
    const a = ref.current;
    if (!a) return;
    if (a.paused) a.play()?.catch?.(() => {});
    else a.pause();
  };
  const seek = (e) => {
    const a = ref.current;
    if (!a || !duration) return;
    a.currentTime = (Number(e.target.value) / 1000) * duration;
    setTime(a.currentTime);
  };
  const readDuration = (e) => {
    const d = e.currentTarget.duration;
    if (Number.isFinite(d)) setDuration(d);
  };
  const pct = duration ? Math.min(100, (time / duration) * 100) : 0;

  return (
    <div className={`audio-clip ${className}`.trim()}>
      <audio
        ref={ref}
        src={src}
        preload={preload}
        autoPlay={autoPlay}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onLoadedMetadata={readDuration}
        onDurationChange={readDuration}
      />
      <IconButton
        icon={playing ? "pause" : "play_arrow"}
        fill
        label={playing ? t("common.actions.pause") : t("common.actions.play")}
        size={32}
        variant="secondary"
        round
        onClick={toggle}
      />
      <input
        type="range"
        className="audio-clip__seek"
        min="0"
        max="1000"
        step="1"
        value={Math.round(pct * 10)}
        onChange={seek}
        disabled={!duration}
        aria-label={t("audio.inline.kickerPreview")}
        aria-valuetext={`${fmt(time)} / ${fmt(duration)}`}
        style={{ "--p": `${pct}%` }}
      />
      <span className="audio-clip__time">{fmt(time)} / {fmt(duration)}</span>
    </div>
  );
}
