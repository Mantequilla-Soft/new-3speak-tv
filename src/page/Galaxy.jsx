import {
  useEffect, useMemo, useRef, useState,
} from 'react';
import PropTypes from 'prop-types';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { useQuery } from '@tanstack/react-query';
import { Trans, useTranslation } from 'react-i18next';
import {
  MdClose, MdExpandLess, MdExpandMore, MdMusicNote, MdMusicOff, MdOndemandVideo, MdRedo, MdTune, MdUndo,
} from 'react-icons/md';
import HiveAvatar from '../components/HiveAvatar/HiveAvatar';
import GalaxyScene from '../components/Galaxy/GalaxyScene';
import { useAppStore } from '../lib/store';
import useGalaxyFits from '../hooks/useGalaxyFits';
import {
  buildGalaxy, fetchFollowing, fetchLinks, findCircles, ringOnMap, DEFAULT_DEPTH, MODES, SCAN_DEPTHS,
} from '../lib/hiveGalaxy';
import { createAmbient } from '../lib/galaxyAmbient';
import { formatNumber } from '../i18n';
import './Galaxy.scss';

const ACCOUNT_RE = /^[a-z][a-z0-9.-]{2,15}$/;
// Logged out with no account in the URL: start from 3Speak's own account.
const DEFAULT_CENTER = 'threespeak';
const MAX_SHOWN = 80; // suggestions on the map once filtered
const AVATARS = 10; // the strongest of those, drawn as avatars with a name
const LIST_SIZE = 20;
const CIRCLE_FACES = 24; // followed members shown as faces under a focused circle
const MAX_STEPS = 60; // undo/redo history per galaxy
// The follow data comes from HafSQL (via the checker); credit its maintainer.
const HAFSQL_MAINTAINER = 'mahdiyari';
const MASS_FOLLOWING = 2000; // the checker skips scanning accounts that follow more (routes/galaxy.js)
const ACTIVE_CHOICES = [0, 30, 90];
const REP_CHOICES = [0, 25, 40, 50, 60];
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Bar under the loading animation. Until the centre's own lists are in there
 * is no total yet, so it sweeps; during the scan it fills with "done / total"
 * beside it; once every follow is read it says the account details are next.
 */
function GalaxyProgress({ progress }) {
  const { t } = useTranslation();
  const total = progress?.total || 0;
  const done = Math.min(progress?.done || 0, total);
  const label = !total ? t('galaxy.progressLists')
    : done < total ? t('galaxy.progress') : t('galaxy.progressDetails');
  return (
    <div className="galaxy-progress">
      <span className="galaxy-progress-label">{label}</span>
      <div className="galaxy-progress-row">
        <div
          className={`galaxy-progress-bar${total ? '' : ' is-sweeping'}`}
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={total || undefined}
          aria-valuenow={total ? done : undefined}
        >
          <i style={total ? { width: `${(done / total) * 100}%` } : undefined} />
        </div>
        <span className="galaxy-progress-count">
          {total ? `${formatNumber(done)} / ${formatNumber(total)}` : '…'}
        </span>
      </div>
    </div>
  );
}

GalaxyProgress.propTypes = {
  progress: PropTypes.shape({ done: PropTypes.number, total: PropTypes.number }),
};

const MUSIC_KEY = '3speak_galaxy_music';

/**
 * Background music on or off, remembered in the browser. Browsers only allow
 * sound after a click or key press, so a remembered "on" waits for the first
 * one if the page has none yet. Quiet while the tab is hidden, gone when the
 * page closes.
 */
function useGalaxyMusic() {
  const [on, setOn] = useState(() => {
    try { return localStorage.getItem(MUSIC_KEY) === '1'; } catch { return false; }
  });
  const [music] = useState(createAmbient);
  useEffect(() => () => music.dispose(), [music]);
  useEffect(() => {
    if (!on) return undefined;
    let started = false;
    const off = () => {
      window.removeEventListener('pointerdown', begin);
      window.removeEventListener('keydown', begin);
    };
    function begin() {
      started = true;
      off();
      if (!document.hidden) music.start();
    }
    const onVisible = () => {
      if (document.hidden) music.stop();
      else if (started) music.start();
    };
    if (navigator.userActivation?.hasBeenActive ?? true) begin();
    else {
      window.addEventListener('pointerdown', begin);
      window.addEventListener('keydown', begin);
    }
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      off();
      document.removeEventListener('visibilitychange', onVisible);
      music.stop();
    };
  }, [on, music]);
  const toggle = () => {
    try { localStorage.setItem(MUSIC_KEY, on ? '0' : '1'); } catch { /* private mode */ }
    setOn(!on);
  };
  return [on, toggle, music.supported];
}

// Which floating panels are folded away, remembered per browser.
const COLLAPSED_KEY = '3speak_galaxy_collapsed';

function useCollapsed() {
  const [state, setState] = useState(() => {
    try { return JSON.parse(localStorage.getItem(COLLAPSED_KEY) || '{}') || {}; } catch { return {}; }
  });
  const toggle = (id) => setState((prev) => {
    const next = { ...prev, [id]: !prev[id] };
    try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next)); } catch { /* private mode: session only */ }
    return next;
  });
  return [state, toggle];
}

/** A side panel whose heading folds it away. */
function GalaxyPanel({ id, title, className, collapsed, onToggle, children }) {
  const open = !collapsed[id];
  return (
    <section className={`${className}${open ? '' : ' is-collapsed'}`}>
      <h2 className="galaxy-panel-head">
        <button type="button" aria-expanded={open} aria-controls={`galaxy-panel-${id}`} onClick={() => onToggle(id)}>
          <span>{title}</span>
          {open ? <MdExpandLess size={20} /> : <MdExpandMore size={20} />}
        </button>
      </h2>
      {open && <div id={`galaxy-panel-${id}`} className="galaxy-panel-body">{children}</div>}
    </section>
  );
}

GalaxyPanel.propTypes = {
  id: PropTypes.string.isRequired,
  title: PropTypes.node.isRequired,
  className: PropTypes.string.isRequired,
  collapsed: PropTypes.object.isRequired,
  onToggle: PropTypes.func.isRequired,
  children: PropTypes.node,
};

const cleanName = (v) => String(v || '').trim().replace(/^@/, '').toLowerCase();

/**
 * Hive galaxy: an account's ring (follows, followers or mutuals) as a 3D star
 * map, with the creators that ring follows (and the account doesn't yet) on an
 * outer shell to discover, filterable by overlap, activity, reputation and
 * 3Speak uploads. The list beside it carries the same suggestions, so the page
 * works without WebGL.
 */
// Phones and narrow windows get a note instead: the galaxy is desktop only
// (hooks/useGalaxyFits.js). Nothing is scanned there.
export default function Galaxy() {
  const fits = useGalaxyFits();
  const { t } = useTranslation();
  const params = useParams();
  if (fits) return <GalaxyView />;
  const user = cleanName(params.username);
  return (
    <div className="galaxy-page">
      <Helmet><title>{`3S | ${t('galaxy.title')}`}</title></Helmet>
      <div className="galaxy-state">
        <p>{t('galaxy.desktopOnly.title')}</p>
        <p className="galaxy-state-sub">{t('galaxy.desktopOnly.text')}</p>
        {ACCOUNT_RE.test(user) && (
          <Link className="galaxy-btn galaxy-btn--ghost" to={`/@${user}`}>{t('galaxy.desktopOnly.back', { user })}</Link>
        )}
      </div>
    </div>
  );
}

function GalaxyView() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const params = useParams();
  const [search, setSearch] = useSearchParams();
  const viewer = useAppStore((s) => s.user);
  const raw = cleanName(params.username);
  const center = raw && ACCOUNT_RE.test(raw) ? raw : viewer || DEFAULT_CENTER;
  const mode = MODES.includes(search.get('mode')) ? search.get('mode') : 'following';
  const depth = Object.hasOwn(SCAN_DEPTHS, search.get('depth') || '') ? search.get('depth') : DEFAULT_DEPTH;
  const qs = search.toString() ? `?${search.toString()}` : '';

  const [progress, setProgress] = useState(null); // { key, done, total }
  const [hover, setHover] = useState(null);
  const [picked, setPicked] = useState(null); // { name, kind, galaxy }
  const [pickedCircle, setPickedCircle] = useState(null); // { id, galaxy }
  const [find, setFind] = useState('');
  const [findNote, setFindNote] = useState(null); // { text, explore?: name }
  const [collapsed, toggleCollapsed] = useCollapsed();
  const [musicOn, toggleMusic, musicSupported] = useGalaxyMusic();
  const [minCount, setMinCount] = useState(null); // null = the galaxy's default
  const [activeDays, setActiveDays] = useState(0);
  const [minRep, setMinRep] = useState(0);
  const [creatorsOnly, setCreatorsOnly] = useState(false);
  const [hideMine, setHideMine] = useState(true);
  // Narrow screens only: the filters + list panel opens on demand (always shown on desktop).
  const [panelOpen, setPanelOpen] = useState(false);

  const galaxyKey = `${center}|${mode}|${depth}`;
  const { data, isLoading, isError } = useQuery({
    queryKey: ['galaxy', center, mode, depth],
    queryFn: () => buildGalaxy(center, {
      mode, depth, onProgress: (done, total) => setProgress({ key: galaxyKey, done, total }),
    }),
    staleTime: 30 * 60 * 1000,
    retry: false,
  });

  // Exploring someone else's galaxy: who YOU follow already isn't a discovery.
  const otherGalaxy = !!viewer && viewer !== center;
  const { data: mine } = useQuery({
    queryKey: ['galaxy-mine', viewer],
    queryFn: () => fetchFollowing(viewer).then((list) => new Set(list)),
    enabled: otherGalaxy,
    staleTime: 10 * 60 * 1000,
  });

  const setParam = (name, value, fallback) => {
    const next = new URLSearchParams(search);
    if (value === fallback) next.delete(name); else next.set(name, value);
    setSearch(next, { replace: true });
    setMinCount(null);
  };

  const maxCount = data?.suggestions[0]?.count || 1;
  const minNeeded = Math.min(minCount ?? data?.defaultMinCount ?? 1, maxCount);
  const profilesOk = !!data?.enriched.profiles;
  const creatorsOk = !!data?.enriched.creators;

  const { filtered, shown, top } = useMemo(() => {
    if (!data) return { filtered: [], shown: [], top: [] };
    const now = data.at;
    const list = data.suggestions.filter((s) => {
      if (s.count < minNeeded) return false;
      if (profilesOk && activeDays && !(s.active && now - s.active <= activeDays * DAY_MS)) return false;
      if (profilesOk && minRep && !((s.rep ?? 0) >= minRep)) return false;
      if (creatorsOk && creatorsOnly && !((s.videos || 0) + (s.shorts || 0) > 0)) return false;
      if (otherGalaxy && hideMine && (s.name === viewer || mine?.has(s.name))) return false;
      return true;
    });
    const onMap = list.slice(0, MAX_SHOWN);
    return {
      filtered: list,
      shown: onMap.map((s) => s.name),
      top: onMap.slice(0, AVATARS).map((s) => s.name),
    };
  }, [data, minNeeded, activeDays, minRep, creatorsOnly, hideMine, otherGalaxy, viewer, mine, profilesOk, creatorsOk]);

  const ring = useMemo(() => (data ? ringOnMap(data) : []), [data]);
  const ringSet = useMemo(() => new Set(ring), [ring]);
  const shownSet = useMemo(() => new Set(shown), [shown]);
  const byName = useMemo(() => new Map((data?.suggestions || []).map((s) => [s.name, s])), [data]);
  const followSet = useMemo(() => new Set(data?.following || []), [data]);
  const followerSet = useMemo(() => new Set(data?.followers || []), [data]);
  const mutualCount = useMemo(
    () => (data?.followersKnown ? data.ring.filter((n) => followSet.has(n) && followerSet.has(n)).length : 0),
    [data, followSet, followerSet],
  );

  // A pick belongs to the galaxy it was made in, and only while it is on the map.
  const onMap = (name) => name === center || ringSet.has(name) || shownSet.has(name);
  const selected = picked?.galaxy === galaxyKey && onMap(picked.name) ? picked : null;
  // Back and forward through where you looked, like a browser's history:
  // each pick, circle, trip home or hand-made move is a step, and a step
  // keeps the camera view you left it with.
  const [steps, setSteps] = useState(null); // { galaxy, list: [{ name, circle }], at }
  const posesRef = useRef(new WeakMap()); // step -> { t, c } camera pose
  const cameraRef = useRef(null); // GalaxyScene's getPose / flyTo
  const [view, setView] = useState(null); // { pose } to glide to after an undo/redo
  const hist = steps?.galaxy === galaxyKey ? steps : { galaxy: galaxyKey, list: [{ name: null, circle: null }], at: 0 };
  const remember = (step, pose = cameraRef.current?.getPose()) => { if (pose) posesRef.current.set(step, pose); };
  const addStep = (step, pose) => {
    const list = [...hist.list.slice(0, hist.at + 1), step].slice(-MAX_STEPS);
    if (pose) remember(step, pose);
    setSteps({ galaxy: galaxyKey, list, at: list.length - 1 });
  };
  const go = (name, circleId) => {
    const cur = hist.list[hist.at];
    if (cur.name === name && cur.circle === circleId) return;
    remember(cur);
    addStep({ name, circle: circleId });
  };
  const moved = (from, to) => {
    const cur = hist.list[hist.at];
    remember(cur, from);
    addStep({ name: cur.name, circle: cur.circle }, to);
  };
  const stepTo = (dir) => {
    const at = hist.at + dir;
    if (at < 0 || at >= hist.list.length) return;
    remember(hist.list[hist.at]);
    const step = hist.list[at];
    setSteps({ ...hist, at });
    setPicked(step.name ? { name: step.name, galaxy: galaxyKey } : null);
    setPickedCircle(step.circle ? { id: step.circle, galaxy: galaxyKey } : null);
    const pose = posesRef.current.get(step);
    setView(pose ? { pose } : null);
  };
  const canUndo = hist.at > 0;
  const canRedo = hist.at < hist.list.length - 1;

  // Runs after the scene's own effects (children first), so the kept view
  // wins over the glide a changed selection starts.
  useEffect(() => {
    if (view) cameraRef.current?.flyTo(view.pose);
  }, [view]);

  // Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z (or Ctrl+Y), except while typing.
  const stepRef = useRef(stepTo);
  useEffect(() => { stepRef.current = stepTo; });
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) return;
      const key = e.key.toLowerCase();
      if (key === 'z') { e.preventDefault(); stepRef.current(e.shiftKey ? 1 : -1); }
      else if (key === 'y') { e.preventDefault(); stepRef.current(1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // One focus at a time: a star or a circle.
  const pick = (name) => {
    setPicked(name ? { name, galaxy: galaxyKey } : null);
    setPickedCircle(null);
    go(name || null, null);
  };
  const chooseCircle = (id) => {
    const next = id && !(pickedCircle?.id === id && pickedCircle.galaxy === galaxyKey) ? id : null;
    setPickedCircle(next ? { id: next, galaxy: galaxyKey } : null);
    setPicked(null);
    go(null, next);
  };

  // Circles counted by their ring members on the map plus the suggestions
  // that pass the filters (the same number the narrowed list shows), kept
  // while at least a few of them are on the map.
  const allCircles = useMemo(() => (data ? findCircles(data) : []), [data]);
  const circles = useMemo(() => {
    const passing = new Set(filtered.map((s) => s.name));
    return allCircles
      .map((c) => {
        const ringHere = c.ring.filter((n) => ringSet.has(n));
        const count = c.suggestions.filter((n) => passing.has(n)).length;
        return {
          ...c,
          ring: ringHere,
          count,
          size: ringHere.length + count,
          onMap: ringHere.length + c.suggestions.filter((n) => shownSet.has(n)).length,
        };
      })
      .filter((c) => c.onMap >= 3)
      .sort((a, b) => b.size - a.size);
  }, [allCircles, filtered, ringSet, shownSet]);
  const sceneCircles = useMemo(() => circles.map((c) => ({
    id: c.id,
    label: t('galaxy.circles.label', { user: c.lead, count: c.size }),
    members: [...c.suggestions, ...c.ring],
  })), [circles, t]);
  const circleSize = (c) => [
    c.ring.length > 0 && t(`galaxy.circles.ring.${mode}`, { count: c.ring.length, user: center }),
    c.count > 0 && t('galaxy.circles.size', { count: c.count }),
  ].filter(Boolean).join(' · ');
  const circle = pickedCircle?.galaxy === galaxyKey ? circles.find((c) => c.id === pickedCircle.id) || null : null;
  const listed = useMemo(() => {
    if (!circle) return filtered;
    const inCircle = new Set(circle.suggestions);
    return filtered.filter((s) => inCircle.has(s.name));
  }, [filtered, circle]);
  const suggestion = selected && byName.get(selected.name);

  // The selection's own follows, both ways, cut down to what is on the map:
  // the scan only knows the scanned accounts' follows, but the overlap
  // between any two stars here is usually much larger.
  const linkName = selected && selected.name !== center ? selected.name : null;
  const { data: linkLists, isFetching: linksLoading } = useQuery({
    queryKey: ['galaxy-links', linkName],
    queryFn: () => fetchLinks(linkName),
    enabled: !!linkName,
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });
  const links = useMemo(() => {
    if (!linkName || !linkLists || !data) return null;
    const here = (n) => n !== linkName && (n === center || ringSet.has(n) || shownSet.has(n));
    const out = linkLists.following.filter(here);
    const incoming = new Set(linkLists.followers.filter(here));
    // Followers lists are capped; the scan already knows some of them for sure.
    byName.get(linkName)?.via.forEach((v) => { if (here(v)) incoming.add(v); });
    if (followSet.has(linkName)) incoming.add(center);
    return { name: linkName, out, in: [...incoming] };
  }, [linkName, linkLists, data, center, ringSet, shownSet, byName, followSet]);

  const relation = (name) => {
    const a = followSet.has(name);
    const b = followerSet.has(name);
    if (a && b) return t('galaxy.mutual', { user: center });
    if (b) return t('galaxy.followsCenter', { user: center });
    return t('galaxy.followedBy', { user: center });
  };
  const leadsOnMap = (name) => (data?.leads[name] || []).filter((n) => shownSet.has(n)).length;

  const activeText = (ts) => {
    const days = Math.floor((data.at - ts) / DAY_MS);
    return days < 1 ? t('galaxy.activeToday') : t('galaxy.activeAgo', { count: days });
  };

  // Find doubles as the account switch: a name on the map is flown to, any
  // other account gets a link to its own galaxy (or straight there while this
  // one has nothing to search).
  const findIn = (e) => {
    e.preventDefault();
    const name = cleanName(find);
    if (!name) return;
    if (!data?.ring.length) {
      if (ACCOUNT_RE.test(name)) navigate(`/galaxy/${name}${qs}`);
      return;
    }
    if (onMap(name)) { pick(name === center ? null : name); setFindNote(null); return; }
    if (byName.has(name) || data.ring.includes(name)) {
      setFindNote({ text: t('galaxy.find.hidden', { user: name }) });
    } else {
      setFindNote({ text: t('galaxy.find.missing', { user: name }), explore: ACCOUNT_RE.test(name) ? name : null });
    }
  };

  const resetFilters = () => {
    setMinCount(null);
    setActiveDays(0);
    setMinRep(0);
    setCreatorsOnly(false);
    setHideMine(true);
  };

  const ready = data && data.ring.length > 0;

  return (
    <div className="galaxy-page">
      <Helmet><title>{`3S | ${t('galaxy.title')}`}</title></Helmet>

      {/* Panels float over the full-bleed galaxy. */}
      <div className="galaxy-overlay galaxy-top">
      <h1 className="galaxy-sr-only">{t('galaxy.title')}</h1>

      {collapsed.toolbar ? (
        <button type="button" className="galaxy-toolbar-open" aria-expanded={false} onClick={() => toggleCollapsed('toolbar')}>
          <MdTune size={18} />
          <span>{t('galaxy.controls')}</span>
          <span className="galaxy-toolbar-open-mode">{t(`galaxy.mode.${mode}`)}</span>
        </button>
      ) : (
      <div className="galaxy-toolbar">
        <div className="galaxy-seg" role="group" aria-label={t('galaxy.modeLabel')}>
          {MODES.map((m) => (
            <button
              key={m}
              type="button"
              className={mode === m ? 'active' : ''}
              aria-pressed={mode === m}
              onClick={() => setParam('mode', m, 'following')}
            >
              {t(`galaxy.mode.${m}`)}
            </button>
          ))}
        </div>
        <label className="galaxy-select">
          <span>{t('galaxy.depth.label')}</span>
          <select value={depth} onChange={(e) => setParam('depth', e.target.value, DEFAULT_DEPTH)}>
            {Object.entries(SCAN_DEPTHS).map(([k, n]) => (
              <option key={k} value={k}>{t(`galaxy.depth.${k}`, { n: formatNumber(n) })}</option>
            ))}
          </select>
        </label>
        {!isLoading && (
          <form className="galaxy-find" onSubmit={findIn}>
            <input
              value={find}
              onChange={(e) => { setFind(e.target.value); setFindNote(null); }}
              placeholder={t('galaxy.find.placeholder')}
              aria-label={t('galaxy.find.label')}
              list="galaxy-names"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
            <datalist id="galaxy-names">
              {shown.map((n) => <option key={`s-${n}`} value={n} />)}
              {ring.map((n) => <option key={`r-${n}`} value={n} />)}
            </datalist>
            <button type="submit">{t('galaxy.find.go')}</button>
            {findNote && (
              <span className="galaxy-find-note" role="status">
                {findNote.text}
                {findNote.explore && (
                  <>
                    {' '}
                    <Link to={`/galaxy/${findNote.explore}${qs}`}>{t('galaxy.find.explore', { user: findNote.explore })}</Link>
                  </>
                )}
              </span>
            )}
          </form>
        )}
        {ready && (
          <button
            type="button"
            className={`galaxy-panel-toggle${panelOpen ? ' active' : ''}`}
            aria-expanded={panelOpen}
            onClick={() => setPanelOpen((v) => !v)}
          >
            {t('galaxy.panelToggle', { count: filtered.length })}
          </button>
        )}
        <button
          type="button"
          className="galaxy-collapse"
          aria-expanded
          aria-label={t('galaxy.collapse')}
          title={t('galaxy.collapse')}
          onClick={() => toggleCollapsed('toolbar')}
        >
          <MdExpandLess size={20} />
        </button>
      </div>
      )}

      {ready && (
        <div className="galaxy-tools">
        <div className="galaxy-pill" role="group" aria-label={t('galaxy.history.label')}>
          <button type="button" className="galaxy-collapse" disabled={!canUndo} onClick={() => stepTo(-1)} aria-label={t('galaxy.history.undo')} title={t('galaxy.history.undoKey')}>
            <MdUndo size={20} />
          </button>
          <button type="button" className="galaxy-collapse" disabled={!canRedo} onClick={() => stepTo(1)} aria-label={t('galaxy.history.redo')} title={t('galaxy.history.redoKey')}>
            <MdRedo size={20} />
          </button>
        </div>
        {musicSupported && (
          <div className="galaxy-pill">
            <button
              type="button"
              className={`galaxy-collapse${musicOn ? ' is-on' : ''}`}
              aria-pressed={musicOn}
              onClick={toggleMusic}
              aria-label={t('galaxy.music')}
              title={t('galaxy.music')}
            >
              {musicOn ? <MdMusicNote size={20} /> : <MdMusicOff size={20} />}
            </button>
          </div>
        )}
        </div>
      )}
      </div>

      <div className="galaxy-body">
        <div className="galaxy-stage">
          {isLoading && (
            <div className="galaxy-state">
              <div className="galaxy-loader" aria-hidden="true">
                <i className="galaxy-loader-core" />
                <span className="galaxy-loader-orbit"><i /></span>
                <span className="galaxy-loader-orbit galaxy-loader-orbit--outer"><i /></span>
              </div>
              <p>{t('galaxy.loading', { user: center })}</p>
              <GalaxyProgress progress={progress?.key === galaxyKey ? progress : null} />
            </div>
          )}
          {isError && <div className="galaxy-state">{t('galaxy.error')}</div>}
          {data && !data.ring.length && <div className="galaxy-state">{t(`galaxy.empty.${mode}`, { user: center })}</div>}

          {ready && (
            <>
              <GalaxyScene
                key={galaxyKey}
                data={data}
                shown={shown}
                top={top}
                selected={selected?.name || null}
                links={links}
                circles={sceneCircles}
                circle={circle?.id || null}
                onCircle={chooseCircle}
                onHover={setHover}
                onSelect={(hit) => pick(hit && hit.kind !== 'center' ? hit.name : null)}
                onMoved={moved}
                cameraRef={cameraRef}
              />
              <div className="galaxy-legend">
                <span><i className="dot dot--center" />{t('galaxy.legend.center', { user: center })}</span>
                {data.followersKnown ? (
                  <>
                    <span><i className="dot dot--follow" />{t('galaxy.legend.mutual', { count: mutualCount })}</span>
                    {mode !== 'mutuals' && (
                      <span><i className="dot dot--oneway" />{t('galaxy.legend.oneWay', { count: data.ring.length - mutualCount })}</span>
                    )}
                  </>
                ) : (
                  <span><i className="dot dot--follow" />{t('galaxy.legend.follows', { count: data.ring.length })}</span>
                )}
                <span><i className="dot dot--suggest" />{t('galaxy.legend.suggestions', { count: shown.length, total: data.suggestions.length })}</span>
                {data.ring.length > ring.length && (
                  <span className="galaxy-legend-note">{t('galaxy.legend.capped', { shown: ring.length, total: data.ring.length })}</span>
                )}
              </div>
              <p className="galaxy-hint">{t('galaxy.hint')}</p>
              <p className="galaxy-credit">
                <Trans
                  i18nKey="galaxy.credit"
                  values={{ user: HAFSQL_MAINTAINER }}
                  components={{
                    src: <a href="https://mahdiyari.gitlab.io/hafsql" target="_blank" rel="noopener noreferrer" />,
                    user: <a href={`https://peakd.com/@${HAFSQL_MAINTAINER}`} target="_blank" rel="noopener noreferrer" />,
                  }}
                />
              </p>
            </>
          )}

          {hover && (
            <div className="galaxy-tip" style={{ left: hover.x, top: hover.y }}>
              <strong>@{hover.name}</strong>
              {hover.kind === 'suggestion' && byName.has(hover.name) && (
                <span>{t('galaxy.via', { count: byName.get(hover.name).count, total: data.sampled.length })}</span>
              )}
              {hover.kind === 'follow' && <span>{relation(hover.name)}</span>}
            </div>
          )}

          {selected && selected.name !== center && (
            <div className="galaxy-card">
              <button type="button" className="galaxy-card-close" onClick={() => pick(null)} aria-label={t('galaxy.close')}>
                <MdClose size={18} />
              </button>
              <div className="galaxy-card-who">
                <HiveAvatar username={selected.name} size="small" className="galaxy-card-avatar" />
                <span className="galaxy-card-names">
                  {suggestion?.displayName && <span className="galaxy-card-display">{suggestion.displayName}</span>}
                  <strong>@{selected.name}</strong>
                </span>
              </div>
              {suggestion ? (
                <>
                  <p>{t('galaxy.via', { count: suggestion.count, total: data.sampled.length })}</p>
                  <ul className="galaxy-card-stats">
                    {suggestion.followers != null && <li>{t('galaxy.stats.followers', { count: suggestion.followers, n: formatNumber(suggestion.followers, { compact: true }) })}</li>}
                    {suggestion.rep != null && <li>{t('galaxy.stats.rep', { rep: Math.floor(suggestion.rep) })}</li>}
                    {suggestion.videos != null && (suggestion.videos + suggestion.shorts > 0
                      ? <li>{t('galaxy.stats.videos', { videos: suggestion.videos, shorts: suggestion.shorts })}</li>
                      : <li>{t('galaxy.stats.noVideos')}</li>)}
                    {suggestion.active && <li>{activeText(suggestion.active)}</li>}
                  </ul>
                </>
              ) : (
                <>
                  <p>{relation(selected.name)}</p>
                  {data.sampled.includes(selected.name) && (
                    <p className="galaxy-card-sub">{t('galaxy.leadsTo', { count: leadsOnMap(selected.name) })}</p>
                  )}
                </>
              )}
              <div className="galaxy-card-links" aria-live="polite">
                {linksLoading && !links && <span>{t('galaxy.links.loading')}</span>}
                {links && (
                  <>
                    <span><i className="galaxy-line galaxy-line--out" />{t('galaxy.links.out', { count: links.out.length })}</span>
                    <span><i className="galaxy-line galaxy-line--in" />{t('galaxy.links.in', { count: links.in.length })}</span>
                  </>
                )}
              </div>
              <div className="galaxy-card-actions">
                <Link className="galaxy-btn" to={`/@${selected.name}`} target="_blank" rel="noopener noreferrer">{t('galaxy.openChannel')}</Link>
                <Link className="galaxy-btn galaxy-btn--ghost" to={`/galaxy/${selected.name}${qs}`}>{t('galaxy.exploreHere')}</Link>
              </div>
            </div>
          )}
        </div>

        {data && data.ring.length > 0 && (
          <aside className={`galaxy-overlay galaxy-side${panelOpen ? ' is-open' : ''}`}>
            <GalaxyPanel id="filters" className="galaxy-filters" title={t('galaxy.filters.title')} collapsed={collapsed} onToggle={toggleCollapsed}>

              <label className="galaxy-range">
                <span>{t('galaxy.filters.overlap', { count: minNeeded, total: data.sampled.length })}</span>
                <input
                  type="range"
                  min={1}
                  max={maxCount}
                  value={minNeeded}
                  disabled={maxCount < 2}
                  onChange={(e) => setMinCount(Number(e.target.value))}
                />
              </label>

              <label className="galaxy-select">
                <span>{t('galaxy.filters.active')}</span>
                <select value={activeDays} disabled={!profilesOk} onChange={(e) => setActiveDays(Number(e.target.value))}>
                  {ACTIVE_CHOICES.map((d) => (
                    <option key={d} value={d}>{d ? t('galaxy.filters.activeWithin', { count: d }) : t('galaxy.filters.any')}</option>
                  ))}
                </select>
              </label>

              <label className="galaxy-select">
                <span>{t('galaxy.filters.rep')}</span>
                <select value={minRep} disabled={!profilesOk} onChange={(e) => setMinRep(Number(e.target.value))}>
                  {REP_CHOICES.map((r) => (
                    <option key={r} value={r}>{r ? t('galaxy.filters.repAtLeast', { rep: r }) : t('galaxy.filters.any')}</option>
                  ))}
                </select>
              </label>

              <label className="galaxy-check">
                <input type="checkbox" checked={creatorsOnly} disabled={!creatorsOk} onChange={(e) => setCreatorsOnly(e.target.checked)} />
                <span>{t('galaxy.filters.creators')}</span>
              </label>

              {otherGalaxy && (
                <label className="galaxy-check">
                  <input type="checkbox" checked={hideMine} onChange={(e) => setHideMine(e.target.checked)} />
                  <span>{t('galaxy.filters.hideMine')}</span>
                </label>
              )}

              {(!profilesOk || !creatorsOk) && <p className="galaxy-filters-note">{t('galaxy.filters.partial')}</p>}
              <p className="galaxy-filters-note">{t('galaxy.scanInfo', { count: data.sampled.length, total: data.ring.length })}</p>
              {data.mapRing && <p className="galaxy-filters-note">{t('galaxy.scanSkip', { n: formatNumber(MASS_FOLLOWING) })}</p>}
            </GalaxyPanel>

            {circles.length > 0 && (
              <GalaxyPanel
                id="circles"
                className="galaxy-list galaxy-circles"
                title={`${t('galaxy.circles.title')} (${circles.length})`}
                collapsed={collapsed}
                onToggle={toggleCollapsed}
              >
                <p className="galaxy-filters-note">{t('galaxy.circles.note')}</p>
                <ul>
                  {circles.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        className={circle?.id === c.id ? 'active' : ''}
                        aria-pressed={circle?.id === c.id}
                        onClick={() => chooseCircle(c.id)}
                      >
                        <HiveAvatar username={c.lead} size="small" className="galaxy-list-avatar" />
                        <span className="galaxy-list-text">
                          <span className="galaxy-list-name">{t('galaxy.circles.name', { user: c.lead })}</span>
                          <span className="galaxy-list-via">{circleSize(c)}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </GalaxyPanel>
            )}

            <GalaxyPanel
              id="list"
              className="galaxy-list"
              title={`${t('galaxy.discover')} (${formatNumber(listed.length)})`}
              collapsed={collapsed}
              onToggle={toggleCollapsed}
            >
              {circle && (
                <button type="button" className="galaxy-list-chip" onClick={() => chooseCircle(null)}>
                  <span>{t('galaxy.circles.in', { user: circle.lead })}</span>
                  <MdClose size={14} aria-label={t('galaxy.circles.clear')} />
                </button>
              )}
              {circle?.ring.length > 0 && (
                <div className="galaxy-circle-ring">
                  <p className="galaxy-filters-note">{t(`galaxy.circles.ringTitle.${mode}`, { count: circle.ring.length, user: center })}</p>
                  <div className="galaxy-circle-faces">
                    {circle.ring.slice(0, CIRCLE_FACES).map((n) => (
                      <button key={n} type="button" title={`@${n}`} aria-label={`@${n}`} onClick={() => pick(n)}>
                        <HiveAvatar username={n} size="small" className="galaxy-list-avatar" />
                      </button>
                    ))}
                    {circle.ring.length > CIRCLE_FACES && (
                      <span className="galaxy-circle-more">+{formatNumber(circle.ring.length - CIRCLE_FACES)}</span>
                    )}
                  </div>
                </div>
              )}
              {listed.length === 0 && circle?.ring.length > 0 ? null : listed.length === 0 ? (
                <div className="galaxy-list-empty">
                  <p>{data.suggestions.length ? t('galaxy.filters.none') : t('galaxy.noSuggestions')}</p>
                  {data.suggestions.length > 0 && (
                    <button type="button" className="galaxy-btn galaxy-btn--plain" onClick={resetFilters}>{t('galaxy.filters.reset')}</button>
                  )}
                </div>
              ) : (
                <ul>
                  {listed.slice(0, LIST_SIZE).map((s) => (
                    <li key={s.name}>
                      <button
                        type="button"
                        className={selected?.name === s.name ? 'active' : ''}
                        onClick={() => pick(s.name)}
                      >
                        <HiveAvatar username={s.name} size="small" className="galaxy-list-avatar" />
                        <span className="galaxy-list-text">
                          <span className="galaxy-list-name">@{s.name}</span>
                          <span className="galaxy-list-via">{t('galaxy.via', { count: s.count, total: data.sampled.length })}</span>
                        </span>
                        {(s.videos || 0) + (s.shorts || 0) > 0 && (
                          <MdOndemandVideo className="galaxy-list-badge" size={16} title={t('galaxy.stats.videos', { videos: s.videos, shorts: s.shorts })} />
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </GalaxyPanel>
          </aside>
        )}
      </div>
    </div>
  );
}
