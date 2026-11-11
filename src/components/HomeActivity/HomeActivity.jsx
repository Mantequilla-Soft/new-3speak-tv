import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import { useTranslation } from "react-i18next";
import { Icon } from "../v2/Icon";
import { cx } from "../v2/helpers";
import { useAppStore } from "../../lib/store";
import { fetchCommunityFeed } from "../../lib/snaps";
import { fetchPlaylistsFeed } from "../../lib/playlistsFeed";
import { useLiveStreams } from "../../hooks/useLiveStreams";
import { CHECKER_URL, FEED_URL, appendNsfw } from "../../utils/config";
import { withViewer } from "../../utils/userFilters";
import { getSubscriptions, bodyToPlaintext } from "../../hive-api/hiveApi";
import { getCommunity } from "../../hive-api/api";
import { formatTimeAgoCompact } from "../../i18n";
import { audioItemPath } from "../AudioItem/AudioItemView";
import "./HomeActivity.scss";

// Service accounts whose audio and playlists never show in the feed (the same
// list as HomeGrouped / Audio.jsx).
const HIDDEN_OWNERS = new Set(["badadib"]);
const ROWS = 12;

const hiveDate = (d) => (d && !/Z$|[+-]\d{2}:\d{2}$/.test(String(d)) ? `${d}Z` : d);
const ageOf = (d) => (d ? formatTimeAgoCompact(hiveDate(d)) : "");
const timeOf = (d) => new Date(hiveDate(d) || 0).getTime() || 0;
const clock = (sec) => {
  const n = Math.floor(Number(sec) || 0);
  if (!n) return null;
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const s = String(n % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
};

// The community stream: written snaps, new audio and changed playlists, newest
// first (the same three sources the feed interleaves on narrower screens).
function useCommunityActivity(user) {
  const showNsfw = useAppStore((s) => s.showNsfw);
  const snapsQ = useQuery({
    queryKey: ["home-activity-snaps", user || null],
    queryFn: () => fetchCommunityFeed({ scope: "all", currentuser: user, page: 1, limit: ROWS, maxAgeHours: 72 }).then((d) => d?.snaps || []),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
  const audioQ = useQuery({
    queryKey: ["home-activity-audio", user || null, showNsfw],
    queryFn: () => axios.get(appendNsfw(withViewer(`${CHECKER_URL}/audio?from=3&page=1&limit=${ROWS}`, user), showNsfw))
      .then((r) => r.data?.audio || []),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
  const playlistsQ = useQuery({
    queryKey: ["home-activity-playlists", user || null],
    queryFn: () => fetchPlaylistsFeed({ scope: "all", currentuser: user, page: 1, limit: ROWS, maxAgeHours: 24 }).then((d) => d?.playlists || []),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
  const audio = useMemo(() => (audioQ.data || []).filter((a) => a.owner !== user && !HIDDEN_OWNERS.has(a.owner)), [audioQ.data, user]);
  const rows = useMemo(() => {
    const out = [
      ...(snapsQ.data || []).filter((s) => s.owner !== user).map((s) => ({ kind: "snap", key: `s-${s.owner}/${s.permlink}`, who: s.owner, at: s.created, data: s })),
      ...audio.map((a) => ({ kind: "audio", key: `a-${a._id}`, who: a.owner, at: a.created || a.createdAt || a.created_at, data: a })),
      ...(playlistsQ.data || []).filter((p) => p.owner !== user && !HIDDEN_OWNERS.has(p.owner)).map((p) => ({ kind: "playlist", key: `p-${p.id}`, who: p.owner, at: p.updated_at, data: p })),
    ];
    return out.sort((a, b) => timeOf(b.at) - timeOf(a.at)).slice(0, ROWS);
  }, [snapsQ.data, audio, playlistsQ.data, user]);
  return { rows, audio, loading: snapsQ.isLoading && audioQ.isLoading && playlistsQ.isLoading };
}

// Groups: the ones you joined first, then the busiest this week, from the
// checker's community activity (counts and latest videos) with Hive's titles.
function useGroupActivity(user, enabled) {
  return useQuery({
    queryKey: ["home-activity-groups", user || null],
    enabled,
    staleTime: 10 * 60 * 1000,
    retry: 1,
    queryFn: async () => {
      const { data } = await axios.get(`${FEED_URL}/feeds/communities/activity`);
      const activity = data?.communities || {};
      const titles = new Map();
      if (user) {
        const subs = await getSubscriptions(user).catch(() => []);
        (subs || []).forEach((r) => titles.set(r[0], r[1]));
      }
      const names = Object.keys(activity)
        .sort((a, b) => (titles.has(b) - titles.has(a)) || ((activity[b]?.week || 0) - (activity[a]?.week || 0)))
        .slice(0, 8);
      const missing = names.filter((n) => !titles.has(n));
      const found = await Promise.all(missing.map((n) => getCommunity(n).catch(() => null)));
      found.forEach((c, i) => { if (c?.title) titles.set(missing[i], c.title); });
      return names.map((name) => ({
        name,
        title: titles.get(name) || name,
        week: activity[name]?.week || 0,
        latest: activity[name]?.latest?.[0] || null,
      }));
    },
  });
}

function Row({ to, avatar, icon, tone = "cyan", who, verb, age, body, children }) {
  return (
    <div className="home-activity__row">
      <Link to={to} className="home-activity__avatar" tabIndex={-1} aria-hidden="true">
        <img src={avatar} alt="" loading="lazy" />
        <span className={cx("home-activity__kind", `is-${tone}`)}><Icon name={icon} size={13} /></span>
      </Link>
      <div className="home-activity__text">
        <div className="home-activity__line">
          <b>{who}</b> {verb}{age ? ` · ${age}` : ""}
        </div>
        <Link to={to} className="home-activity__body">{body}</Link>
        {children}
      </div>
    </div>
  );
}

// An audio row's inline player (20a): play, the waveform, the length.
function InlineAudio({ item, queue }) {
  const { t } = useTranslation();
  const audioCurrent = useAppStore((s) => s.audioCurrent);
  const audioIsPlaying = useAppStore((s) => s.audioIsPlaying);
  const audioPlay = useAppStore((s) => s.audioPlay);
  const audioToggle = useAppStore((s) => s.audioRequestPlayPauseToggle);
  const playing = audioCurrent?._id === item._id && audioIsPlaying;
  const onPlay = () => {
    if (audioCurrent?._id === item._id && audioToggle) { audioToggle(); return; }
    audioPlay(item, queue);
  };
  const peaks = useMemo(() => {
    const w = Array.isArray(item.waveform?.[0]) ? item.waveform[0] : item.waveform;
    if (!Array.isArray(w) || !w.length) return null;
    const n = 48;
    const step = w.length / n;
    const out = [];
    for (let i = 0; i < n; i++) {
      let max = 0;
      for (let j = Math.floor(i * step); j < Math.floor((i + 1) * step); j++) max = Math.max(max, Math.abs(Number(w[j]) || 0));
      out.push(max);
    }
    const top = Math.max(...out) || 1;
    return out.map((v) => Math.max(.15, v / top));
  }, [item.waveform]);
  return (
    <div className="home-activity__audio">
      <button type="button" className="home-activity__play" onClick={onPlay} aria-label={playing ? t("common.actions.pause") : t("common.actions.play")}>
        <Icon name={playing ? "pause" : "play_arrow"} size={18} fill />
      </button>
      <span className={cx("home-activity__wave", !peaks && "is-flat")} aria-hidden="true">
        {peaks && peaks.map((p, i) => <i key={i} style={{ height: `${Math.round(p * 100)}%` }} />)}
      </span>
      {clock(item.duration) && <span className="home-activity__len num">{clock(item.duration)}</span>}
    </div>
  );
}

/**
 * The activity panel beside the Home feed (20a): Community | Live | Groups in
 * a segmented track over a fixed-height list that scrolls inside, so switching
 * tabs never changes the panel's size. Shown from 1280px up (HomeGrouped).
 */
export default function HomeActivity() {
  const { t } = useTranslation();
  const user = useAppStore((s) => s.user);
  const [tab, setTab] = useState("community");
  const community = useCommunityActivity(user);
  const live = useLiveStreams();
  // Only asked once the Groups tab is opened: a handful of Hive reads.
  const groups = useGroupActivity(user, tab === "groups");

  const tabs = [
    { key: "community", label: t("feeds.activity.community") },
    { key: "live", label: live.length ? `${t("nav.tabs.live")} ${live.length}` : t("nav.tabs.live") },
    { key: "groups", label: t("nav.bottom.groups") },
  ];
  const seeAll = tab === "live" ? "/live" : tab === "groups" ? "/groups" : null;

  let list = null;
  if (tab === "community") {
    list = community.rows.length ? community.rows.map((r) => {
      if (r.kind === "audio") {
        return (
          <Row key={r.key} to={audioItemPath(r.data)} avatar={`/img/u/${r.who}/avatar/small`} icon="graphic_eq"
            who={r.who} verb={t("feeds.activity.verbs.audio")} age={ageOf(r.at)} body={r.data.title || r.data.originalFilename}>
            <InlineAudio item={r.data} queue={community.audio} />
          </Row>
        );
      }
      if (r.kind === "playlist") {
        return (
          <Row key={r.key} to={`/playlist/${r.data.id}`} avatar={`/img/u/${r.who}/avatar/small`} icon="playlist_add"
            who={r.who} verb={t("feeds.activity.verbs.playlist")} age={ageOf(r.at)} body={r.data.name} />
        );
      }
      return (
        <Row key={r.key} to={`/@${r.who}?tab=community`} avatar={`/img/u/${r.who}/avatar/small`} icon="bolt"
          who={r.who} verb={t("feeds.activity.verbs.snap")} age={ageOf(r.at)} body={bodyToPlaintext(r.data.body || "")} />
      );
    }) : !community.loading && <p className="home-activity__empty">{t("feeds.activity.emptyCommunity")}</p>;
  } else if (tab === "live") {
    list = live.length ? live.map((s) => (
      <Row key={s.roomName} to={s._openpodRoom ? `/openpods/${s.roomName}` : `/watch/${s.roomName}`}
        avatar={`/img/u/${s.author}/avatar/small`} icon="sensors" tone="accent"
        who={s.author} verb={t("feeds.activity.verbs.live")} age={ageOf(s.created_at)} body={s.title}>
        <span className="home-activity__watching">{t("cards.watchingNow", { count: s.views || 0 })}</span>
      </Row>
    )) : <p className="home-activity__empty">{t("feeds.activity.emptyLive")}</p>;
  } else {
    list = groups.data?.length ? groups.data.map((g) => (
      <Row key={g.name} to={`/community/${g.name}`} avatar={`/img/u/${g.name}/avatar/small`} icon="groups"
        who={g.title} verb={t("feeds.activity.verbs.group", { count: g.week })} body={g.latest?.title || ""} />
    )) : !groups.isLoading && <p className="home-activity__empty">{t("feeds.activity.emptyGroups")}</p>;
  }

  return (
    <section className="home-activity" aria-label={t("feeds.activity.aria")}>
      <div className="home-activity__tabs" role="tablist" aria-label={t("feeds.activity.aria")}>
        {tabs.map((x) => (
          <button key={x.key} type="button" role="tab" aria-selected={tab === x.key}
            className={cx("home-activity__tab", tab === x.key && "is-on")} onClick={() => setTab(x.key)}>
            {x.label}
          </button>
        ))}
      </div>
      <div className="home-activity__list" role="tabpanel">{list}</div>
      {seeAll ? (
        <Link to={seeAll} className="home-activity__all">
          <span>{t("common.actions.seeAll")}</span>
          <Icon name="arrow_forward" size={18} />
        </Link>
      ) : <div className="home-activity__all is-blank" aria-hidden="true" />}
    </section>
  );
}
