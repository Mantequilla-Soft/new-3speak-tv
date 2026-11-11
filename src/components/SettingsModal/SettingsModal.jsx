import { useState, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { toastIn } from '../../utils/toast';
import { useAppStore } from '../../lib/store';
import { APP_VERSION } from '../../version';
import { getHiveUrl } from '../../utils/hiveNode';
import { fetchUserInterests, saveInterestsToHive } from '../../utils/interests';
import { fetchAdAccess, fetchCreatorAdPrefs, fetchViewerAdPrefs, setViewerAdPrefs, setListenerAdPrefs } from '../../lib/advertiseData';
import { resetViewerRewards } from '../../utils/viewerRewards';
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
import { LIGHTNING_ADDRESS_RE, checkLightningAddress, readOwnLightningAddress, saveOwnLightningAddress } from '../../lib/lightningTip';
import TagsV2Picker from '../tooltip/TagsV2Picker';
import DataRequestForm from './DataRequestForm';
import LanguagePicker from '../LanguagePicker/LanguagePicker';
import useDialog from '../../hooks/useDialog';
import AddSocialLink_modal from '../modal/AddSocialLink_modal';
import AccountImg from '../HiveAvatar/AccountImg';
import { parseSupportLink, readSupportLinks, saveSupportLinks, SUPPORT_LINK_MAX, SUPPORT_SITE_NAMES } from '../../lib/supportLinks';
import { Banner, Button, Icon, IconButton, Segmented, SettingRow, Toggle } from '../v2/ui';
import { cx } from '../v2/helpers';
import './SettingsModal.scss';
import useCardSize, { useIsCardSizeMobile } from '../../hooks/useCardSize';

// Every toast from this module is headed "Settings"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Settings');

const sameSet = (a, b) =>
  JSON.stringify([...(a || [])].sort()) === JSON.stringify([...(b || [])].sort());

// One card of settings (38a-c): a 4px bar in the section's tone and its title,
// then the rows. On/off rows are SettingRow + Toggle, divided by 1px lines
// (STYLE_GUIDE §11). `aside` sits at the right of the title.
function Section({ title, tone = 'accent', aside, children, className }) {
  return (
    <section className={cx('settings-section', className)}>
      {(title || aside) && (
        <div className="settings-section-head">
          {title && <h3 className={cx('settings-section-title', tone === 'cyan' && 'is-cyan')}>{title}</h3>}
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}

// A switch row: the title doubles as the switch's accessible name.
function Row({ title, desc, checked, onChange, disabled, icon }) {
  return (
    <SettingRow
      title={title}
      sub={desc}
      icon={icon}
      control={<Toggle checked={!!checked} onChange={onChange} label={title} disabled={disabled} />}
    />
  );
}

// Loading / saving, or why a save failed (accent banner).
function Status({ error, children }) {
  if (error) return <Banner tone="warn" icon="error">{error}</Banner>;
  if (!children) return null;
  return <p className="settings-status">{children}</p>;
}

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
    <Section
      tone="cyan"
      title={<>{t('settings.interests.title')}{hydrating && <span className="settings-title-status"> · {t('settings.interests.loading')}</span>}</>}
    >
      <p className="settings-note">
        {t('settings.interests.hint')}
        {!user && ` ${t('settings.interests.loginHint')}`}
      </p>
      <div className="settings-interests-picker">
        <TagsV2Picker
          multi
          searchable
          value={interests || []}
          onChange={(next) => { setJustSaved(false); setInterests(next); }}
          disabled={!user || saving}
        />
      </div>
      {/* Only shown when there's something to save, while saving, or right after
          a save (the transient "Saved" confirmation). Hidden otherwise. */}
      {user && (dirty || saving || justSaved) && (
        <Button
          variant="cyan"
          size={44}
          block
          className="settings-interests-save"
          onClick={save}
          disabled={!dirty || saving}
          loading={saving}
          trailing={!dirty && !saving ? 'check' : null}
        >
          {saving ? t('common.actions.saving') : dirty ? t('settings.interests.save') : t('common.actions.saved')}
        </Button>
      )}
    </Section>
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
  // Video rolls on top of banners and tickers. Off = overlays only.
  const [rollsEnabled, setRollsEnabled] = useState(true);
  // Spoken spots in the creator's audio. The uploader can override it per track.
  const [audioEnabled, setAudioEnabled] = useState(true);
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
        setRollsEnabled(r.rollsEnabled !== false);
        setAudioEnabled(r.audioEnabled !== false);
        if (r.split) { setSplit(r.split); setDraftCommunity(String(r.split.communityPct)); }
      })
      .catch(() => { /* unreadable preference just shows the default */ })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [user, visible]);

  // Both fields ride one signed message, so saving either costs a single prompt.
  // `nextAudio` only from the audio switch: any other save leaves the stored audio
  // choice alone (turning ads back on must not write the "off" it showed meanwhile).
  async function save(nextEnabled, nextCommunity, nextRolls = rollsEnabled, nextAudio = null) {
    if (saving) return false;
    setSaving(true);
    setError(null);
    try {
      // Writes both copies: the checker row the ad server reads, and the creator's
      // own posting_json_metadata. The chain half is best effort, so a rejected
      // wallet prompt does not undo a setting that has already taken effect here.
      const res = await saveCreatorAdSettings(user, {
        adsEnabled: nextEnabled,
        rollsEnabled: nextRolls,
        audioEnabled: typeof nextAudio === 'boolean' ? nextAudio : undefined,
        communitySharePct: nextCommunity,
      });
      if (typeof res.audioEnabled === 'boolean') setAudioEnabled(res.audioEnabled);
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

  async function onToggleRolls(next) {
    const previous = rollsEnabled;
    setRollsEnabled(next);
    const ok = await save(adsEnabled, split ? split.communityPct : undefined, next);
    if (ok) toast.success(next ? t('settings.ads.rollsOnToast') : t('settings.ads.rollsOffToast'));
    else setRollsEnabled(previous);
  }

  async function onToggleAudio(next) {
    const previous = audioEnabled;
    setAudioEnabled(next);
    const ok = await save(adsEnabled, split ? split.communityPct : undefined, rollsEnabled, next);
    if (ok) toast.success(next ? t('settings.ads.audioOnToast') : t('settings.ads.audioOffToast'));
    else setAudioEnabled(previous);
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

  const youPct = draftValid ? split.poolPct - parsedDraft : split?.creatorPct;
  const communityPct = draftValid ? parsedDraft : split?.communityPct;
  const youShare = split && split.poolPct > 0 ? Math.max(0, Math.min(100, (youPct / split.poolPct) * 100)) : 100;
  const statusError = error || (split && !draftValid ? t('settings.ads.invalidPct', { max: split.poolPct }) : null);

  return (
    <Section title={t('settings.ads.title')}>
      <SettingRow
        title={t('settings.ads.allow')}
        sub={t('settings.ads.allowDesc')}
        control={<Toggle checked={adsEnabled} onChange={onToggle} label={t('settings.ads.allowAria')} />}
      />
      {adsEnabled && (
        <Row title={t('settings.ads.rolls')} desc={t('settings.ads.rollsDesc')} checked={rollsEnabled} onChange={onToggleRolls} />
      )}
      {adsEnabled && (
        <Row title={t('settings.ads.audio')} desc={t('settings.ads.audioDesc')} checked={audioEnabled} onChange={onToggleAudio} />
      )}
      {adsEnabled && split && (
        <div className="settings-split v2-well">
          <div className="settings-split-head">
            <div className="settings-split-text">
              <b>{t('settings.ads.shareTitle')}</b>
              <span>{t('settings.ads.shareDesc', { pool: split.poolPct })}</span>
            </div>
            <div className="settings-split-control">
              <label className="settings-visually-hidden" htmlFor="settings-community-share">
                {t('settings.ads.shareInputLabel')}
              </label>
              <div className={cx('settings-split-input', !draftValid && 'is-error')}>
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
                <Button variant="primary" size={36} onClick={onSaveShare} disabled={saving}>
                  {t('common.actions.save')}
                </Button>
              )}
            </div>
          </div>
          {/* You (accent) and the community (cyan), as parts of the pool */}
          <div className="settings-split-bar" aria-hidden="true"><span style={{ width: `${youShare}%` }} /></div>
          <div className="settings-split-legend">
            <span className="is-you">{t('settings.ads.youPct', { pct: youPct })}</span>
            <span className="is-community">{t('settings.ads.communityPct', { pct: communityPct })}</span>
          </div>
        </div>
      )}
      {(loading || saving || statusError) && (
        <Status error={statusError}>
          {saving ? t('common.actions.saving') : t('settings.ads.loadingSetting')}
        </Status>
      )}
    </Section>
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
  // Listening is its own consent record (POST /advertise/listener/prefs). The one
  // switch sets both; someone who only agreed to watching gets a button for it.
  const [listen, setListen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const visible = adsEnabledFor(user);

  useEffect(() => {
    if (!user || !visible) return undefined;
    let alive = true;
    setLoading(true);
    fetchViewerAdPrefs(user)
      .then((r) => { if (alive) { setEnabled(r.rewardsEnabled === true); setListen(r.listenEnabled === true); } })
      .catch(() => { /* an unreadable setting is not worth an error banner */ })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [user, visible]);

  if (!user || !visible) return null;

  async function save(fn, rollback) {
    setSaving(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      rollback();
      setError(err.message || t('settings.viewerRewards.saveFailed'));
    } finally {
      // The next watch or listen session reads the new answer, not a cached one.
      resetViewerRewards();
      setSaving(false);
    }
  }

  // Optimistic, then rolled back on failure. Every save costs a signature, so the
  // switch must not sit unresponsive while a wallet prompt is open.
  function onToggle(next) {
    const before = { enabled, listen };
    setEnabled(next);
    setListen(next);
    return save(async () => {
      await setViewerAdPrefs(user, { rewardsEnabled: next });
      await setListenerAdPrefs(user, { listenEnabled: next });
      toast.success(next ? t('settings.viewerRewards.onToastBoth') : t('settings.viewerRewards.offToastBoth'));
    }, () => { setEnabled(before.enabled); setListen(before.listen); });
  }

  function addListening() {
    setListen(true);
    return save(async () => {
      await setListenerAdPrefs(user, { listenEnabled: true });
      toast.success(t('settings.viewerRewards.listenOnToast'));
    }, () => setListen(false));
  }

  return (
    <Section tone="cyan" title={t('settings.viewerRewards.titleListen')}>
      <SettingRow
        title={t('settings.viewerRewards.rowTitle')}
        sub={t('settings.viewerRewards.desc')}
        control={<Toggle checked={enabled} onChange={onToggle} label={t('settings.viewerRewards.aria')} />}
      />
      <div className="settings-well-row v2-well">
        <span className={cx('settings-well-icon', listen && 'is-cyan')}><Icon name="headphones" size={20} /></span>
        <div className="settings-well-body"><span>{t('settings.viewerRewards.listenDesc')}</span></div>
      </div>
      {enabled && !listen && !loading && (
        <Button variant="secondary" size={44} block icon="headphones" onClick={addListening} disabled={saving}>
          {t('settings.viewerRewards.listenAlso')}
        </Button>
      )}
      {(loading || saving || error) && (
        <Status error={error}>{saving ? t('common.actions.saving') : t('settings.ads.loadingSetting')}</Status>
      )}
    </Section>
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
    <Section tone="cyan" title={t('settings.postingAuth.title')}>
      <div className="settings-well-row v2-well">
        <span className={cx('settings-well-icon', granted === true && 'is-cyan')}><Icon name="verified_user" size={20} /></span>
        <div className="settings-well-body">
          <b>
            {granted === true ? t('settings.postingAuth.canPost') : granted === false ? t('settings.postingAuth.cannotPost') : t('settings.postingAuth.checkingStatus')}
          </b>
        </div>
        {granted === true && (
          <Button variant="secondary" size={36} onClick={() => change(false)} disabled={!!busy} loading={!!busy}>
            {busy === 'confirming' ? t('settings.postingAuth.checking') : busy ? t('settings.postingAuth.removing') : t('common.actions.remove')}
          </Button>
        )}
        {granted === false && (
          <Button variant="primary" size={36} onClick={() => change(true)} disabled={!!busy} loading={!!busy}>
            {busy === 'confirming' ? t('settings.postingAuth.checking') : busy ? t('settings.postingAuth.adding') : t('common.actions.add')}
          </Button>
        )}
      </div>
      <p className="settings-note">{t('settings.postingAuth.desc')}</p>
      {error && <Status error={error} />}
    </Section>
  );
}

/**
 * Where sats tipped over Lightning go. Default: the creator's v4v.app address,
 * which pays out on Hive. Or a Lightning address of their own, kept in their
 * posting_json_metadata (`3speak.lightning.address`), so any app can read it and
 * our API sends tippers' invoices there (server/lightning-tip.cjs).
 */
function LightningReceiveSection() {
  const { t } = useTranslation();
  const user = useAppStore((s) => s.user);
  // null = loading, '' = v4v.app, else the saved address; 'unavailable' = no Hive account
  const [saved, setSaved] = useState(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!user) return undefined;
    let alive = true;
    setSaved(null);
    readOwnLightningAddress(user)
      .then((a) => { if (alive) { setSaved(a); setDraft(a); } })
      .catch(() => { if (alive) setSaved('unavailable'); });
    return () => { alive = false; };
  }, [user]);

  if (!user || saved === 'unavailable') return null;

  const next = draft.trim().toLowerCase();
  const changed = saved !== null && next !== saved;

  async function save(address) {
    if (busy) return;
    setError(null);
    if (address && !LIGHTNING_ADDRESS_RE.test(address)) {
      setError(t('settings.lightning.badAddress'));
      return;
    }
    setBusy(true);
    try {
      if (address) {
        try { await checkLightningAddress(address); } catch {
          setError(t('settings.lightning.unreachable'));
          return;
        }
      }
      await saveOwnLightningAddress(user, address);
      setSaved(address);
      setDraft(address);
      toast.success(address ? t('settings.lightning.savedOwn') : t('settings.lightning.savedV4v'));
    } catch (err) {
      setError(t('settings.lightning.saveFailed'));
      console.warn('[settings] lightning address not saved:', err?.message || err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title={t('settings.lightning.title')}>
      <div className={cx('settings-well-row v2-well settings-ln-now', saved && 'is-own')}>
        <span className="settings-well-icon is-accent"><Icon name="bolt" size={20} /></span>
        <div className="settings-well-body">
          <b className="settings-ln-where">
            {saved === null ? t('settings.lightning.checking')
              : saved ? t('settings.lightning.toOwn', { address: saved })
              : t('settings.lightning.toV4v', { account: user })}
          </b>
          <span>{saved ? t('settings.lightning.ownDesc') : t('settings.lightning.v4vDesc')}</span>
        </div>
      </div>
      <form
        className="settings-inline-form"
        onSubmit={(e) => { e.preventDefault(); if (changed) save(next); }}
      >
        <label className="v2-eyebrow" htmlFor="settings-ln-address">{t('settings.lightning.inputLabel')}</label>
        <div className="settings-inline-form-row">
          <input
            id="settings-ln-address"
            className={cx('v2-input settings-mono-input', error && 'is-error')}
            type="text"
            inputMode="email"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            aria-label={t('settings.lightning.inputLabel')}
            aria-invalid={!!error}
            placeholder={t('settings.lightning.placeholder')}
            value={draft}
            onChange={(e) => { setDraft(e.target.value); setError(null); }}
            disabled={busy || saved === null}
          />
          <Button type="submit" variant="primary" size={40} disabled={busy || !changed} loading={busy}>
            {busy ? t('common.actions.saving') : t('common.actions.save')}
          </Button>
        </div>
      </form>
      {error && <Status error={error} />}
      {saved && (
        <Button variant="secondary" size={44} block trailing="swap_horiz" className="is-next" onClick={() => save('')} disabled={busy}>
          {t('settings.lightning.useV4v')}
        </Button>
      )}
      <p className="settings-note">{t('settings.lightning.publicNote')} {t('settings.lightning.supportersNote')}</p>
    </Section>
  );
}

// What a referral earns. Mirrors the checker's payout settings
// (AD_EARNER_REFERRAL_PCT / _DAYS and AD_REFERRAL_POOL_PCT in 3speakchecks);
// change them together.
const REFERRAL_BONUS_PCT = 10;
const REFERRAL_BONUS_MONTHS = 3;
const ADVERTISER_REFERRAL_PCT = 2;

/**
 * The user's own `?ref=` link (utils/referral.js) with a copy button, and what a
 * referral earns. Only link and invite referrals are paid (the signup screens no
 * longer ask "who referred you?"), so this link is the way to be credited.
 */
function ReferralSection() {
  const { t } = useTranslation();
  const user = useAppStore((s) => s.user);
  if (!user) return null;
  const link = `${window.location.origin}/?ref=${encodeURIComponent(user)}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      toast.success(t('settings.referrals.copied'));
    } catch {
      toast.error(t('settings.referrals.copyFailed'));
    }
  }

  return (
    <Section title={t('settings.referrals.title')}>
      <p className="settings-note">{t('settings.referrals.intro')}</p>
      <div className="settings-inline-form">
        <label className="v2-eyebrow" htmlFor="settings-referral-link">{t('settings.referrals.linkLabel')}</label>
        <div className="settings-copy-well v2-well">
          <input
            id="settings-referral-link"
            type="text"
            readOnly
            value={link}
            aria-label={t('settings.referrals.linkLabel')}
            onFocus={(e) => e.target.select()}
          />
          <Button variant="primary" size={36} icon="content_copy" onClick={copy}>
            {t('settings.referrals.copy')}
          </Button>
        </div>
        <span className="settings-hint">{t('settings.referrals.shareTip')}</span>
      </div>
      <div className="v2-eyebrow settings-earn-title">{t('settings.referrals.earnTitle')}</div>
      <ul className="settings-referral-tiles">
        {[
          { icon: 'redeem', tone: 'accent', value: t('settings.referrals.bonusValue', { pct: REFERRAL_BONUS_PCT }), label: t('settings.referrals.bonusLabel'), desc: t('settings.referrals.bonusDesc') },
          { icon: 'calendar_month', tone: 'cyan', value: t('settings.referrals.timeValue', { months: REFERRAL_BONUS_MONTHS }), label: t('settings.referrals.timeLabel') },
          { icon: 'campaign', tone: 'accent', value: t('settings.referrals.adsValue', { pct: ADVERTISER_REFERRAL_PCT }), label: t('settings.referrals.adsLabel'), desc: t('settings.referrals.adsDesc') },
        ].map(({ icon, tone, value, label, desc }) => (
          <li key={value + label} className={cx('settings-referral-tile', `is-${tone}`)}>
            <Icon name={icon} size={18} className="settings-referral-tile-icon" />
            <b className="settings-referral-tile-value">{value}</b>
            <span className="settings-referral-tile-label">{label}</span>
            {desc && <span className="settings-referral-tile-desc">{desc}</span>}
          </li>
        ))}
      </ul>
      <p className="settings-referral-ontop">
        <Icon name="check_circle" size={18} />
        <span>{t('settings.referrals.earnOnTop')}</span>
      </p>
      <p className="settings-note">{t('settings.referrals.rules')}</p>
    </Section>
  );
}

/**
 * "Other ways to support you": the creator's pages on payment sites, shown in
 * their tip window (lib/supportLinks.js). Every add or remove is saved to the
 * Hive account right away.
 */
function SupportLinksSection() {
  const { t } = useTranslation();
  const user = useAppStore((s) => s.user);
  // null = loading; 'unavailable' = no Hive account
  const [links, setLinks] = useState(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!user) return undefined;
    let alive = true;
    setLinks(null);
    readSupportLinks(user)
      .then((l) => { if (alive) setLinks(l); })
      .catch(() => { if (alive) setLinks('unavailable'); });
    return () => { alive = false; };
  }, [user]);

  if (!user || links === 'unavailable') return null;

  async function save(nextLinks) {
    setBusy(true);
    setError(null);
    try {
      await saveSupportLinks(user, nextLinks.map((l) => l.url));
      setLinks(nextLinks);
      toast.success(t('settings.supportLinks.saved'));
      return true;
    } catch (err) {
      setError(t('settings.lightning.saveFailed'));
      console.warn('[settings] support links not saved:', err?.message || err);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    if (busy || !Array.isArray(links)) return;
    const parsed = parseSupportLink(draft);
    if (!parsed) { setError(t('settings.supportLinks.badLink')); return; }
    if (links.some((l) => l.url === parsed.url)) { setError(t('settings.supportLinks.duplicate')); return; }
    if (links.length >= SUPPORT_LINK_MAX) { setError(t('settings.supportLinks.max', { max: SUPPORT_LINK_MAX })); return; }
    if (await save([...links, parsed])) setDraft('');
  }

  const loading = links === null;
  return (
    <Section tone="cyan" title={t('settings.supportLinks.title')}>
      <p className="settings-note">
        {t('settings.supportLinks.desc', { sites: SUPPORT_SITE_NAMES.join(', ') })}
      </p>
      {Array.isArray(links) && links.length > 0 && (
        <ul className="settings-support-links">
          {links.map((l) => (
            <li key={l.url} className="v2-well">
              <Icon name={SUPPORT_SITE_ICON[l.site.id] || 'link'} size={20} className="settings-support-icon" />
              <span className="settings-support-text">
                <b>{l.site.label}</b>
                <a href={l.url} target="_blank" rel="noopener noreferrer">{l.url.replace(/^https:\/\//, '')}</a>
              </span>
              <IconButton
                icon="close"
                size={32}
                variant="ghost"
                round
                onClick={() => save(links.filter((x) => x.url !== l.url))}
                disabled={busy}
                label={t('settings.supportLinks.remove', { site: l.site.label })}
              />
            </li>
          ))}
        </ul>
      )}
      {(loading || links.length < SUPPORT_LINK_MAX) && (
        <form className="settings-inline-form" onSubmit={(e) => { e.preventDefault(); add(); }}>
          <div className="settings-inline-form-row">
            <input
              className={cx('v2-input', error && 'is-error')}
              type="text"
              inputMode="url"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              aria-label={t('settings.supportLinks.title')}
              aria-invalid={!!error}
              placeholder={t('settings.supportLinks.placeholder')}
              value={draft}
              onChange={(e) => { setDraft(e.target.value); setError(null); }}
              disabled={busy || loading}
            />
            <Button type="submit" variant="secondary" size={40} icon="add" disabled={busy || loading || !draft.trim()}>
              {busy ? t('common.actions.saving') : t('settings.supportLinks.add')}
            </Button>
          </div>
        </form>
      )}
      {error && <Status error={error} />}
      <p className="settings-note">{t('settings.supportLinks.publicNote')}</p>
    </Section>
  );
}

// Material Symbols for the payment sites (lib/supportLinks.js); `link` otherwise.
const SUPPORT_SITE_ICON = {
  kofi: 'local_cafe',
  buymeacoffee: 'coffee',
  patreon: 'favorite',
  paypal: 'payments',
  github: 'code',
  liberapay: 'volunteer_activism',
  opencollective: 'groups',
};

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
  podcasts: { titleKey: 'settings.notifications.kinds.podcasts.title', descKey: 'settings.notifications.kinds.podcasts.desc' },
  replies: { titleKey: 'settings.notifications.kinds.replies.title', descKey: 'settings.notifications.kinds.replies.desc' },
  mentions: { titleKey: 'settings.notifications.kinds.mentions.title', descKey: 'settings.notifications.kinds.mentions.desc' },
  follows: { titleKey: 'settings.notifications.kinds.follows.title', descKey: 'settings.notifications.kinds.follows.desc' },
  votes: { titleKey: 'settings.notifications.kinds.votes.title', descKey: 'settings.notifications.kinds.votes.desc' },
  reblogs: { titleKey: 'settings.notifications.kinds.reblogs.title', descKey: 'settings.notifications.kinds.reblogs.desc' },
};

// The two groups answer different questions: what other people published, and
// what happened to you.
const KIND_GROUPS = [
  { labelKey: 'settings.notifications.groups.creators', kinds: ['videos', 'shorts', 'audio', 'podcasts'] },
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
      toast.error(err?.code === 'not_confirmed'
        ? t('settings.notifications.notConfirmed')
        : err.message || t('settings.notifications.saveFailed'));
    }
  };

  if (!user) {
    return (
      <Section tone="cyan" title={t('common.nav.notifications')}>
        <p className="settings-note">{t('settings.notifications.loginHint')}</p>
      </Section>
    );
  }

  const blocked = state.permission === 'denied';
  const noWorker = state.worker === false;

  return (
    <Section tone="cyan" title={t('common.nav.notifications')}>
      {!pushSupported() ? (
        <Banner tone="info" icon="notifications_off">{t('settings.notifications.unsupported')}</Banner>
      ) : (
        <>
          <div className="settings-well-row v2-well">
            <span className={cx('settings-well-icon', state.subscribed && 'is-cyan')}><Icon name="devices" size={20} /></span>
            <div className="settings-well-body">
              <b>{t('settings.notifications.device')}</b>
              <span>
                {blocked
                  ? t('settings.notifications.deviceBlocked')
                  : noWorker
                    ? t('settings.notifications.deviceNoWorker')
                    : t('settings.notifications.deviceDesc')}
              </span>
            </div>
            <Toggle
              checked={state.subscribed}
              onChange={busy || blocked || noWorker ? () => {} : toggleDevice}
              label={t('settings.notifications.device')}
              disabled={blocked || noWorker}
            />
          </div>

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
                <div className="v2-eyebrow settings-kind-group-label">{t(labelKey)}</div>
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
    </Section>
  );
}

const TABS = [
  { id: 'general', labelKey: 'settings.tabs.general', icon: 'tune', tone: 'accent' },
  // Shorts and Interests are sub-tabs of this one now. Seven top-level tabs
  // overflowed the row even on desktop, and the three of them were all answering
  // "what shows up in my feeds" from separate pages.
  { id: 'content', labelKey: 'settings.tabs.content', icon: 'play_circle', tone: 'accent' },
  // What the Hive account is tied to outside 3Speak: the Lightning address tips
  // go to, and verified channels on other platforms. Hive accounts only.
  { id: 'connections', labelKey: 'settings.tabs.connections', icon: 'link', tone: 'cyan' },
  // Hive accounts only: every setting behind it is about notifications that come
  // from the chain, so for anyone else it was a page of switches that could not
  // do anything.
  { id: 'notifications', labelKey: 'common.nav.notifications', icon: 'notifications', tone: 'cyan' },
  // Its own page rather than a tail on Content. Both halves are about money moving
  // between advertisers, creators and viewers, and they were the two longest things on
  // a page otherwise made of one-line switches. Only shown to those who have it.
  { id: 'rewards', labelKey: 'settings.tabs.rewards', icon: 'account_balance_wallet', tone: 'accent' },
  { id: 'about', labelKey: 'settings.tabs.about', icon: 'info', tone: 'muted' },
];

// The panels behind Connections: their referral link (first, and what the tab
// opens on), where money reaches the creator, and their verified channels.
const CONNECTIONS_TABS = [
  { id: 'referrals', labelKey: 'settings.connectionsTabs.referrals' },
  { id: 'support', labelKey: 'settings.connectionsTabs.support' },
  { id: 'profiles', labelKey: 'settings.connectionsTabs.profiles' },
];

// The three panels behind Content. Kept as data so the sub-tab bar and the
// panels below cannot fall out of step.
const CONTENT_TABS = [
  { id: 'feed', labelKey: 'settings.contentTabs.feed' },
  { id: 'shorts', labelKey: 'common.nav.shorts' },
  { id: 'interests', labelKey: 'settings.interests.title' },
];

// Phones get the sheet with the sections as tiles (18d); a tile opens its
// section, the back arrow returns to the tiles.
const PHONE_QUERY = '(max-width: 767px)';
const subscribePhone = (cb) => {
  const mq = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(PHONE_QUERY) : null;
  mq?.addEventListener?.('change', cb);
  return () => mq?.removeEventListener?.('change', cb);
};
const readPhone = () => (typeof window !== 'undefined' && !!window.matchMedia?.(PHONE_QUERY)?.matches);

/**
 * Settings: the toggles that used to live inline in the profile side menu,
 * grouped into cards (38a-c). Tabs are a segmented track on desktop; on a phone
 * the sheet opens on the sections as tiles.
 */
// `dropdown` ({ rect, held }): the hover peek from the top bar's gear (Nav.jsx,
// hooks/useHoverPeek.js). Hung under `rect` instead of centred, no backdrop, and
// the page stays usable while it's only a peek, and there's no X (it closes when
// the mouse leaves). `held` (typing in it, `typingProps` from useHoverPeek, or a
// click on the gear) adds the X and a see-through layer, so a click outside
// closes it while prompts on top (Hive signing) stay clickable. `leaving` =
// fading out.
const DROPDOWN_GAP = 8;
const DROPDOWN_EDGE = 8;
const DROPDOWN_WIDTH = 600;

export default function SettingsModal({ isOpen, onClose, dropdown = null, leaving = false, hoverProps, typingProps }) {
  const { t } = useTranslation();
  const { theme, showNsfw, setShowNsfw, toggleTheme, homeCardSize, setHomeCardSize, previewEnabled, setPreviewEnabled, shortsCommentBar, setShortsCommentBar, openShortsOnStart, setOpenShortsOnStart, inlineShorts, setInlineShorts, hideWatched, setHideWatched, hideAi, setHideAi, privateMode, setPrivateMode, simpleFeed, setSimpleFeed } = useAppStore();
  const cardSize = useCardSize();
  const cardSizeMobile = useIsCardSizeMobile();
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
      if (tb.id === 'connections') return notificationsVisible;
      return true;
    }),
    [rewardsVisible, notificationsVisible],
  );
  const [tab, setTab] = useState('general');
  const [contentTab, setContentTab] = useState('feed');
  const [connectionsTab, setConnectionsTab] = useState('referrals');
  // Losing the group (or logging out) while standing on that page would leave the modal
  // with no tab selected and nothing rendered.
  useEffect(() => {
    if (tab === 'rewards' && !rewardsVisible) setTab('general');
    if (tab === 'notifications' && !notificationsVisible) setTab('general');
    if (tab === 'connections' && !notificationsVisible) setTab('general');
  }, [tab, rewardsVisible, notificationsVisible]);

  // Phone sheet: the tiles first, a section once one is tapped. Every opening
  // starts on the tiles again.
  const phone = useSyncExternalStore(subscribePhone, readPhone, () => false);
  const tiles = phone && !dropdown;
  const [sectionOpen, setSectionOpen] = useState(false);
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (wasOpen !== isOpen) {
    setWasOpen(isOpen);
    if (!isOpen) setSectionOpen(false);
  }
  const openSection = (id) => { setTab(id); setSectionOpen(true); };

  // Lock background page scroll while the modal is open (restore on close).
  useEffect(() => {
    if (!isOpen) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [isOpen]);

  // The window has a fixed height and its body scrolls, so switching tabs never
  // moves or resizes it (STYLE_GUIDE §1.5).
  const modalRef = useRef(null);

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

  // A dropdown closes on Escape, like the other top-bar menus.
  useEffect(() => {
    if (!isOpen || !dropdown) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, dropdown, onClose]);

  // The centred window is a dialog of its own, Escape included.
  const dialog = useDialog(onClose, { active: isOpen && !dropdown, ref: modalRef });

  if (!isOpen) return null;

  // Previews only work on touch devices in large mode, so hide the toggle when
  // a touch user has small cards selected (it would have no effect).
  const isTouch = !window.matchMedia('(hover: hover)').matches;
  const showPreviewSetting = !isTouch || cardSize === 'large';
  // The shorts comment bar is rendered only under 768px (see Short.scss), so its
  // toggle would do nothing on desktop/tablet. Gate it on the SAME breakpoint —
  // `isDesktop` (>=1025px) would wrongly still show it on a tablet.
  const showShortsCommentBarSetting = window.matchMedia('(max-width: 768px)').matches;

  let dropdownStyle;
  if (dropdown?.rect) {
    const width = Math.min(DROPDOWN_WIDTH, window.innerWidth - DROPDOWN_EDGE * 2);
    const top = dropdown.rect.bottom + DROPDOWN_GAP;
    dropdownStyle = {
      position: 'fixed',
      top,
      left: Math.min(Math.max(DROPDOWN_EDGE, dropdown.rect.right - width), window.innerWidth - width - DROPDOWN_EDGE),
      width,
      maxHeight: `calc(100vh - ${Math.round(top)}px - 16px)`,
    };
  }
  const overlayClass = [
    'settings-modal-overlay',
    dropdown && 'settings-modal-overlay--dropdown',
    dropdown?.held && 'settings-modal-overlay--held',
    leaving && 'settings-modal-overlay--leaving',
  ].filter(Boolean).join(' ');

  const current = visibleTabs.find((tb) => tb.id === tab) || visibleTabs[0];
  const showTiles = tiles && !sectionOpen;
  const closable = !(dropdown && !dropdown.held);

  return createPortal(
    <div className={overlayClass} onClick={onClose}>
      <div
        className={cx('settings-modal', dropdown && 'is-dropdown', tiles && 'is-sheet')}
        ref={modalRef}
        onClick={(e) => e.stopPropagation()}
        {...(dropdown ? { ...hoverProps, ...typingProps } : dialog.props)}
        style={dropdownStyle}
      >
        <div className="settings-grab" aria-hidden="true" />
        <div className="settings-head">
          {tiles && sectionOpen && (
            <IconButton icon="arrow_back" label={t('common.actions.back')} size={36} variant="ghost" round onClick={() => setSectionOpen(false)} />
          )}
          <h2 className="settings-head-title" id={dialog.titleId}>
            {tiles && sectionOpen ? t(current.labelKey) : t('common.nav.settings')}
          </h2>
          {closable && (
            <IconButton icon="close" label={t('common.actions.close')} size={36} variant="ghost" round onClick={onClose} />
          )}
        </div>

        {!tiles && (
          <Segmented
            className="settings-tabs"
            label={t('common.nav.settings')}
            scroll
            value={tab}
            onChange={setTab}
            options={visibleTabs.map(({ id, labelKey }) => ({ value: id, label: t(labelKey) }))}
          />
        )}

        <div className="settings-body">
          {showTiles && (
            <>
              {settingsUser && (
                <div className="settings-account">
                  <span className="v2-avatar settings-account-avatar"><AccountImg account={settingsUser} alt="" /></span>
                  <b>@{settingsUser}</b>
                </div>
              )}
              <div className="settings-tiles">
                {visibleTabs.map((tb) => (
                  <button key={tb.id} type="button" className="settings-tile" onClick={() => openSection(tb.id)}>
                    <span className={cx('settings-tile-icon', `is-${tb.tone}`)}><Icon name={tb.icon} size={20} /></span>
                    <b>{t(tb.labelKey)}</b>
                  </button>
                ))}
              </div>
            </>
          )}

          {!showTiles && (
            <>
              {tab === 'general' && (
                <section className="settings-section settings-language">
                  <LanguagePicker onNavigate={onClose} />
                </section>
              )}
              {tab === 'general' && (
                <Section title={t('settings.appearance.title')}>
                  <Row
                    title={t('settings.appearance.darkMode.title')}
                    desc={t('settings.appearance.darkMode.desc')}
                    checked={theme === 'dark'}
                    onChange={(wantDark) => { if ((theme === 'dark') !== wantDark) toggleTheme(); }}
                  />
                  {/* Large cards are a phone thing: desktop always uses small ones (hooks/useCardSize). */}
                  {cardSizeMobile && (
                    <Row
                      title={t('settings.appearance.largeCards.title')}
                      desc={t('settings.appearance.largeCards.desc')}
                      checked={homeCardSize === 'large'}
                      onChange={(large) => setHomeCardSize(large ? 'large' : 'small')}
                    />
                  )}
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
                </Section>
              )}
              {tab === 'general' && <PostingAuthoritySection />}

              {tab === 'connections' && (
                <Segmented
                  className="settings-subtabs"
                  label={t('settings.connectionsTabs.aria')}
                  value={connectionsTab}
                  onChange={setConnectionsTab}
                  options={CONNECTIONS_TABS.map((ct) => ({ value: ct.id, label: t(ct.labelKey) }))}
                />
              )}
              {tab === 'connections' && connectionsTab === 'support' && <LightningReceiveSection />}
              {tab === 'connections' && connectionsTab === 'support' && <SupportLinksSection />}
              {tab === 'connections' && connectionsTab === 'referrals' && <ReferralSection />}
              {tab === 'connections' && connectionsTab === 'profiles' && settingsUser && (
                <AddSocialLink_modal isOpen inline hiveUsername={settingsUser} onClose={() => {}} />
              )}

              {tab === 'content' && (
                <Segmented
                  className="settings-subtabs"
                  label={t('settings.contentTabs.aria')}
                  value={contentTab}
                  onChange={setContentTab}
                  options={CONTENT_TABS.map((ct) => ({ value: ct.id, label: t(ct.labelKey) }))}
                />
              )}

              {tab === 'content' && contentTab === 'shorts' && (
                <Section title={t('common.nav.shorts')}>
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
                </Section>
              )}

              {tab === 'content' && contentTab === 'feed' && (
                <Section tone="cyan" title={t('settings.contentTabs.feed')}>
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
                </Section>
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
                  <Section tone="cyan" title={t('settings.about.title')}>
                    <div className="settings-kv v2-well">
                      <span>{t('settings.about.version')}</span>
                      <b className="mono">v{APP_VERSION}</b>
                    </div>
                    <div className="settings-kv v2-well" onClick={handleButrUnlockTap}>
                      <span>{t('settings.about.rpcNode')}</span>
                      <b className="mono">{getHiveUrl()}</b>
                    </div>
                    <Button
                      as="a"
                      href="/privacy"
                      target="_blank"
                      rel="noopener noreferrer"
                      variant="secondary"
                      size={44}
                      block
                      className="is-next"
                      trailing="open_in_new"
                    >
                      {t('settings.about.privacyLink')}
                    </Button>
                  </Section>

                  <Section title={t('settings.about.yourData')}>
                    <DataRequestForm />
                  </Section>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
