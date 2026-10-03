import { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
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
import { getCurrentProvider, Providers } from '../../hive-api/aioha';
import {
  hasThreespeakPostingAuth, addThreespeakToPostingAuth, removeThreespeakFromPostingAuth,
  waitForThreespeakPostingAuth,
} from '../../utils/postingAuthority';
import TagsV2Picker from '../tooltip/TagsV2Picker';
import DataRequestForm from './DataRequestForm';
import LanguagePicker from '../LanguagePicker/LanguagePicker';
import './SettingsModal.scss';

// Every toast from this module is headed "Settings"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Settings');

const sameSet = (a, b) =>
  JSON.stringify([...(a || [])].sort()) === JSON.stringify([...(b || [])].sort());

// Interests picker — canonical copy lives in the user's Hive posting_json_metadata.
// Rendered only while the modal is open, so its hooks mount/unmount with it.
function InterestsSection() {
  const { t } = useTranslation();
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
      toast.success(t('settings.interests.savedToast'));
    } catch (e) {
      toast.error(e?.message || t('settings.interests.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="settings-section">
      <h4 className="settings-section-title">
        {t('settings.interests.title')}{hydrating && <span className="settings-interests-status"> · {t('settings.interests.loading')}</span>}
      </h4>
      <p className="settings-interests-hint">
        {t('settings.interests.hint')}
        {!user && ` ${t('settings.interests.loginHint')}`}
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
            {saving ? t('common.actions.saving') : dirty ? t('settings.interests.save') : t('common.actions.saved')}
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
  const { t } = useTranslation();
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
        setError(t('settings.ads.chainNotSaved'));
      }
      return true;
    } catch (err) {
      setError(err.message || t('settings.ads.saveFailed'));
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function onToggle(next) {
    const previous = adsEnabled;
    setAdsEnabled(next);          // optimistic — a toggle that lags feels broken
    const ok = await save(next, split ? split.communityPct : undefined);
    if (ok) toast.success(next ? t('settings.ads.onToast') : t('settings.ads.offToast'));
    else setAdsEnabled(previous); // put it back; the setting did not change
  }

  const parsedDraft = parseInt(draftCommunity, 10);
  const draftValid = !!split
    && Number.isInteger(parsedDraft) && parsedDraft >= 0 && parsedDraft <= split.poolPct;
  const draftChanged = draftValid && parsedDraft !== split.communityPct;

  async function onSaveShare() {
    if (!draftChanged) return;
    if (await save(adsEnabled, parsedDraft)) toast.success(t('settings.ads.splitSaved'));
  }

  if (!user || !visible) return null;

  return (
    <div className="settings-section">
      <h4 className="settings-section-title">{t('settings.ads.title')}</h4>
      <div className="settings-modal-row">
        <div className="settings-row-text">
          <span className="settings-row-title">{t('settings.ads.allow')}</span>
          <span className="settings-row-desc">
            {t('settings.ads.allowDesc')}
          </span>
        </div>
        <Switch
          checked={adsEnabled}
          onChange={onToggle}
          ariaLabel={t('settings.ads.allowAria')}
        />
      </div>
      {adsEnabled && split && (
        <div className="settings-modal-row settings-ads-split">
          <div className="settings-row-text">
            <span className="settings-row-title">{t('settings.ads.shareTitle')}</span>
            <span className="settings-row-desc">
              {t('settings.ads.shareDesc', { pool: split.poolPct })}
            </span>
            <span className="settings-ads-breakdown">
              {t('settings.ads.youPct', { pct: draftValid ? split.poolPct - parsedDraft : split.creatorPct })}
              <span aria-hidden="true"> · </span>
              {t('settings.ads.communityPct', { pct: draftValid ? parsedDraft : split.communityPct })}
            </span>
          </div>
          <div className="settings-ads-share-control">
            <label className="settings-visually-hidden" htmlFor="settings-community-share">
              {t('settings.ads.shareInputLabel')}
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
                {t('common.actions.save')}
              </button>
            )}
          </div>
        </div>
      )}
      {(loading || saving || error || (split && !draftValid)) && (
        <p className={`settings-ads-status${(error || (split && !draftValid)) ? ' error' : ''}`}>
          {error
            || (split && !draftValid ? t('settings.ads.invalidPct', { max: split.poolPct }) : null)
            || (saving ? t('common.actions.saving') : t('settings.ads.loadingSetting'))}
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
  const { t } = useTranslation();
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
        ? t('settings.viewerRewards.onToast')
        : t('settings.viewerRewards.offToast'));
    } catch (err) {
      setEnabled(previous);
      setError(err.message || t('settings.viewerRewards.saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="settings-modal-section">
      <h3 className="settings-section-title">{t('settings.viewerRewards.title')}</h3>
      <div className="settings-modal-row">
        <div className="settings-row-text">
          <span className="settings-row-title">{t('settings.viewerRewards.rowTitle')}</span>
          <span className="settings-row-desc">
            {t('settings.viewerRewards.desc')}
          </span>
        </div>
        <Switch
          checked={enabled}
          onChange={onToggle}
          ariaLabel={t('settings.viewerRewards.aria')}
        />
      </div>
      {(loading || saving || error) && (
        <p className={`settings-ads-status${error ? ' error' : ''}`}>
          {error || (saving ? t('common.actions.saving') : t('settings.ads.loadingSetting'))}
        </p>
      )}
    </div>
  );
}

/**
 * @threespeak in the user's posting authority. Uploads ask for it (3Speak posts
 * videos on the creator's behalf, and scheduled posts need it), but until now
 * there was nowhere to see whether it is granted or to take it back.
 *
 * Both directions are an account_update2 signed with the ACTIVE key.
 */
function PostingAuthoritySection() {
  const { t } = useTranslation();
  const user = useAppStore((s) => s.user);
  // null = checking, true/false = on chain, 'unavailable' = no Hive account to read
  const [granted, setGranted] = useState(null);
  // false | 'signing' | 'confirming'
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!user) return undefined;
    let alive = true;
    setGranted(null);
    hasThreespeakPostingAuth(user)
      .then((v) => { if (alive) setGranted(v); })
      // An incubating account has no Hive account yet, so there is nothing to show.
      .catch(() => { if (alive) setGranted('unavailable'); });
    return () => { alive = false; };
  }, [user]);

  if (!user || granted === 'unavailable') return null;

  async function change(add) {
    if (busy) return;
    setBusy('signing');
    setError(null);
    // HiveSigner signs in a popup; open it synchronously on the click so it is
    // not blocked, the helper navigates it to the sign URL.
    const signWindow = getCurrentProvider() === Providers.HiveSigner ? window.open('', '_blank') : null;
    try {
      if (add) await addThreespeakToPostingAuth(user, { signWindow });
      else await removeThreespeakFromPostingAuth(user, { signWindow });
    } catch (err) {
      setError(err.message || t('settings.postingAuth.updateFailed'));
      setBusy(false);
      try { signWindow?.close(); } catch { /* ignore */ }
      return;
    }
    try { signWindow?.close(); } catch { /* ignore */ }

    // A signed broadcast is not proof it applied. Wait until the chain shows the
    // change, and let the button follow what the chain says, not what we sent.
    setBusy('confirming');
    const now = await waitForThreespeakPostingAuth(user, add);
    setGranted(now);
    setBusy(false);
    if (now === add) {
      toast.success(add ? t('settings.postingAuth.addedToast') : t('settings.postingAuth.removedToast'));
    } else {
      setError(add
        ? t('settings.postingAuth.notYetAdded')
        : t('settings.postingAuth.stillThere'));
    }
  }

  return (
    <div className="settings-section">
      <h4 className="settings-section-title">{t('settings.postingAuth.title')}</h4>
      <div className="settings-modal-row">
        <div className="settings-row-text">
          <span className="settings-row-title">
            {granted === true ? t('settings.postingAuth.canPost') : granted === false ? t('settings.postingAuth.cannotPost') : t('settings.postingAuth.checkingStatus')}
          </span>
          <span className="settings-row-desc">
            {t('settings.postingAuth.desc')}
          </span>
        </div>
        {granted === true && (
          <button type="button" className="settings-auth-btn" onClick={() => change(false)} disabled={busy}>
            {busy === 'confirming' ? t('settings.postingAuth.checking') : busy ? t('settings.postingAuth.removing') : t('common.actions.remove')}
          </button>
        )}
        {granted === false && (
          <button type="button" className="settings-auth-btn settings-auth-add" onClick={() => change(true)} disabled={busy}>
            {busy === 'confirming' ? t('settings.postingAuth.checking') : busy ? t('settings.postingAuth.adding') : t('common.actions.add')}
          </button>
        )}
      </div>
      {error && <p className="settings-ads-status error">{error}</p>}
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
  videos: { titleKey: 'settings.notifications.kinds.videos.title', descKey: 'settings.notifications.kinds.videos.desc' },
  shorts: { titleKey: 'settings.notifications.kinds.shorts.title', descKey: 'settings.notifications.kinds.shorts.desc' },
  audio: { titleKey: 'settings.notifications.kinds.audio.title', descKey: 'settings.notifications.kinds.audio.desc' },
  replies: { titleKey: 'settings.notifications.kinds.replies.title', descKey: 'settings.notifications.kinds.replies.desc' },
  mentions: { titleKey: 'settings.notifications.kinds.mentions.title', descKey: 'settings.notifications.kinds.mentions.desc' },
  follows: { titleKey: 'settings.notifications.kinds.follows.title', descKey: 'settings.notifications.kinds.follows.desc' },
  votes: { titleKey: 'settings.notifications.kinds.votes.title', descKey: 'settings.notifications.kinds.votes.desc' },
  reblogs: { titleKey: 'settings.notifications.kinds.reblogs.title', descKey: 'settings.notifications.kinds.reblogs.desc' },
};

// The two groups answer different questions: what other people published, and
// what happened to you.
const KIND_GROUPS = [
  { labelKey: 'settings.notifications.groups.creators', kinds: ['videos', 'shorts', 'audio'] },
  { labelKey: 'settings.notifications.groups.aboutYou', kinds: ['replies', 'mentions', 'follows', 'votes', 'reblogs'] },
];

function NotificationsSection() {
  const { t } = useTranslation();
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
        toast.success(t('settings.notifications.deviceOffToast'));
      } else {
        await enablePush(user);
        toast.success(t('settings.notifications.deviceOnToast'));
      }
      setState(await getPushState());
    } catch (err) {
      toast.error(err.message || t('settings.notifications.changeFailed'));
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
      toast.error(err.message || t('settings.notifications.saveFailed'));
    }
  };

  if (!user) {
    return (
      <div className="settings-section">
        <h4 className="settings-section-title">{t('common.nav.notifications')}</h4>
        <p className="settings-note">{t('settings.notifications.loginHint')}</p>
      </div>
    );
  }

  const blocked = state.permission === 'denied';
  const noWorker = state.worker === false;

  return (
    <div className="settings-section">
      <h4 className="settings-section-title">{t('common.nav.notifications')}</h4>

      {!pushSupported() ? (
        <p className="settings-note">{t('settings.notifications.unsupported')}</p>
      ) : (
        <>
          <Row
            title={t('settings.notifications.device')}
            desc={blocked
              ? t('settings.notifications.deviceBlocked')
              : noWorker
                ? t('settings.notifications.deviceNoWorker')
                : t('settings.notifications.deviceDesc')}
            checked={state.subscribed}
            onChange={busy || blocked || noWorker ? () => {} : toggleDevice}
          />

          <p className="settings-note">
            {t('settings.notifications.whatHint')}
          </p>
          {KIND_GROUPS.map(({ labelKey, kinds: group }) => {
            // Only offer what the server actually supports, so an older backend
            // can't leave dead switches on the page.
            const available = group.filter((k) => !kinds.length || kinds.includes(k));
            if (!available.length) return null;
            return (
              <div key={labelKey} className="settings-kind-group">
                <span className="settings-kind-group-label">{t(labelKey)}</span>
                {available.map((k) => (
                  <Row
                    key={k}
                    title={t(KIND_COPY[k].titleKey)}
                    desc={t(KIND_COPY[k].descKey)}
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
  { id: 'general', labelKey: 'settings.tabs.general' },
  // Shorts and Interests are sub-tabs of this one now. Seven top-level tabs
  // overflowed the row even on desktop, and the three of them were all answering
  // "what shows up in my feeds" from separate pages.
  { id: 'content', labelKey: 'settings.tabs.content' },
  // Hive accounts only: every setting behind it is about notifications that come
  // from the chain, so for anyone else it was a page of switches that could not
  // do anything.
  { id: 'notifications', labelKey: 'common.nav.notifications' },
  // Its own page rather than a tail on Content. Both halves are about money moving
  // between advertisers, creators and viewers, and they were the two longest things on
  // a page otherwise made of one-line switches. Only shown to those who have it.
  { id: 'rewards', labelKey: 'settings.tabs.rewards' },
  { id: 'about', labelKey: 'settings.tabs.about' },
];

// The three panels behind Content. Kept as data so the sub-tab bar and the
// panels below cannot fall out of step.
const CONTENT_TABS = [
  { id: 'feed', labelKey: 'settings.contentTabs.feed' },
  { id: 'shorts', labelKey: 'common.nav.shorts' },
  { id: 'interests', labelKey: 'settings.interests.title' },
];

/**
 * Settings popup — the toggles that used to live inline in the profile
 * side menu, now grouped with headers + explanations and compact switches.
 */
export default function SettingsModal({ isOpen, onClose }) {
  const { t } = useTranslation();
  const { theme, showNsfw, setShowNsfw, toggleTheme, homeCardSize, setHomeCardSize, previewEnabled, setPreviewEnabled, shortsCommentBar, setShortsCommentBar, openShortsOnStart, setOpenShortsOnStart, inlineShorts, setInlineShorts, hideWatched, setHideWatched, hideAi, setHideAi, privateMode, setPrivateMode, simpleFeed, setSimpleFeed } = useAppStore();
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
  // Notifications are read from the chain against a Hive account. Someone signed
  // in without one -- incubating, or a wallet-less session -- had a tab of
  // switches that could not take effect.
  const notificationsVisible = !!settingsUser;
  const visibleTabs = useMemo(
    () => TABS.filter((tb) => {
      if (tb.id === 'rewards') return rewardsVisible;
      if (tb.id === 'notifications') return notificationsVisible;
      return true;
    }),
    [rewardsVisible, notificationsVisible],
  );
  const [tab, setTab] = useState('general');
  const [contentTab, setContentTab] = useState('feed');
  // Losing the group (or logging out) while standing on that page would leave the modal
  // with no tab selected and nothing rendered.
  useEffect(() => {
    if (tab === 'rewards' && !rewardsVisible) setTab('general');
    if (tab === 'notifications' && !notificationsVisible) setTab('general');
  }, [tab, rewardsVisible, notificationsVisible]);

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
      toast.success(t('settings.butrauthUnlocked'));
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
          <h3>{t('common.nav.settings')}</h3>
          <button className="settings-modal-close" onClick={onClose} aria-label={t('common.actions.close')}>
            <IoClose size={20} />
          </button>
        </div>

        <div className="settings-tabs" role="tablist">
          {visibleTabs.map(({ id, labelKey }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={`settings-tab${tab === id ? ' active' : ''}`}
              onClick={() => setTab(id)}
            >
              {t(labelKey)}
            </button>
          ))}
        </div>

        {tab === 'general' && (
          <div className="settings-section">
            <LanguagePicker onNavigate={onClose} />
          </div>
        )}
        {tab === 'general' && (
          <div className="settings-section">
            <h4 className="settings-section-title">{t('settings.appearance.title')}</h4>
            <Row
              title={t('settings.appearance.darkMode.title')}
              desc={t('settings.appearance.darkMode.desc')}
              checked={theme === 'dark'}
              onChange={(wantDark) => { if ((theme === 'dark') !== wantDark) toggleTheme(); }}
            />
            <Row
              title={t('settings.appearance.largeCards.title')}
              desc={t('settings.appearance.largeCards.desc')}
              checked={homeCardSize === 'large'}
              onChange={(large) => setHomeCardSize(large ? 'large' : 'small')}
            />
            {showPreviewSetting && (
              <Row
                title={t('settings.appearance.previews.title')}
                desc={t('settings.appearance.previews.desc')}
                checked={previewEnabled !== false}
                onChange={(v) => setPreviewEnabled(v)}
              />
            )}
            <Row
              title={t('settings.appearance.simpleFeeds.title')}
              desc={t('settings.appearance.simpleFeeds.desc')}
              checked={!!simpleFeed}
              onChange={(v) => setSimpleFeed(v)}
            />
          </div>
        )}
        {tab === 'general' && <PostingAuthoritySection />}

        {tab === 'content' && (
          <div className="settings-subtabs" role="tablist" aria-label={t('settings.contentTabs.aria')}>
            {CONTENT_TABS.map((ct) => (
              <button
                key={ct.id}
                type="button"
                role="tab"
                aria-selected={contentTab === ct.id}
                className={`settings-subtab${contentTab === ct.id ? ' is-active' : ''}`}
                onClick={() => setContentTab(ct.id)}
              >
                {t(ct.labelKey)}
              </button>
            ))}
          </div>
        )}

        {tab === 'content' && contentTab === 'shorts' && (
          <div className="settings-section">
            <h4 className="settings-section-title">{t('common.nav.shorts')}</h4>
            {/* Comment bar is only rendered under 768px, so it's hidden on desktop. */}
            {showShortsCommentBarSetting && (
              <Row
                title={t('settings.shorts.commentBar.title')}
                desc={t('settings.shorts.commentBar.desc')}
                checked={!!shortsCommentBar}
                onChange={(v) => setShortsCommentBar(v)}
              />
            )}
            <Row
              title={t('settings.shorts.openOnStart.title')}
              desc={t('settings.shorts.openOnStart.desc')}
              checked={!!openShortsOnStart}
              onChange={(v) => setOpenShortsOnStart(v)}
            />
            <Row
              title={t('settings.shorts.inFeeds.title')}
              desc={t('settings.shorts.inFeeds.desc')}
              checked={inlineShorts !== false}
              onChange={(v) => setInlineShorts(v)}
            />
          </div>
        )}

        {tab === 'content' && contentTab === 'feed' && (
          <>
          <div className="settings-section">
            <h4 className="settings-section-title">{t('settings.contentTabs.feed')}</h4>
            <Row
              title={t('settings.feed.nsfw.title')}
              desc={t('settings.feed.nsfw.desc')}
              checked={showNsfw}
              onChange={(v) => setShowNsfw(v)}
            />
            <Row
              title={t('settings.feed.hideWatched.title')}
              desc={t('settings.feed.hideWatched.desc')}
              checked={!!hideWatched}
              onChange={(v) => setHideWatched(v)}
            />
            <Row
              title={t('settings.feed.hideAi.title')}
              desc={t('settings.feed.hideAi.desc')}
              checked={!!hideAi}
              onChange={(v) => setHideAi(v)}
            />
            <Row
              title={t('settings.feed.privateMode.title')}
              desc={t('settings.feed.privateMode.desc')}
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

        {tab === 'content' && contentTab === 'interests' && <InterestsSection />}
        {tab === 'notifications' && <NotificationsSection />}

        {tab === 'about' && (
          <>
            <div className="settings-section">
              <h4 className="settings-section-title">{t('settings.about.title')}</h4>
              <div className="settings-modal-row">
                <div className="settings-row-text">
                  <span className="settings-row-title">{t('settings.about.version')}</span>
                  <span className="settings-row-desc">v{APP_VERSION}</span>
                </div>
              </div>
              <div className="settings-modal-row" onClick={handleButrUnlockTap}>
                <div className="settings-row-text">
                  <span className="settings-row-title">{t('settings.about.rpcNode')}</span>
                  <span className="settings-row-desc">{getHiveUrl()}</span>
                </div>
              </div>
            </div>

            <div className="settings-section">
              <h4 className="settings-section-title">{t('settings.about.yourData')}</h4>
              <DataRequestForm />
            </div>

            <div className="settings-section">
              <div className="settings-modal-row">
                <div className="settings-row-text">
                  <span className="settings-row-title">{t('settings.about.yourData')}</span>
                  <span className="settings-row-desc">
                    <a href="/privacy" target="_blank" rel="noopener noreferrer">
                      {t('settings.about.privacyLink')}
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
