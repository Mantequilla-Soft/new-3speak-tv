import { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { IoClose } from 'react-icons/io5';
import { toastIn } from '../../utils/toast';
import { useAppStore } from '../../lib/store';
import { APP_VERSION } from '../../version';
import { getHiveUrl } from '../../utils/hiveNode';
import { fetchUserInterests, saveInterestsToHive } from '../../utils/interests';
import { fetchAdAccess, fetchCreatorAdPrefs, fetchViewerAdPrefs, setViewerAdPrefs } from '../../lib/advertiseData';
import { saveCreatorAdSettings } from '../../utils/adSettings';
import { adsEnabledFor, adsBetaUserFor } from '../../utils/config';
import {
  pushSupported, getPushState, enablePush, disablePush, getPushPrefs, setPushPrefs,
} from '../../utils/webPush';
import TagsV2Picker from '../tooltip/TagsV2Picker';
import DataRequestForm from './DataRequestForm';
import './SettingsModal.scss';

// Every toast from this module is headed "Settings"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Settings');

const sameSet = (a, b) =>
  JSON.stringify([...(a || [])].sort()) === JSON.stringify([...(b || [])].sort());

// Interests picker — canonical copy lives in the user's Hive posting_json_metadata.
// Rendered only while the modal is open, so its hooks mount/unmount with it.
function InterestsSection() {
  const { interests, setInterests, user } = useAppStore();
  const [hydrating, setHydrating] = useState(false);
  const [saving, setSaving] = useState(false);
  // Transient "Saved" confirmation shown right after a save. Resets when the
  // modal (and this section) unmounts, so reopening settings never shows it.
  const [justSaved, setJustSaved] = useState(false);
  const savedRef = useRef(null); // last-known on-chain selection

  // Hydrate from Hive on open (Hive is canonical); keep local cache as fallback.
  useEffect(() => {
    if (!user) return;
    let alive = true;
    setHydrating(true);
    fetchUserInterests(user)
      .then((server) => {
        if (alive && server != null) { setInterests(server); savedRef.current = server; }
      })
      .finally(() => { if (alive) setHydrating(false); });
    return () => { alive = false; };
  }, [user]);

  const dirty = savedRef.current == null
    ? (interests || []).length > 0
    : !sameSet(interests, savedRef.current);

  const save = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const list = await saveInterestsToHive(user, interests);
      savedRef.current = list;
      setInterests(list);
      setJustSaved(true);
      toast.success('Interests saved to your Hive profile');
    } catch (e) {
      toast.error(e?.message || 'Could not save interests');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="settings-section">
      <h4 className="settings-section-title">
        Interests{hydrating && <span className="settings-interests-status"> · loading…</span>}
      </h4>
      <p className="settings-interests-hint">
        Pick the topics you care about — we’ll use them to show you more of the content you like.
        {!user && ' Log in to choose your interests.'}
      </p>
      <TagsV2Picker
        multi
        searchable
        value={interests || []}
        onChange={(next) => { setJustSaved(false); setInterests(next); }}
        disabled={!user || saving}
      />
      {/* Only shown when there's something to save, while saving, or right after
          a save (the transient "Saved" confirmation). Hidden otherwise. */}
      {user && (dirty || saving || justSaved) && (
        <div className="settings-interests-actions">
          <button
            type="button"
            className="settings-interests-save"
            onClick={save}
            disabled={!dirty || saving}
          >
            {saving ? 'Saving…' : dirty ? 'Save interests' : 'Saved'}
          </button>
        </div>
      )}
    </div>
  );
}

// Small inline switch (replaces the big LabeledToggle in this dialog).
// Ads on the creator's own videos. Ads run network-wide by default, so this is the
// other half of that bargain and has to be reachable by every login — including
// HiveSigner and Butter Auth, which cannot sign in the browser (the data layer
// falls back to a delegated @threespeak signature for those).
function AdsSection() {
  const user = useAppStore((s) => s.user);
  const [adsEnabled, setAdsEnabled] = useState(true);
  // Placeholder only — the real split (and the platform default for a creator who
  // has never set one) comes from the server. The row stays hidden until it lands,
  // so nobody is shown a share that is about to change under them.
  const [split, setSplit] = useState(null);
  // The percentage box is a draft until saved: every save costs a wallet signature,
  // so typing "25" must not fire three of them on the way there.
  const [draftCommunity, setDraftCommunity] = useState('0');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Closed testing — nothing renders and nothing is fetched for anyone else.
  const visible = adsEnabledFor(user);

  useEffect(() => {
    if (!user || !visible) return undefined;
    let alive = true;
    setLoading(true);
    fetchCreatorAdPrefs(user)
      .then((r) => {
        if (!alive) return;
        setAdsEnabled(r.adsEnabled !== false);
        if (r.split) { setSplit(r.split); setDraftCommunity(String(r.split.communityPct)); }
      })
      .catch(() => { /* unreadable preference just shows the default */ })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [user, visible]);

  // Both fields ride one signed message, so saving either costs a single prompt.
  async function save(nextEnabled, nextCommunity) {
    if (saving) return false;
    setSaving(true);
    setError(null);
    try {
      // Writes both copies: the checker row the ad server reads, and the creator's
      // own posting_json_metadata. The chain half is best effort, so a rejected
      // wallet prompt does not undo a setting that has already taken effect here.
      const res = await saveCreatorAdSettings(user, {
        adsEnabled: nextEnabled,
        communitySharePct: nextCommunity,
      });
      if (res.split) { setSplit(res.split); setDraftCommunity(String(res.split.communityPct)); }
      if (!res.chainSaved) {
        setError('Saved on 3Speak, but not on your Hive account. Try again to store it there too.');
      }
      return true;
    } catch (err) {
      setError(err.message || 'Could not save the setting.');
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function onToggle(next) {
    const previous = adsEnabled;
    setAdsEnabled(next);          // optimistic — a toggle that lags feels broken
    const ok = await save(next, split ? split.communityPct : undefined);
    if (ok) toast.success(next ? 'Ads are on for your videos' : 'Ads are off for your videos');
    else setAdsEnabled(previous); // put it back; the setting did not change
  }

  const parsedDraft = parseInt(draftCommunity, 10);
  const draftValid = !!split
    && Number.isInteger(parsedDraft) && parsedDraft >= 0 && parsedDraft <= split.poolPct;
  const draftChanged = draftValid && parsedDraft !== split.communityPct;

  async function onSaveShare() {
    if (!draftChanged) return;
    if (await save(adsEnabled, parsedDraft)) toast.success('Revenue split saved');
  }

  if (!user || !visible) return null;

  return (
    <div className="settings-section">
      <h4 className="settings-section-title">Ads on your videos</h4>
      <div className="settings-modal-row">
        <div className="settings-row-text">
          <span className="settings-row-title">Allow ads</span>
          <span className="settings-row-desc">
            A short sponsor spot can play inside your videos. You get a share of what it
            earns, and so does the community you posted in. Turn this off and your videos
            carry no ads at all &mdash; they are also removed from what we offer
            advertisers, so nothing is sold that you have opted out of.
          </span>
        </div>
        <Switch
          checked={adsEnabled}
          onChange={onToggle}
          ariaLabel="Allow ads on your videos"
        />
      </div>
      {adsEnabled && split && (
        <div className="settings-modal-row settings-ads-split">
          <div className="settings-row-text">
            <span className="settings-row-title">Share with the community</span>
            <span className="settings-row-desc">
              {split.poolPct}% of what an ad earns is split between you and the community
              you posted in. Choose how much of it the community gets &mdash; leave it at
              zero and you keep all {split.poolPct}%.
            </span>
            <span className="settings-ads-breakdown">
              You {draftValid ? split.poolPct - parsedDraft : split.creatorPct}%
              <span aria-hidden="true"> · </span>
              Community {draftValid ? parsedDraft : split.communityPct}%
            </span>
          </div>
          <div className="settings-ads-share-control">
            <label className="settings-visually-hidden" htmlFor="settings-community-share">
              Community share, percent
            </label>
            <div className="settings-ads-input">
              <input
                id="settings-community-share"
                type="number"
                min="0"
                max={split.poolPct}
                step="1"
                inputMode="numeric"
                value={draftCommunity}
                onChange={(e) => setDraftCommunity(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') onSaveShare(); }}
                aria-invalid={!draftValid}
              />
              <span aria-hidden="true">%</span>
            </div>
            {draftChanged && (
              <button type="button" className="settings-ads-save" onClick={onSaveShare} disabled={saving}>
                Save
              </button>
            )}
          </div>
        </div>
      )}
      {(loading || saving || error || (split && !draftValid)) && (
        <p className={`settings-ads-status${(error || (split && !draftValid)) ? ' error' : ''}`}>
          {error
            || (split && !draftValid ? `Enter a whole number between 0 and ${split.poolPct}.` : null)
            || (saving ? 'Saving\u2026' : 'Loading your current setting\u2026')}
        </p>
      )}
    </div>
  );
}

/**
 * Viewer rewards. A separate section from AdsSection on purpose: that one is about
 * what runs on YOUR videos as a creator, this one is about being paid for watching
 * other people's. Same person, two unrelated decisions, and merging them would
 * imply that turning ads off on your channel also gives up your viewer share.
 *
 * The consent is the feature. We cannot pay someone we cannot name, so the toggle
 * is really "may we store your username against what you watch" — and the copy
 * says that plainly rather than hiding it behind the word "rewards".
 */
function ViewerRewardsSection() {
  const user = useAppStore((s) => s.user);
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const visible = adsEnabledFor(user);

  useEffect(() => {
    if (!user || !visible) return undefined;
    let alive = true;
    setLoading(true);
    fetchViewerAdPrefs(user)
      .then((r) => { if (alive) setEnabled(r.rewardsEnabled === true); })
      .catch(() => { /* an unreadable setting is not worth an error banner */ })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [user, visible]);

  if (!user || !visible) return null;

  async function onToggle(next) {
    // Optimistic, then rolled back on failure. Every save costs a signature, so the
    // switch must not sit unresponsive while a wallet prompt is open.
    const previous = enabled;
    setEnabled(next);
    setSaving(true);
    setError(null);
    try {
      await setViewerAdPrefs(user, { rewardsEnabled: next });
      toast.success(next
        ? 'Viewer rewards on'
        : 'Viewer rewards off, and your watch data has been deleted');
    } catch (err) {
      setEnabled(previous);
      setError(err.message || 'Could not save that setting.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="settings-modal-section">
      <h3 className="settings-section-title">Earn while you watch</h3>
      <div className="settings-modal-row">
        <div className="settings-row-text">
          <span className="settings-row-title">Viewer rewards</span>
          <span className="settings-row-desc">
            Earn a share of ad revenue for what you watch, paid in HBD or HIVE. You are
            paid on videos watched, whether or not an ad played, so it rewards watching
            rather than sitting through ads. Ads themselves play for everyone except
            3Speak Pro subscribers. We record how much of each video you watched, on top
            of the watch history the Watched page already keeps, and delete it the moment
            you turn this off.
          </span>
        </div>
        <Switch
          checked={enabled}
          onChange={onToggle}
          ariaLabel="Earn a share of ad revenue for what you watch"
        />
      </div>
      {(loading || saving || error) && (
        <p className={`settings-ads-status${error ? ' error' : ''}`}>
          {error || (saving ? 'Saving…' : 'Loading your current setting…')}
        </p>
      )}
    </div>
  );
}

function Switch({ checked, onChange, ariaLabel }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      className={`settings-switch${checked ? ' on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="settings-switch-knob" />
    </button>
  );
}

/**
 * Browser push notifications.
 *
 * Two separate things, deliberately shown as such: whether THIS DEVICE is
 * registered at all (a browser permission, per machine), and WHAT you want to
 * hear about (a preference, per account, applying to every device). Someone who
 * turns notifications off on their laptop shouldn't lose their choices on their
 * phone, so the per-kind switches stay visible and editable either way.
 */
const KIND_COPY = {
  videos: { title: 'New videos', desc: 'When a creator you follow publishes a video.' },
  shorts: { title: 'New shorts', desc: 'When a creator you follow posts a short.' },
  audio: { title: 'New audio', desc: 'When a creator you follow uploads a track or episode.' },
  replies: { title: 'Replies', desc: 'When someone replies to your post or comment.' },
  mentions: { title: 'Mentions', desc: 'When someone mentions you by name.' },
  follows: { title: 'New followers', desc: 'When someone follows you.' },
  votes: { title: 'Upvotes', desc: 'When someone upvotes your post. Off by default — a popular post is a lot of buzzes.' },
  reblogs: { title: 'Reblogs', desc: 'When someone reblogs your post.' },
};

// The two groups answer different questions: what other people published, and
// what happened to you.
const KIND_GROUPS = [
  { label: 'From creators you follow', kinds: ['videos', 'shorts', 'audio'] },
  { label: 'About you', kinds: ['replies', 'mentions', 'follows', 'votes', 'reblogs'] },
];

function NotificationsSection() {
  const user = useAppStore((s) => s.user);
  const [state, setState] = useState({ supported: false, worker: true, permission: 'default', subscribed: false });
  const [kinds, setKinds] = useState([]);
  const [prefs, setPrefs] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (pushSupported()) getPushState().then(setState).catch(() => {});
  }, []);

  useEffect(() => {
    if (!user) return;
    getPushPrefs(user).then(({ kinds: k, prefs: p }) => { setKinds(k); setPrefs(p); }).catch(() => {});
  }, [user]);

  const toggleDevice = async () => {
    setBusy(true);
    try {
      if (state.subscribed) {
        await disablePush(user);
        toast.success('This device will no longer be notified');
      } else {
        await enablePush(user);
        toast.success('This device will be notified');
      }
      setState(await getPushState());
    } catch (err) {
      toast.error(err.message || 'Could not change notifications');
    } finally {
      setBusy(false);
    }
  };

  const toggleKind = async (kind, value) => {
    const next = { ...prefs, [kind]: value };
    setPrefs(next);                                   // optimistic: a switch that lags feels broken
    try {
      setPrefs(await setPushPrefs(user, next));
    } catch (err) {
      setPrefs(prefs);                                // put it back rather than lie
      toast.error(err.message || 'Could not save that');
    }
  };

  if (!user) {
    return (
      <div className="settings-section">
        <h4 className="settings-section-title">Notifications</h4>
        <p className="settings-note">Log in to choose what you get notified about.</p>
      </div>
    );
  }

  const blocked = state.permission === 'denied';
  const noWorker = state.worker === false;

  return (
    <div className="settings-section">
      <h4 className="settings-section-title">Notifications</h4>

      {!pushSupported() ? (
        <p className="settings-note">This browser can’t show notifications. On iPhone and iPad they only work once 3Speak is added to the Home Screen.</p>
      ) : (
        <>
          <Row
            title="Notify this device"
            desc={blocked
              ? 'Blocked in your browser settings for this site — allow notifications there first.'
              : noWorker
                ? 'Not available on this build.'
                : 'Get a notification even when 3Speak isn’t open. Applies to this browser only.'}
            checked={state.subscribed}
            onChange={busy || blocked || noWorker ? () => {} : toggleDevice}
          />

          <p className="settings-note">
            What to be notified about. These apply to every device you’ve turned on.
          </p>
          {KIND_GROUPS.map(({ label, kinds: group }) => {
            // Only offer what the server actually supports, so an older backend
            // can't leave dead switches on the page.
            const available = group.filter((k) => !kinds.length || kinds.includes(k));
            if (!available.length) return null;
            return (
              <div key={label} className="settings-kind-group">
                <span className="settings-kind-group-label">{label}</span>
                {available.map((k) => (
                  <Row
                    key={k}
                    title={KIND_COPY[k].title}
                    desc={KIND_COPY[k].desc}
                    checked={prefs[k] !== false}
                    onChange={(v) => toggleKind(k, v)}
                  />
                ))}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

function Row({ title, desc, checked, onChange }) {
  return (
    <div className="settings-modal-row">
      <div className="settings-row-text">
        <span className="settings-row-title">{title}</span>
        <span className="settings-row-desc">{desc}</span>
      </div>
      <Switch checked={checked} onChange={onChange} ariaLabel={title} />
    </div>
  );
}

const TABS = [
  { id: 'general', label: 'General' },
  { id: 'shorts', label: 'Shorts' },
  { id: 'content', label: 'Content' },
  // Its own page rather than a tail on Content. Both halves are about money moving
  // between advertisers, creators and viewers, and they were the two longest things on
  // a page otherwise made of one-line switches.
  { id: 'rewards', label: 'Ads & rewards' },
  { id: 'interests', label: 'Interests' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'about', label: 'About / Contact' },
];

/**
 * Settings popup — the toggles that used to live inline in the profile
 * side menu, now grouped with headers + explanations and compact switches.
 */
export default function SettingsModal({ isOpen, onClose }) {
  const { theme, showNsfw, setShowNsfw, toggleTheme, sidebarHidden, setSidebarHidden, homeCardSize, setHomeCardSize, previewEnabled, setPreviewEnabled, shortsCommentBar, setShortsCommentBar, openShortsOnStart, setOpenShortsOnStart, inlineShorts, setInlineShorts, hideWatched, setHideWatched, privateMode, setPrivateMode, simpleFeed, setSimpleFeed } = useAppStore();
  /* Whether the Ads & rewards page exists at all.
   *
   * 🚨 THE CHECKER DECIDES, not the build flag. adsEnabledFor() is true for everybody
   * whenever VITE_ENABLE_ADS is set, which it is on preview — so gating on it showed the
   * page to every logged-in account while the checker was still refusing all of them for
   * not being in the closed test. A settings page whose every write is rejected is worse
   * than no page.
   *
   * `/advertise/access` is the same answer the ad prompts already use, with the local
   * beta list as the fallback for when it cannot be reached. The build flag stays as a
   * necessary condition: it says whether this build has the feature at all. */
  const settingsUser = useAppStore((st) => st.user);
  const [adAccess, setAdAccess] = useState(null);
  useEffect(() => {
    if (!isOpen || !settingsUser || !adsEnabledFor(settingsUser)) { setAdAccess(null); return undefined; }
    let alive = true;
    fetchAdAccess(settingsUser).then((a) => {
      if (!alive) return;
      setAdAccess({ account: settingsUser, allowed: a ? a.allowed : adsBetaUserFor(settingsUser) });
    });
    return () => { alive = false; };
  }, [isOpen, settingsUser]);
  const rewardsVisible = !!settingsUser
    && adsEnabledFor(settingsUser)
    && adAccess?.account === settingsUser
    && adAccess.allowed === true;
  const visibleTabs = useMemo(
    () => TABS.filter((t) => t.id !== 'rewards' || rewardsVisible),
    [rewardsVisible],
  );
  const [tab, setTab] = useState('general');
  // Losing the group (or logging out) while standing on that page would leave the modal
  // with no tab selected and nothing rendered.
  useEffect(() => {
    if (tab === 'rewards' && !rewardsVisible) setTab('general');
  }, [tab, rewardsVisible]);

  // Lock background page scroll while the modal is open (restore on close).
  useEffect(() => {
    if (!isOpen) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [isOpen]);

  // ── Pin the dialog's top-left corner where it lands on open ──
  // The overlay flex-CENTRES the dialog, so a taller tab pushes the top edge
  // upward and the whole thing visibly jumps as you switch tabs. We let it centre
  // once, measure where it landed, then switch to fixed top/left so it only ever
  // grows/shrinks DOWNWARD from that spot.
  //
  // Not on mobile: there it's a bottom sheet and must stay pinned to the bottom.
  const modalRef = useRef(null);
  const [anchor, setAnchor] = useState(null);

  // Hidden soft-launch unlock: 5 quick taps on the Hive RPC node row force-enables
  // Butter Auth (login + signup) via localStorage, even when VITE_ENABLE_BUTRAUTH
  // is off. Reload so every gate (config ENABLE_BUTRAUTH, aioha) re-reads the flag.
  const butrTapRef = useRef({ count: 0, t: 0 });
  const handleButrUnlockTap = () => {
    const now = Date.now();
    const s = butrTapRef.current;
    if (now - s.t > 2000) s.count = 0; // taps must be within 2s of each other
    s.t = now;
    s.count += 1;
    if (s.count >= 5) {
      s.count = 0;
      localStorage.setItem('butrauth_unlocked', 'true');
      toast.success('Butter Auth unlocked');
      setTimeout(() => window.location.reload(), 600);
    }
  };

  useLayoutEffect(() => {
    if (!isOpen) { setAnchor(null); return undefined; }
    // Bottom sheet (<=640px, see the SCSS) must not be anchored.
    if (!window.matchMedia('(min-width: 641px)').matches) { setAnchor(null); return undefined; }

    // anchor===null → currently centred, so this measurement is the "opened" spot.
    if (!anchor && modalRef.current) {
      const r = modalRef.current.getBoundingClientRect();
      setAnchor({ top: r.top, left: r.left });
    }

    // On resize the stored coords are stale — drop the anchor so it re-centres and
    // the effect measures the new spot on the next pass.
    const onResize = () => setAnchor(null);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [isOpen, anchor]);

  if (!isOpen) return null;

  // The left sidebar only exists on desktop, so its toggle is irrelevant on mobile/tablet.
  const isDesktop = window.matchMedia('(min-width: 1025px)').matches;
  // Previews only work on touch devices in large mode, so hide the toggle when
  // a touch user has small cards selected (it would have no effect).
  const isTouch = !window.matchMedia('(hover: hover)').matches;
  const showPreviewSetting = !isTouch || homeCardSize === 'large';
  // The shorts comment bar is rendered only under 768px (see Short.scss), so its
  // toggle would do nothing on desktop/tablet. Gate it on the SAME breakpoint —
  // `isDesktop` (>=1025px) would wrongly still show it on a tablet.
  const showShortsCommentBarSetting = window.matchMedia('(max-width: 768px)').matches;

  return createPortal(
    <div className="settings-modal-overlay" onClick={onClose}>
      <div
        className="settings-modal"
        ref={modalRef}
        onClick={(e) => e.stopPropagation()}
        style={anchor ? {
          position: 'fixed',
          top: anchor.top,
          left: anchor.left,
          // Anchored at a fixed top, a tall tab would otherwise run off the bottom
          // of the screen — cap it to the room actually left below the anchor and
          // let the content scroll inside.
          maxHeight: `calc(100vh - ${Math.round(anchor.top)}px - 16px)`,
        } : undefined}
      >
        <div className="settings-modal-header">
          <h3>Settings</h3>
          <button className="settings-modal-close" onClick={onClose} aria-label="Close">
            <IoClose size={20} />
          </button>
        </div>

        <div className="settings-tabs" role="tablist">
          {visibleTabs.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={`settings-tab${tab === id ? ' active' : ''}`}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'general' && (
          <div className="settings-section">
            <h4 className="settings-section-title">Appearance</h4>
            <Row
              title="Dark mode"
              desc="Use the dark colour theme across the app."
              checked={theme === 'dark'}
              onChange={(wantDark) => { if ((theme === 'dark') !== wantDark) toggleTheme(); }}
            />
            <Row
              title="Large cards"
              desc="Show bigger video cards on the home, profile and playlist pages. Turn off for smaller, more compact cards."
              checked={homeCardSize === 'large'}
              onChange={(large) => setHomeCardSize(large ? 'large' : 'small')}
            />
            {showPreviewSetting && (
              <Row
                title="Video previews"
                desc="Play a muted preview when you hover a video card (and, on mobile in large mode, the centred card auto-plays as you scroll)."
                checked={previewEnabled !== false}
                onChange={(v) => setPreviewEnabled(v)}
              />
            )}
            <Row
              title="Simple feeds"
              desc="Turn off the recommendation algorithm — Discover, Interests and Trending become plain newest-first lists instead of ranked ones."
              checked={!!simpleFeed}
              onChange={(v) => setSimpleFeed(v)}
            />
            {/* The sidebar only exists on desktop, so this is hidden on mobile/tablet. */}
            {isDesktop && (
              <Row
                title="Hide sidebar"
                desc="Collapse the left navigation sidebar for a wider content area."
                checked={!!sidebarHidden}
                onChange={(hide) => setSidebarHidden(hide)}
              />
            )}
          </div>
        )}

        {tab === 'shorts' && (
          <div className="settings-section">
            <h4 className="settings-section-title">Shorts</h4>
            {/* Comment bar is only rendered under 768px, so it's hidden on desktop. */}
            {showShortsCommentBarSetting && (
              <Row
                title="Comment bar on shorts"
                desc="Show a comment input under a short. Off by default — you can always open the comments panel with the comment button."
                checked={!!shortsCommentBar}
                onChange={(v) => setShortsCommentBar(v)}
              />
            )}
            <Row
              title="Open shorts on start"
              desc="Go straight to Shorts when you open 3Speak, instead of the home feed."
              checked={!!openShortsOnStart}
              onChange={(v) => setOpenShortsOnStart(v)}
            />
            <Row
              title="Shorts inside the feeds"
              desc="Show rows of shorts between the videos in the home feeds and the recommendations on a watch page. Turn off to keep those lists videos-only."
              checked={inlineShorts !== false}
              onChange={(v) => setInlineShorts(v)}
            />
          </div>
        )}

        {tab === 'content' && (
          <>
          <div className="settings-section">
            <h4 className="settings-section-title">Content</h4>
            <Row
              title="Show NSFW content"
              desc="Display videos and audio marked not-safe-for-work. Off by default."
              checked={showNsfw}
              onChange={(v) => setShowNsfw(v)}
            />
            <Row
              title="Hide watched videos"
              desc="Leave out videos you've already watched from the home, trending and recommended feeds."
              checked={!!hideWatched}
              onChange={(v) => setHideWatched(v)}
            />
            <Row
              title="Private mode"
              desc="Keep your country out of creators' statistics. We never store your IP address — for anyone. It's turned into a country code the moment you press play and then discarded. With this on, not even that country is recorded for your views."
              checked={!!privateMode}
              onChange={(v) => setPrivateMode(v)}
            />
          </div>
          </>
        )}

        {tab === 'rewards' && (
          <>
            <AdsSection />
            <ViewerRewardsSection />
          </>
        )}

        {tab === 'interests' && <InterestsSection />}
        {tab === 'notifications' && <NotificationsSection />}

        {tab === 'about' && (
          <>
            <div className="settings-section">
              <h4 className="settings-section-title">About</h4>
              <div className="settings-modal-row">
                <div className="settings-row-text">
                  <span className="settings-row-title">App version</span>
                  <span className="settings-row-desc">v{APP_VERSION}</span>
                </div>
              </div>
              <div className="settings-modal-row" onClick={handleButrUnlockTap}>
                <div className="settings-row-text">
                  <span className="settings-row-title">Hive RPC node</span>
                  <span className="settings-row-desc">{getHiveUrl()}</span>
                </div>
              </div>
            </div>

            <div className="settings-section">
              <h4 className="settings-section-title">Your data</h4>
              <DataRequestForm />
            </div>

            <div className="settings-section">
              <div className="settings-modal-row">
                <div className="settings-row-text">
                  <span className="settings-row-title">Your data</span>
                  <span className="settings-row-desc">
                    <a href="/privacy" target="_blank" rel="noopener noreferrer">
                      How 3Speak handles your data
                    </a>
                  </span>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
