import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StatusPill, Button } from '../v2/ui';
import './Premiere.scss';

// Further behind the shared second than this and "Back to the premiere" shows.
export const BEHIND_S = 15;

/**
 * Under the player while a premiere runs: the "Premiere" badge, how long ago it
 * started, and, when the viewer paused or scrubbed back, a way back to the
 * second everyone else is at.
 */
export default function PremiereBar({ premiere, serverNow, currentTime = 0, onJump }) {
  const { t } = useTranslation();
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const id = setInterval(() => setNow(serverNow()), 5000);
    return () => clearInterval(id);
  }, [serverNow]);
  const into = Math.max(0, (now - Date.parse(premiere.startAt)) / 1000);
  const playing = !(premiere.duration > 0) || into < premiere.duration;
  const minutes = Math.floor(into / 60);
  const behind = playing && into - currentTime > BEHIND_S;
  return (
    <div className="premiere-bar" role="status">
      <StatusPill tone="live" icon="theaters">{t('premieres.badge')}</StatusPill>
      <span className="premiere-bar__text">
        {playing
          ? (minutes < 1 ? t('premieres.startedJustNow') : t('premieres.startedAgo', { count: minutes }))
          : t('premieres.chatStillOpen')}
      </span>
      {behind && (
        <Button variant="secondary" size={32} icon="fast_forward" onClick={() => onJump?.(into)} className="premiere-bar__jump">
          {t('premieres.backToLive')}
        </Button>
      )}
    </div>
  );
}
