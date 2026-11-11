// The parts of a community page that are about its PEOPLE and its front door,
// rather than the video grid: the pinned row, the top-creators strip, and the
// team + rules cards. All read data Hive or the checker already has.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { getHiveClient } from '../../utils/hiveNode';
import { FEED_URL } from '../../utils/config';
import { useAvatarUrl } from '../../utils/avatarCache';
import { useTranslation } from 'react-i18next';
import { formatNumber } from '../../i18n';
import { Icon } from '../v2/Icon';
import { StatusPill } from '../v2/ui';

const fmtNum = (n) => (typeof n === 'number' ? formatNumber(n) : '—');

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
  const { t } = useTranslation();
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

  // Design 40b: one cyan-washed row per pinned post, "Start here" first.
  return (
    <section className="community-pinned" aria-label={t('communities.page.pinnedAria')}>
      {pinned.map((p, i) => {
        const meta = metaOf(p);
        const video = isVideoPost(meta);
        const thumb = pinnedThumb(meta);
        return (
          <Link
            key={`${p.author}/${p.permlink}`}
            className="community-pinned-row"
            to={video ? `/@${p.author}/${p.permlink}` : `/post/${p.author}/${p.permlink}`}
          >
            <Icon name="push_pin" size={20} fill className="community-pinned-icon" />
            {thumb && (
              <span className="community-pinned-thumb">
                <img src={thumb} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
              </span>
            )}
            <span className="community-pinned-text">
              <b className="community-pinned-title">
                {i === 0 ? `${t('communities.page.startHere')}: ` : ''}{p.title || t('communities.page.untitled')}
              </b>
              <span className="community-pinned-author">@{p.author}</span>
            </span>
            <span className="community-pinned-badge">{t('communities.page.pinned')}</span>
          </Link>
        );
      })}
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
  const { t } = useTranslation();
  const avatar = useAvatarUrl(c.name);
  return (
    <Link className="community-creator" to={`/@${c.name}`} title={t('communities.page.creatorTitle', { name: c.name, views: fmtNum(c.views), count: c.videos })}>
      <span className="community-creator-rank num">{rank}</span>
      <span className="community-creator-avatar">
        <img src={avatar} alt="" loading="lazy" />
      </span>
      <b className="community-creator-name">{c.name}</b>
      <span className="community-creator-stat">{t('communities.page.creatorViews', { views: fmtNum(c.views) })}</span>
    </Link>
  );
}

// `side` renders it as a sidebar card (a ranked list, design 40b); the default
// is the horizontal strip phones get, where there is no sidebar.
export function CommunityTopCreators({ id, side = false }) {
  const { t } = useTranslation();
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
      className={`community-card community-top-creators${side ? ' community-top-creators--side' : ''}`}
      aria-label={t('communities.page.topCreators')}
    >
      <h3 className="community-card-title"><Icon name="trophy" size={18} /> {t('communities.page.topCreators')}</h3>
      <div className="community-creators-row">
        {creators.map((c, i) => <CreatorChip key={c.name} c={c} rank={i + 1} />)}
      </div>
    </section>
  );
}

// ── Team + rules ───────────────────────────────────────────────────────────────
const ROLE_ORDER = { owner: 0, admin: 1, mod: 2 };
const ROLE_LABEL_KEY = { owner: 'communities.page.roles.owner', admin: 'communities.page.roles.admin', mod: 'communities.page.roles.mod' };
const TEAM_PREVIEW = 6;

// Role pills (design 40b): owner in accent, admin in cyan, moderator muted.
const ROLE_TONE = { owner: 'accent', admin: 'cyan', mod: 'muted' };

function TeamMember({ name, role, title }) {
  const { t } = useTranslation();
  const avatar = useAvatarUrl(name);
  const roleLabel = ROLE_LABEL_KEY[role] ? t(ROLE_LABEL_KEY[role]) : role;
  return (
    <Link className="community-team-member" to={`/@${name}`}>
      <img src={avatar} alt="" loading="lazy" />
      <span className="community-team-text">
        <b className="community-team-name">{name}</b>
        {/* A custom title the mods gave this person ("Founder"), when there is one. */}
        {title && title !== roleLabel ? <span className="community-team-title">{title}</span> : null}
      </span>
      <StatusPill tone={ROLE_TONE[role] || 'muted'} className="community-team-role">{roleLabel}</StatusPill>
    </Link>
  );
}

// `team` is bridge.get_community's [[account, role, title], ...]. The community's
// own hive-<digits> account is listed as its owner; that is not a person, so it
// is left out.
export function CommunityTeam({ id, team }) {
  const { t } = useTranslation();
  const [all, setAll] = useState(false);
  const members = (team || [])
    .filter(([name, role]) => name && name !== id && role in ROLE_ORDER)
    .sort((a, b) => ROLE_ORDER[a[1]] - ROLE_ORDER[b[1]]);
  if (!members.length) return null;
  const shown = all ? members : members.slice(0, TEAM_PREVIEW);

  return (
    <div className="community-card community-team">
      <h3 className="community-card-title"><Icon name="shield_person" size={18} /> {t('communities.page.team')}</h3>
      <div className="community-team-list">
        {shown.map(([name, role, title]) => (
          <TeamMember key={name} name={name} role={role} title={title} />
        ))}
      </div>
      {members.length > TEAM_PREVIEW && (
        <button type="button" className="community-card-more" onClick={() => setAll((v) => !v)}>
          {all ? t('common.actions.showLess') : t('communities.page.showAll', { count: members.length })}
          <Icon name={all ? 'expand_less' : 'expand_more'} size={18} />
        </button>
      )}
    </div>
  );
}

// `flag_text` is free text the mods write, usually one rule per line. Each rule
// gets a numbered cyan square (design 20c).
export function CommunityRules({ text, collapsible = false }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(!collapsible);
  const rules = String(text || '').split(/\r?\n/).map((r) => r.replace(/^\s*(?:\d+[.)]|[-*•])\s*/, '').trim()).filter(Boolean);
  if (!rules.length) return null;

  return (
    <div className="community-card community-rules">
      {collapsible ? (
        <button type="button" className="community-card-title community-card-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          <Icon name="gavel" size={18} /> <span>{t('communities.page.rulesCount', { count: rules.length })}</span>
          <Icon name={open ? 'expand_less' : 'expand_more'} size={20} className="community-card-chevron" />
        </button>
      ) : (
        <h3 className="community-card-title"><Icon name="gavel" size={18} /> {t('communities.page.rules')}</h3>
      )}
      {open && (
        <ol className="community-rules-list">
          {rules.map((r, i) => (
            <li key={i}><span className="community-rule-n num">{i + 1}</span><span>{r}</span></li>
          ))}
        </ol>
      )}
    </div>
  );
}
