import React, { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useAppStore } from '../../lib/store';
import { getEditorUrl } from '../../utils/config';
import { mintDraftSession } from '../../utils/editorDraftSession';

// The Ad Wizard (the editor's ?mode=ads) in an iframe, with the page side of its handshake:
//   editor-ready  -> theme, brand prefill, drafts session (server drafts: 5 ads, 90 days)
//   drafts-sign-in -> drafts session, interactive (wallet logins sign once)
//   ad-use        -> onUse({ outputUrl, format, width, height, duration, name }) ("Use for my campaign")
// Props: format ('landscape' | 'portrait' | null = free choice), maxSeconds, brand { name, logo }, onUse.
export default function AdWizardFrame({ format = null, maxSeconds = null, brand = null, onUse = null }) {
  const { user, getEffectiveTheme } = useAppStore();
  const [src, setSrc] = useState(null);
  const frameRef = useRef(null);
  const userRef = useRef(user);
  useEffect(() => { userRef.current = user; }, [user]);
  const latest = useRef({ brand, onUse });
  useEffect(() => { latest.current = { brand, onUse }; }, [brand, onUse]);

  useEffect(() => {
    let alive = true;
    getEditorUrl().then((u) => {
      if (!alive || !u) return;
      const q = new URLSearchParams({ mode: 'ads' });
      if (format) q.set('format', format);
      if (maxSeconds) q.set('max', String(Math.round(maxSeconds)));
      if (onUse) q.set('target', 'booking');
      setSrc(`${u.replace(/\/+$/, '')}/?${q}`);
    });
    return () => { alive = false; };
  }, [format, maxSeconds]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!src) return undefined;
    const origin = new URL(src).origin;
    const send = (msg) => frameRef.current?.contentWindow?.postMessage(msg, origin);
    const sendSession = async (interactive) => send({ type: 'drafts-session', ...(await mintDraftSession(userRef.current, interactive)) });
    const onMsg = (e) => {
      if (e.origin !== origin || e.source !== frameRef.current?.contentWindow || e.data?.source !== '3speak-editor') return;
      const d = e.data;
      if (d.type === 'editor-ready') {
        send({ type: 'set-theme', theme: getEffectiveTheme() });
        const b = latest.current.brand;
        if (b && (b.name || b.logo)) send({ type: 'ad-prefill', brand: { name: b.name || null, logo: b.logo || null } });
        if (d.canSaveDrafts) sendSession(false);
      } else if (d.type === 'drafts-sign-in') {
        sendSession(true);
      } else if (d.type === 'ad-use' && typeof d.outputUrl === 'string') {
        latest.current.onUse?.(d);
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [src, getEffectiveTheme]);

  if (!src) return <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}><Loader2 className="animate-spin" /></div>;
  return <iframe ref={frameRef} title="Ad Wizard" src={src} allow="autoplay; clipboard-read; clipboard-write" style={{ width: '100%', height: '100%', border: 0 }} />;
}
