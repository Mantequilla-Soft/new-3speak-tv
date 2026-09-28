// The parts of a community page that are about its PEOPLE and its front door,
// rather than the video grid: the pinned row, the top-creators strip, and the
// team + rules cards. All read data Hive or the checker already has.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { Pin, Crown, ShieldCheck, ScrollText, ChevronDown, ChevronUp } from 'lucide-react';
import { getHiveClient } from '../../utils/hiveNode';
import { FEED_URL } from '../../utils/config';
import { useAvatarUrl } from '../../utils/avatarCache';
import { fallbackImg } from '../../utils/fixThumbnails';

const fmtNum = (n) => (typeof n === 'number' ? n.toLocaleString('en-US') : '—');

// ── Pinned ─────────────────────────────────────────────────────────────────────
// Hive lets a community's mods pin posts; bridge.get_ranked_posts sort=created
// returns them FIRST, flagged stats.is_pinned. The checker's community feed does
// not carry that flag, so they are read from Hive directly.
const PINNED_SCAN = 10;

const metaOf = (p) => {
  const m = p?.json_metadata;
  if (m && typeof m === 'object') return m;
  try { return JSON.parse(m || '{}'); } catch { return {}; }
};

// A 3Speak video opens on the watch page; anything else a mod pinned (rules,
// announcements, often written on PeakD/Ecency) opens as a post.
const isVideoPost = (meta) => /^3speak/i.test(String(meta.app || '')) || !!meta.video;

function pinnedThumb(meta) {
  const v = meta.video && typeof meta.video === 'object' ? meta.video : null;
  return (typeof v?.thumbnail === 'string' && v.thumbnail) || (Array.isArray(meta.image) && meta.image[0]) || null;
}

export function CommunityPinned({ id }) {
  const { data: pinned = [] } = useQuery({
    queryKey: ['community-pinned', id],
    queryFn: async () => {
      const posts = await getHiveClient().call('bridge', 'get_ranked_posts', {
        sort: 'created', tag: id, limit: PINNED_SCAN, observer: '',
      });
      const pinned = (posts || []).filter((p) => p?.stats?.is_pinned);
      // A cross-post (PeakD's "cross post of @a/p" stub) has no image and a body
      // that only links elsewhere, so the card shows the ORIGINAL post: its
      // title, thumbnail, author and address. The stub stays if the original
      // cannot be read.
      return Promise.all(pinned.map(async (p) => {
        const meta = metaOf(p);
        if (!meta.original_author || !meta.original_permlink) return p;
        try {
          const orig = await getHiveClient().call('bridge', 'get_post', {
            author: meta.original_author, permlink: meta.original_permlink, observer: '',
          });
          return orig?.author ? orig : p;
        } catch {
          return p;
        }
      }));
    },
    enabled: !!id,
    staleTime: 5 * 60_000,
  });

  if (!pinned.length) return null;

  return (
    <section className="community-pinned" aria-label="Pinned by the moderators">
      <h3 className="community-section-title"><Pin size={15} /> Start here</h3>
      <div className="community-pinned-row">
        {pinned.map((p) => {
          const meta = metaOf(p);
          const video = isVideoPost(meta);
          const thumb = pinnedThumb(meta);
          return (
            <Link
              key={`${p.author}/${p.permlink}`}
              className="community-pinned-card"
              to={video ? `/watch?v=${p.author}/${p.permlink}` : `/post/${p.author}/${p.permlink}`}
            >
              <div className="community-pinned-thumb">
                {thumb
                  ? <img src={thumb} alt="" loading="lazy" onError={(e) => { e.currentTarget.src = fallbackImg; }} />
                  : <span className="community-pinned-thumb-text">{video ? '▶' : 'Aa'}</span>}
                <span className="community-pinned-badge"><Pin size={11} /> Pinned</span>
              </div>
              <div className="community-pinned-title">{p.title || 'Untitled'}</div>
              <div className="community-pinned-author">@{p.author}</div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

// ── Top creators ───────────────────────────────────────────────────────────────
// Built from the community's most-viewed videos of the last 30 days (the checker's
// Top feed): views and videos summed per author. It is "who made what people
// watched here this month", not a full census, which is what a visitor wants.
async function fetchMonthTop(id) {
  try {
    const { data } = await axios.get(`${FEED_URL}/feeds/community/${id}/top?window=30d&limit=100`);
    return data?.videos || [];
  } catch (err) {
    // A checker that predates the Top route (it answers 404, or 401 from the
    // stream-stats auth gate that catches unknown paths): Trending is the same 30-day window
    // ranked by views, so it gives the same creators.
    const status = err?.response?.status || 0;
    if (status < 400 || status >= 500) throw err;
    const { data } = await axios.get(`${FEED_URL}/feeds/community/${id}/trending?page=1&limit=100`);
    return data?.videos || [];
  }
}

const TOP_CREATORS = 8;

function CreatorChip({ c, rank }) {
  const avatar = useAvatarUrl(c.name);
  return (
    <Link className="community-creator" to={`/p/${c.name}`} title={`@${c.name}: ${fmtNum(c.views)} views from ${c.videos} video${c.videos === 1 ? '' : 's'}`}>
      <span className="community-creator-avatar">
        <img src={avatar} alt="" loading="lazy" />
        {rank <= 3 && <span className={`community-creator-rank rank-${rank}`}>{rank}</span>}
      </span>
      <span className="community-creator-name">{c.name}</span>
      <span className="community-creator-stat">{fmtNum(c.views)} views</span>
    </Link>
  );
}

// `side` renders it as a sidebar card (a ranked list); the default is the
// horizontal strip phones get, where there is no sidebar.
export function CommunityTopCreators({ id, side = false }) {
  const { data: creators = [] } = useQuery({
    queryKey: ['community-top-creators', id],
    queryFn: async () => {
      const videos = await fetchMonthTop(id);
      const by = new Map();
      for (const v of videos) {
        const name = v.author?.username || v.author || v.owner;
        if (!name) continue;
        const row = by.get(name) || { name, views: 0, videos: 0 };
        row.views += Number(v.views) || 0;
        row.videos += 1;
        by.set(name, row);
      }
      return [...by.values()]
        .filter((c) => c.views > 0)
        .sort((a, b) => b.views - a.views || b.videos - a.videos)
        .slice(0, TOP_CREATORS);
    },
    enabled: !!id,
    staleTime: 10 * 60_000,
  });

  // One name is not a leaderboard; it just repeats the grid.
  if (creators.length < 2) return null;

  return (
    <section
      className={`community-top-creators${side ? ' community-card community-top-creators--side' : ''}`}
      aria-label="Top creators this month"
    >
      {side
        ? <h4 className="community-card-title"><Crown size={15} /> Top creators this month</h4>
        : <h3 className="community-section-title"><Crown size={15} /> Top creators this month</h3>}
      <div className="community-creators-row">
        {creators.map((c, i) => <CreatorChip key={c.name} c={c} rank={i + 1} />)}
      </div>
    </section>
  );
}

// ── Team + rules ───────────────────────────────────────────────────────────────
const ROLE_ORDER = { owner: 0, admin: 1, mod: 2 };
const ROLE_LABEL = { owner: 'Owner', admin: 'Admin', mod: 'Moderator' };
const TEAM_PREVIEW = 6;

function TeamMember({ name, role, title }) {
  const avatar = useAvatarUrl(name);
  return (
    <Link className="community-team-member" to={`/p/${name}`}>
      <img src={avatar} alt="" loading="lazy" />
      <span className="community-team-text">
        <span className="community-team-name">{name}</span>
        <span className="community-team-role">{title || ROLE_LABEL[role] || role}</span>
      </span>
    </Link>
  );
}

// `team` is bridge.get_community's [[account, role, title], ...]. The community's
// own hive-<digits> account is listed as its owner; that is not a person, so it
// is left out.
export function CommunityTeam({ id, team }) {
  const [all, setAll] = useState(false);
  const members = (team || [])
    .filter(([name, role]) => name && name !== id && role in ROLE_ORDER)
    .sort((a, b) => ROLE_ORDER[a[1]] - ROLE_ORDER[b[1]]);
  if (!members.length) return null;
  const shown = all ? members : members.slice(0, TEAM_PREVIEW);

  return (
    <div className="community-card community-team">
      <h4 className="community-card-title"><ShieldCheck size={15} /> Team</h4>
      <div className="community-team-list">
        {shown.map(([name, role, title]) => (
          <TeamMember key={name} name={name} role={role} title={title} />
        ))}
      </div>
      {members.length > TEAM_PREVIEW && (
        <button type="button" className="community-card-more" onClick={() => setAll((v) => !v)}>
          {all ? 'Show less' : `Show all ${members.length}`}
        </button>
      )}
    </div>
  );
}

// `flag_text` is free text the mods write, usually one rule per line.
export function CommunityRules({ text, collapsible = false }) {
  const [open, setOpen] = useState(!collapsible);
  const rules = String(text || '').split(/\r?\n/).map((r) => r.replace(/^\s*(?:\d+[.)]|[-*•])\s*/, '').trim()).filter(Boolean);
  if (!rules.length) return null;

  return (
    <div className="community-card community-rules">
      {collapsible ? (
        <button type="button" className="community-card-title community-card-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          <ScrollText size={15} /> Rules ({rules.length})
          {open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </button>
      ) : (
        <h4 className="community-card-title"><ScrollText size={15} /> Rules</h4>
      )}
      {open && (
        <ol className="community-rules-list">
          {rules.map((r, i) => <li key={i}>{r}</li>)}
        </ol>
      )}
    </div>
  );
}
