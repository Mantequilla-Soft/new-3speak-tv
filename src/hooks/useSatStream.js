import { useCallback, useEffect, useRef, useState } from 'react';
import {
  readStreamSettings, saveStreamSettings, streamedThisMonth, addStreamed, nextStreamPayment, canStreamSats,
  payStreamMinute,
} from '../lib/boosts';

/**
 * Streaming sats while a native 3Speak track plays (lib/boosts.js): every 60
 * seconds of actual playing, `rate` sats to the creator through the browser's
 * Lightning wallet, until the monthly cap. Only runs when the listener turned it
 * on; a wallet that says no turns it off again. Paused audio counts no time.
 *
 * → { available, settings, setSettings, spent, sessionSats, status }
 *   status: 'off' | 'on' | 'paying' | 'capped' | 'stopped'
 */
export default function useSatStream({ to, permlink, playing, link }) {
  const available = canStreamSats() && !!(to && permlink);
  const [settings, setSettingsState] = useState(readStreamSettings);
  const [spent, setSpent] = useState(() => streamedThisMonth());
  // Sats sent for the track now playing; a new track starts its own count.
  const trackKey = `${to}/${permlink}`;
  const [session, setSession] = useState({ key: trackKey, sats: 0 });
  const sessionSats = session.key === trackKey ? session.sats : 0;
  const [status, setStatus] = useState('off');
  const seconds = useRef(0);
  const busy = useRef(false);

  const setSettings = useCallback((next) => {
    saveStreamSettings(next);
    setSettingsState(next);
    setStatus(next.enabled ? 'on' : 'off');
  }, []);

  useEffect(() => { seconds.current = 0; }, [trackKey]);

  useEffect(() => {
    if (!available || !settings.enabled || !playing) return undefined;
    const id = setInterval(async () => {
      seconds.current += 1;
      if (seconds.current < 60 || busy.current) return;
      seconds.current = 0;
      const sats = nextStreamPayment(settings, streamedThisMonth());
      if (!sats) { setStatus('capped'); return; }
      busy.current = true;
      setStatus('paying');
      try {
        const paid = await payStreamMinute({ to, sats, link });
        addStreamed(paid);
        setSpent(streamedThisMonth());
        setSession((prev) => ({ key: trackKey, sats: (prev.key === trackKey ? prev.sats : 0) + paid }));
        setStatus('on');
      } catch (err) {
        // A refusal in the wallet, or a wallet that cannot pay: stop, never retry
        // on our own. The listener turns it on again if they want.
        console.warn('[stream-sats] payment not made:', err?.message || err);
        const off = { ...settings, enabled: false };
        saveStreamSettings(off);
        setSettingsState(off);
        setStatus('stopped');
      } finally {
        busy.current = false;
      }
    }, 1000);
    return () => clearInterval(id);
  }, [available, settings, playing, to, permlink, link, trackKey]);

  return { available, settings, setSettings, spent, sessionSats, status };
}
