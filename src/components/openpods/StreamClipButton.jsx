import { useEffect, useState, useCallback } from 'react';
import { Scissors } from 'lucide-react';
import { toastIn } from '../../utils/toast';

// Every toast from this module is headed "Live"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Live');

// Viewer-facing "clip the last 30s" button for a live OpenPods stream. Only a
// Pro host has DVR running, so the button appears only while /dvr/status reports
// recording=true (which also hides it for non-Pro hosts). Both endpoints are
// public; /clip is rate-limited server-side.
const HANGOUTS_API_URL = (import.meta.env.VITE_HANGOUTS_API_URL || '').replace(/\/$/, '');

export default function StreamClipButton({ roomName, variant = 'inline' }) {
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!roomName || !HANGOUTS_API_URL) return undefined;
    let alive = true;
    const check = () => {
      fetch(`${HANGOUTS_API_URL}/rooms/${encodeURIComponent(roomName)}/dvr/status`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (alive) setAvailable(!!d?.recording); })
        .catch(() => { if (alive) setAvailable(false); });
    };
    check();
    // Poll fairly often so the button appears soon after the host goes live —
    // a viewer who opened the page during standby would otherwise wait a long
    // time (DVR only starts on Start) for the button to show.
    const t = setInterval(check, 5000);
    return () => { alive = false; clearInterval(t); };
  }, [roomName]);

  const clip = useCallback(async () => {
    if (busy || !HANGOUTS_API_URL) return;
    setBusy(true);
    try {
      const r = await fetch(`${HANGOUTS_API_URL}/rooms/${encodeURIComponent(roomName)}/dvr/clip`, { method: 'POST' });
      if (!r.ok) throw new Error(String(r.status));
      const { path } = await r.json();
      // Fetch the file and SAVE it (download) rather than opening a new tab. The
      // clip host sends CORS, so the cross-origin blob fetch is allowed; the
      // object URL is same-origin so the <a download> actually downloads.
      const fileResp = await fetch(`${HANGOUTS_API_URL}${path}`);
      if (!fileResp.ok) throw new Error('fetch');
      const blob = await fileResp.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = `3speak-clip-${Date.now()}.mp4`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objUrl), 15000);
      toast.success('Clip saved to your downloads.');
    } catch (e) {
      const msg = String(e?.message) === '429'
        ? 'Slow down a moment, then clip again.'
        : 'Could not make a clip. Try again in a few seconds.';
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }, [busy, roomName]);

  if (!available) return null;

  if (variant === 'sidebar') {
    return (
      <div className="actionItem" onClick={clip} role="button" title="Clip the last 30 seconds">
        <div className={`actionButton${busy ? ' liked' : ''}`}><Scissors size={22} /></div>
        <span className="actionLabel">{busy ? '…' : '30 sec'}</span>
      </div>
    );
  }
  return (
    <button type="button" className="pv-btn" onClick={clip} disabled={busy} title="Clip the last 30 seconds">
      <Scissors size={14} /><span>{busy ? 'Clipping…' : '30 sec'}</span>
    </button>
  );
}
