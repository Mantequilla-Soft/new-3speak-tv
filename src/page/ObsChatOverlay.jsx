import { useEffect, useMemo, useRef, useState } from "react";
import { LiveKitRoom, useParticipants, useRoomInfo } from "@livekit/components-react";
import { useChat, resolveStreamCap, BoostAlerts, HangoutsProvider, StudioLivePanel, BoostSettingsPanel } from "@snapie/hangouts-react";
import "@snapie/hangouts-react/src/styles/hangouts.css";
import { useTranslation } from "react-i18next";
import { getHangoutsEndpoints, defaultEndpoint } from "../utils/hangoutsEndpoints";
import { CHECKER_URL } from "../utils/config";
import { fetchBoostTotals } from "../utils/boostSummary";
import { getPlayerUrl } from "../utils/playerUrl";
import { Icon } from "../components/v2/Icon";
import "./ObsChatOverlay.scss";
import mark from "../assets/image/3S_mark.svg";

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
// (lines), size (text px). Defaults: dock 0 / 50 / 14, overlay 30 / 10 / 16.
// control: the dock key (Templates tab), traded for a dock session that runs
// the host's live controls here: polls and predictions, raids, boost settings
// (not the payout account). Without it the dock is the chat only.
// alerts (1/0): play the host's boost alerts (chime, read aloud, goal reached,
// as set in the studio's Boost settings). On by default in the dock, the OBS
// stand-in for the studio; off over the video, so a streamer running both does
// not hear every boost twice.

const API = (import.meta.env.VITE_HANGOUTS_TEMPLATES_API_URL || import.meta.env.VITE_HANGOUTS_API_URL || "")
  .replace(/\/$/, "");
const POLL_MS = 5000;
// The dock's counters re-read the room (go-live time, host) and the boost ledger this often.
const INFO_POLL_MS = 15000;
// A Pro host's time-left counter appears only in the last stretch: 4 hours is not news.
const PRO_LEFT_SHOWN_MS = 15 * 60 * 1000;
const LOW_LEFT_MS = 5 * 60 * 1000;

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
    size: clampInt(p.get("size"), 10, 64, dock ? 14 : 16),
    alerts: p.has("alerts") ? p.get("alerts") === "1" : dock,
    control: dock ? p.get("control") || "" : "",
  };
}

// A dock session lasts 12 hours on the server; renew well before.
const DOCK_SESSION_RENEW_MS = 6 * 60 * 60 * 1000;

/**
 * The dock's session for the live controls: null (none, or an older server),
 * "invalid" (the key was reset), or { token, username }.
 */
function useDockSession(controlKey) {
  const [session, setSession] = useState(null);
  useEffect(() => {
    if (!controlKey || !API) return undefined;
    let alive = true;
    const renew = async () => {
      try {
        const r = await fetch(`${API}/dock/session`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: controlKey }),
        });
        if (!alive) return;
        if (r.status === 401) { setSession("invalid"); return; }
        if (!r.ok) return;
        const d = await r.json();
        if (alive && d?.token) setSession({ token: d.token, username: d.username });
      } catch { /* network blip: the next renewal tries again */ }
    };
    renew();
    const id = setInterval(renew, DOCK_SESSION_RENEW_MS);
    return () => { alive = false; clearInterval(id); };
  }, [controlKey]);
  return session;
}

const DOCK_TABS = ["chat", "live", "boosts"];

// After the stream: how often the dock looks for viewers' clips and the VOD.
const CLIPS_POLL_MS = 60 * 1000;
const CLIPS_SEEN_KEY = "3speak-dock-clips-hidden";

/** Is the stream's recording up as its video? (the player's own answer) */
async function vodPublished(host, room) {
  try {
    const r = await fetch(`${getPlayerUrl()}/api/embed?v=${encodeURIComponent(host)}/${encodeURIComponent(room)}`, { cache: "no-store" });
    if (!r.ok) return false;
    const d = await r.json();
    return !!d?.videoUrl && d.success !== false && d.status === "published" && d.isPlaceholder !== true;
  } catch {
    return false;
  }
}

/**
 * After a stream (dock link with the control key): once the VOD is up and
 * viewers clipped moments of it, a card that leads to the stream's clips page,
 * where the host picks them and posts them as Shorts. Hidden per stream.
 */
function DockClipSuggestions({ session }) {
  const { t } = useTranslation();
  const [found, setFound] = useState(null);
  const [hidden, setHidden] = useState(() => {
    try { return localStorage.getItem(CLIPS_SEEN_KEY) || ""; } catch { return ""; }
  });
  useEffect(() => {
    let alive = true;
    const look = async () => {
      try {
        const r = await fetch(`${API}/dock/clips`, { headers: { Authorization: `Bearer ${session.token}` }, cache: "no-store" });
        if (!alive || !r.ok) return;
        const d = await r.json();
        if (!d?.room || !(d.count > 0)) { if (alive) setFound(null); return; }
        const vod = await vodPublished(session.username, d.room);
        if (alive) setFound(vod ? d : null);
      } catch { /* the next look tries again */ }
    };
    look();
    const id = setInterval(look, CLIPS_POLL_MS);
    return () => { alive = false; clearInterval(id); };
  }, [session.token, session.username]);

  if (!found || hidden === found.room) return null;
  const hide = () => {
    setHidden(found.room);
    try { localStorage.setItem(CLIPS_SEEN_KEY, found.room); } catch { /* this dock visit only */ }
  };
  return (
    <section className="obs-chat__clips" aria-label={t("live.obs.chatOverlay.clips.title")}>
      <div className="obs-chat__clips-head">
        <Icon name="movie" size={18} />
        <strong>{t("live.obs.chatOverlay.clips.title")}</strong>
        <button type="button" className="obs-chat__clips-hide" onClick={hide} aria-label={t("live.obs.chatOverlay.clips.hide")} title={t("live.obs.chatOverlay.clips.hide")}>
          <Icon name="close" size={16} />
        </button>
      </div>
      <p>{t("live.obs.chatOverlay.clips.body", { count: found.count, viewers: found.clippers })}</p>
      <a className="obs-chat__clips-open" href={`${window.location.origin}/live/clips/${encodeURIComponent(found.room)}`} target="_blank" rel="noopener noreferrer">
        {t("live.obs.chatOverlay.clips.open")}
        <Icon name="open_in_new" size={16} />
      </a>
    </section>
  );
}

/** The live controls as the studio has them: Polls (and predictions) and Raid, then Boosts. */
function DockPanel({ room, session, tab }) {
  const { t } = useTranslation();
  const info = useRoomInfo();
  const fromRoom = useMemo(() => {
    if (!info.metadata) return undefined;
    try { return JSON.parse(info.metadata).boost ?? null; } catch { return undefined; }
  }, [info.metadata]);
  // The boost form takes its values once, when it opens: it must not open on
  // defaults (saving them would wipe the goal). Until the room's metadata
  // arrives, the server's copy of the room.
  const [fetched, setFetched] = useState(undefined);
  useEffect(() => {
    if (fromRoom !== undefined) return undefined;
    let alive = true;
    fetch(`${API}/rooms/${encodeURIComponent(room)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d) setFetched(d.boost ?? null); })
      .catch(() => { /* the room's metadata may still arrive */ });
    return () => { alive = false; };
  }, [room, fromRoom]);
  const boost = fromRoom !== undefined ? fromRoom : fetched;
  return (
    <div className="obs-chat__panel" data-hh-theme="dark">
      <HangoutsProvider apiBaseUrl={API} sessionToken={session.token} username={session.username} theme="dark">
        {tab === "live" && <StudioLivePanel roomName={room} />}
        {tab === "boosts" && boost === undefined && <p className="obs-chat__status">{t("common.status.loading")}</p>}
        {tab === "boosts" && boost !== undefined && (
          <BoostSettingsPanel
            key={room}
            roomName={room}
            currentConfig={boost ?? undefined}
            embedded
            payoutLocked
            onClose={() => {}}
            onSaved={() => {}}
          />
        )}
      </HangoutsProvider>
    </div>
  );
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

/** 75 s -> "1:15", 3725 s -> "1:02:05". */
function clock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** 12.5 -> "12.5", 50 -> "50", 100 -> "100": an HBD amount without trailing zeros. */
function hbd(n) {
  const v = Number(n) || 0;
  return v >= 100 ? String(Math.round(v)) : String(Number(v.toFixed(2)));
}

/**
 * The dock's header: viewers, time live, time left before the stream's cap ends
 * it, boosts received and, when the host set one, the boost goal. An OBS
 * streamer has no studio, so this is the only place they see these numbers
 * while live.
 *
 * Viewers are counted like the studio counts them: everyone in the room but the
 * host and the silent `obs-` observers (this dock among them). The cap is the
 * same one the studio and server enforce (resolveStreamCap): 30 minutes free.
 */
function DockCounters({ room }) {
  const { t } = useTranslation();
  const participants = useParticipants();
  const [info, setInfo] = useState(null);       // { host, liveAt }
  const [premium, setPremium] = useState(null); // unknown until the checker answers
  // `source`: 'summary' (total in HBD) or 'ledger' (an older server: USD).
  const [boosts, setBoosts] = useState({ total: 0, count: 0, goal: null, source: null });
  // The server answered 404 for the summary (older than 0.26.23): read the
  // ledger from then on instead of asking again every poll.
  const legacyRef = useRef(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let alive = true;
    // A new room may be on a newer server: ask for the summary again.
    legacyRef.current = false;
    const poll = async () => {
      try {
        const [r, b] = await Promise.all([
          fetch(`${API}/rooms/${encodeURIComponent(room)}`, { cache: "no-store" }),
          // The stream's tally (goal, total, top supporters); the ledger on an old server.
          fetchBoostTotals(API, room, { legacy: legacyRef.current }).catch(() => null),
        ]);
        if (!alive) return;
        if (r.ok) {
          const d = await r.json();
          const at = d?.liveAt ? Date.parse(d.liveAt) : NaN;
          setInfo({ host: d?.host || null, liveAt: Number.isFinite(at) ? at : null });
        }
        if (b) {
          if (b.source === "ledger") legacyRef.current = true;
          setBoosts({ total: b.total, count: b.count, goal: b.goal, source: b.source });
        }
      } catch { /* keep the last numbers through a blip */ }
    };
    poll();
    const id = setInterval(poll, INFO_POLL_MS);
    return () => { alive = false; clearInterval(id); };
  }, [room]);

  const host = info?.host;
  useEffect(() => {
    if (!host) return undefined;
    let alive = true;
    fetch(`${CHECKER_URL}/premium/${encodeURIComponent(host)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d) setPremium(!!d.premium); })
      .catch(() => { /* no time-left counter rather than a wrong one */ });
    return () => { alive = false; };
  }, [host]);

  const viewers = participants.filter(
    (p) => !p.isLocal && p.identity !== host && !p.identity.startsWith("obs-"),
  ).length;
  const elapsed = info?.liveAt ? now - info.liveAt : null;
  const capMs = premium == null ? null : resolveStreamCap(premium).capMs;
  const left = capMs != null && elapsed != null ? capMs - elapsed : null;
  const showLeft = left != null && (!premium || left < PRO_LEFT_SHOWN_MS);
  const { goal } = boosts;
  // The tally in what it was counted in: HBD from the summary, USD from the ledger.
  const totalText = boosts.source === "ledger" ? `$${boosts.total.toFixed(2)}` : `${hbd(boosts.total)} HBD`;
  const goalTitle = goal ? goal.title || t("live.boost.dialog.goalDefaultTitle") : "";
  const goalText = goal
    ? t("live.boost.dialog.goalProgress").replace("{progress}", hbd(goal.progress)).replace("{target}", hbd(goal.target))
    : "";

  return (
    <div className="obs-chat__counters" role="status">
      <span className="obs-chat__counter" title={t("live.obs.chatOverlay.viewers")} aria-label={`${t("live.obs.chatOverlay.viewers")}: ${viewers}`}>
        <Icon name="visibility" size={16} /><span className="num">{viewers}</span>
      </span>
      {elapsed != null && (
        <span className="obs-chat__counter" title={t("live.obs.chatOverlay.liveFor")} aria-label={`${t("live.obs.chatOverlay.liveFor")}: ${clock(elapsed)}`}>
          <Icon name="timer" size={16} /><span className="num">{clock(elapsed)}</span>
        </span>
      )}
      {showLeft && (
        <span className={`obs-chat__counter${left < LOW_LEFT_MS ? " is-low" : ""}`} title={t("live.obs.chatOverlay.timeLeft")} aria-label={`${t("live.obs.chatOverlay.timeLeft")}: ${clock(left)}`}>
          <Icon name="hourglass_bottom" size={16} /><span className="num">{clock(left)}</span>
        </span>
      )}
      <span className="obs-chat__counter" title={t("live.obs.chatOverlay.boosts")} aria-label={`${t("live.obs.chatOverlay.boosts")}: ${totalText}`}>
        <Icon name="rocket_launch" size={16} /><span className="num">{totalText}</span>
      </span>
      {goal && (
        <span className={`obs-chat__counter obs-chat__goal${goal.reached ? " is-reached" : ""}`} title={goalTitle} aria-label={`${goalTitle}: ${goalText}`}>
          <Icon name={goal.reached ? "check_circle" : "savings"} size={16} /><span className="num">{goalText}</span>
        </span>
      )}
    </div>
  );
}

/** The dock's top line: the 3Speak mark and what this panel is. */
function DockBrand() {
  const { t } = useTranslation();
  return (
    <div className="obs-chat__brand">
      <img src={mark} alt="3Speak" />
      <span>{t("live.obs.chatOverlay.title")}</span>
    </div>
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
  const { t, i18n } = useTranslation();
  const [opts] = useState(readOptions);
  const [room, setRoom] = useState(null);
  // The observer token together with the room it was minted for, so a room
  // change never pairs the new room with the old token for a render.
  const [grant, setGrant] = useState(null);
  const [invalid, setInvalid] = useState(false);
  const dockSession = useDockSession(opts.control);
  const controls = dockSession && dockSession !== "invalid" ? dockSession : null;
  const [tab, setTab] = useState("chat");

  // OBS's Browser Source injects a transparent body, but the app's own CSS
  // paints one. Clear it; a dock gets its solid ground from .obs-chat--dock,
  // which covers the whole page.
  useEffect(() => {
    const els = [document.documentElement, document.body];
    const prev = els.map((el) => el.style.background);
    els.forEach((el) => { el.style.background = "transparent"; });
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
    return <div className={cls} style={style} data-theme="dark">{opts.dock && <DockBrand />}<p className="obs-chat__invalid">{t("live.obs.chatOverlay.invalid")}</p></div>;
  }
  const token = grant && grant.room === room ? grant.token : null;
  if (!room || !token) {
    // Over the video: nothing at all. In a dock: say why it's empty.
    return (
      <div className={cls} style={style} data-theme="dark">
        {opts.dock && <DockBrand />}
        {opts.dock && <p className="obs-chat__status">{t("live.obs.chatOverlay.offline")}</p>}
        {opts.dock && controls && <DockClipSuggestions session={controls} />}
      </div>
    );
  }

  return (
    <div className={cls} style={style} data-theme="dark">
      <LiveKitRoom key={room} serverUrl={livekitUrl()} token={token} connect audio={false} video={false}>
        {opts.dock ? (
          <>
            {/* Header and body: the chat stacks from the bottom and overflows
                at the top, under the header, which stays put. */}
            <div className="obs-chat__head">
              <DockBrand />
              <DockCounters room={room} />
              {dockSession === "invalid" && <p className="obs-chat__notice">{t("live.obs.chatOverlay.controlInvalid")}</p>}
              {controls && (
                <div className="obs-chat__tabs" role="tablist" aria-label={t("live.obs.chatOverlay.tabs.label")}>
                  {DOCK_TABS.map((k) => (
                    <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "is-on" : ""} onClick={() => setTab(k)}>
                      {t(`live.obs.chatOverlay.tabs.${k}`)}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className={`obs-chat__body${controls && tab !== "chat" ? " is-panel" : ""}`}>
              {controls && tab !== "chat"
                ? <DockPanel room={room} session={controls} tab={tab} />
                : <ChatFeed fade={opts.fade} max={opts.max} dock />}
            </div>
          </>
        ) : (
          <ChatFeed fade={opts.fade} max={opts.max} dock={false} />
        )}
        {/* The host's boost alerts, per their Boost settings: an OBS streamer
            has no studio to play them. */}
        {opts.alerts && (
          <BoostAlerts
            speechTemplate={t("live.boost.alertSpeech")}
            speechLang={i18n.resolvedLanguage || i18n.language}
          />
        )}
      </LiveKitRoom>
    </div>
  );
}
