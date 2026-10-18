import { useEffect, useState } from "react";
import { LiveKitRoom } from "@livekit/components-react";
import { useChat } from "@snapie/hangouts-react";
import { useTranslation } from "react-i18next";
import { getHangoutsEndpoints, defaultEndpoint } from "../utils/hangoutsEndpoints";
import "./ObsChatOverlay.scss";

// A streamer's live chat for OBS. The URL carries the user's chat overlay key
// (copied from the Templates tab of the Stream Studio), so one link covers all
// their streams: we poll the hangouts API for the room they are live in and
// join it as a silent observer (read-only, not counted as a viewer).
//
// Two ways to use it:
//  - `dock=1` (what the card copies): an OBS Custom Browser Dock, so the
//    streamer can read new messages. Solid background, messages stay, and a
//    status line says whether the stream is live.
//  - without it: a Browser Source over the video (for a stream shared outside
//    3Speak, which already shows the chat next to the stream). Transparent,
//    messages fade, and offline it renders nothing.
//
// Query options: fade (seconds before a message fades, 0 = never), max
// (lines), size (text px). Defaults: dock 0 / 50 / 14, overlay 30 / 10 / 20.

const API = (import.meta.env.VITE_HANGOUTS_TEMPLATES_API_URL || import.meta.env.VITE_HANGOUTS_API_URL || "")
  .replace(/\/$/, "");
const POLL_MS = 5000;

function clampInt(raw, min, max, fallback) {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function readOptions() {
  const p = new URLSearchParams(window.location.search);
  const dock = p.get("dock") === "1";
  return {
    key: p.get("key") || "",
    dock,
    fade: clampInt(p.get("fade"), 0, 3600, dock ? 0 : 30),
    max: clampInt(p.get("max"), 1, 50, dock ? 50 : 10),
    size: clampInt(p.get("size"), 10, 64, dock ? 14 : 20),
  };
}

/** The LiveKit URL of the deployment the templates (and their rooms) live on. */
function livekitUrl() {
  return (getHangoutsEndpoints().find((e) => e.api === API) || defaultEndpoint()).lk;
}

/** Display name for a chat identity: the streamer's own viewer identity is `<host>~watch`. */
function displayName(msg) {
  const n = msg.name && msg.name !== msg.identity ? msg.name : msg.identity;
  return String(n || "").replace(/~watch$/, "");
}

function Avatar({ msg }) {
  const id = String(msg.identity || "").replace(/~watch$/, "");
  const [failed, setFailed] = useState(false);
  if (id.startsWith("guest-") || failed || !id) {
    return <span className="obs-chat__avatar obs-chat__avatar--letter">{displayName(msg).charAt(0).toUpperCase() || "?"}</span>;
  }
  return <img className="obs-chat__avatar" src={`/img/u/${encodeURIComponent(id)}/avatar/small`} alt="" onError={() => setFailed(true)} />;
}

/**
 * One chat line. It notes when it arrived HERE (the sender's timestamp comes
 * from their clock, which can be off by minutes) and fades itself out.
 */
function ChatLine({ msg, fade }) {
  const [fading, setFading] = useState(false);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    if (!fade) return undefined;
    const ms = fade * 1000;
    const t1 = setTimeout(() => setFading(true), Math.max(0, ms - 1000));
    const t2 = setTimeout(() => setGone(true), ms);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [fade]);

  if (gone) return null;
  return (
    <li className={`obs-chat__msg${fading ? " is-fading" : ""}`}>
      <Avatar msg={msg} />
      <span className="obs-chat__body">
        <span className="obs-chat__name">{displayName(msg)}</span>
        <span className="obs-chat__text">{msg.text}</span>
      </span>
    </li>
  );
}

function ChatFeed({ fade, max, dock }) {
  const { t } = useTranslation();
  const { messages } = useChat();
  if (dock && messages.length === 0) {
    return <p className="obs-chat__status">{t("live.obs.chatOverlay.empty")}</p>;
  }
  return (
    <ul className="obs-chat__list">
      {messages.slice(-max).map((m) => <ChatLine key={m.id} msg={m} fade={fade} />)}
    </ul>
  );
}

export default function ObsChatOverlay() {
  const { t } = useTranslation();
  const [opts] = useState(readOptions);
  const [room, setRoom] = useState(null);
  // The observer token together with the room it was minted for, so a room
  // change never pairs the new room with the old token for a render.
  const [grant, setGrant] = useState(null);
  const [invalid, setInvalid] = useState(false);

  // OBS's Browser Source injects a transparent body, but the app's own CSS
  // may paint one. A dock gets a solid background instead.
  useEffect(() => {
    const els = [document.documentElement, document.body];
    const prev = els.map((el) => el.style.background);
    els.forEach((el) => { el.style.background = opts.dock ? "#0f1117" : "transparent"; });
    return () => els.forEach((el, i) => { el.style.background = prev[i]; });
  }, [opts.dock]);

  // Which room is the template live in right now?
  const missingKey = !opts.key || !API;
  useEffect(() => {
    if (missingKey) return undefined;
    let alive = true;
    const poll = async () => {
      try {
        const r = await fetch(`${API}/overlay/${encodeURIComponent(opts.key)}`, { cache: "no-store" });
        if (!alive) return;
        if (r.status === 404) { setInvalid(true); return; }
        if (!r.ok) return; // keep the last known state through a blip
        const s = await r.json();
        setInvalid(false);
        setRoom(s.live ? s.room : null);
      } catch { /* network blip: try again next tick */ }
    };
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => { alive = false; clearInterval(id); };
  }, [opts.key, missingKey]);

  // A read-only observer token for that room.
  useEffect(() => {
    if (!room) return undefined;
    let alive = true;
    fetch(`${API}/rooms/${encodeURIComponent(room)}/listen`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ silent: true }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d?.token) setGrant({ room, token: d.token }); })
      .catch(() => { /* the next room change or remount retries */ });
    return () => { alive = false; };
  }, [room]);

  const style = { "--obs-chat-size": `${opts.size}px` };
  const cls = `obs-chat${opts.dock ? " obs-chat--dock" : ""}`;

  if (missingKey || invalid) {
    return <div className={cls} style={style}><p className="obs-chat__invalid">{t("live.obs.chatOverlay.invalid")}</p></div>;
  }
  const token = grant && grant.room === room ? grant.token : null;
  if (!room || !token) {
    // Over the video: nothing at all. In a dock: say why it's empty.
    return (
      <div className={cls} style={style}>
        {opts.dock && <p className="obs-chat__status">{t("live.obs.chatOverlay.offline")}</p>}
      </div>
    );
  }

  return (
    <div className={cls} style={style}>
      <LiveKitRoom key={room} serverUrl={livekitUrl()} token={token} connect audio={false} video={false}>
        <ChatFeed fade={opts.fade} max={opts.max} dock={opts.dock} />
      </LiveKitRoom>
    </div>
  );
}
