import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useTranslation, Trans } from 'react-i18next';
import { Video, Zap, Radio, Users, MessageCircle, Sparkles, Megaphone, Wallet, Crosshair, BarChart3 } from 'lucide-react';
import { useAppStore } from '../../lib/store';
import { isManteAuthLogin } from '../../hive-api/aioha';
import { fetchProfile, isProfileEmpty } from '../../utils/profileMeta';
import { fetchIncubationProfile, fetchWarmupContact } from '../../lib/incubation';
import { normalizeInterestList, fetchUserInterests } from '../../utils/interests';
import TagsV2Picker from '../tooltip/TagsV2Picker';
import { reconcileAvatarOverride } from '../../utils/avatarCache';
import { setWelcomeActive } from '../../utils/welcomeGate';
import ProfileFields, { useProfileEditor } from './ProfileFields';
import './WelcomePrompt.scss';

// Per-account "already welcomed" flag (browser storage), so nobody gets the
// intro twice. Set when they save, skip, or when we find a profile that is
// already filled in.
const WELCOMED_KEY = '3speak_welcomed';
const loadWelcomed = () => {
  try { return JSON.parse(localStorage.getItem(WELCOMED_KEY) || '[]'); } catch { return []; }
};
const wasWelcomed = (username) => loadWelcomed().includes(username);
const markWelcomed = (username) => {
  try {
    const set = new Set(loadWelcomed());
    set.add(username);
    localStorage.setItem(WELCOMED_KEY, JSON.stringify([...set]));
  } catch { /* ignore storage errors */ }
};

// This is a new-signup flow: it only ever runs for an account with nothing in
// its profile yet. The flag widens WHICH logins are eligible (on preview, any
// login rather than ButrAuth only); it does not make a set-up account see it.
const SHOW_FOR_EVERY_LOGIN = import.meta.env.VITE_WELCOME_PROMPT_ALL === 'true';

// ?welcome=1 replays the flow even for an account that already dismissed it,
// so it stays reviewable without clearing localStorage by hand.
const isForced = () => {
  try { return new URLSearchParams(window.location.search).get('welcome') === '1'; } catch { return false; }
};

const THINGS_YOU_CAN_DO = [
  { Icon: Video, titleKey: 'app.welcome.things.postVideos.title', textKey: 'app.welcome.things.postVideos.text' },
  { Icon: Zap, titleKey: 'app.welcome.things.filmShorts.title', textKey: 'app.welcome.things.filmShorts.text' },
  { Icon: Radio, titleKey: 'app.welcome.things.goLive.title', textKey: 'app.welcome.things.goLive.text' },
  { Icon: Users, titleKey: 'app.welcome.things.buildCommunity.title', textKey: 'app.welcome.things.buildCommunity.text' },
  { Icon: MessageCircle, titleKey: 'app.welcome.things.makeFriends.title', textKey: 'app.welcome.things.makeFriends.text' },
  { Icon: Sparkles, titleKey: 'app.welcome.things.getInspired.title', textKey: 'app.welcome.things.getInspired.text' },
];

// The same welcome for someone who came to ADVERTISE: what their account is for
// is booking ads, so that is what it shows them. Talking to customers is in the
// list, as the optional extra it is for them.
const THINGS_AN_ADVERTISER_CAN_DO = [
  { Icon: Megaphone, titleKey: 'app.welcome.advertiserThings.bookAds.title', textKey: 'app.welcome.advertiserThings.bookAds.text' },
  { Icon: Wallet, titleKey: 'app.welcome.advertiserThings.payFromWallet.title', textKey: 'app.welcome.advertiserThings.payFromWallet.text' },
  { Icon: Crosshair, titleKey: 'app.welcome.advertiserThings.chooseWhere.title', textKey: 'app.welcome.advertiserThings.chooseWhere.text' },
  { Icon: BarChart3, titleKey: 'app.welcome.advertiserThings.seeDelivered.title', textKey: 'app.welcome.advertiserThings.seeDelivered.text' },
  { Icon: MessageCircle, titleKey: 'app.welcome.advertiserThings.talkToCustomers.title', textKey: 'app.welcome.advertiserThings.talkToCustomers.text' },
  { Icon: Users, titleKey: 'app.welcome.advertiserThings.oneAccount.title', textKey: 'app.welcome.advertiserThings.oneAccount.text' },
];

export default function WelcomePrompt() {
  const { t } = useTranslation();
  const user = useAppStore((s) => s.user);
  const authenticated = useAppStore((s) => s.authenticated);

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  // Came through the ADVERTISER warm-up. Known from their own private contact
  // record (only advertisers have one), read with their session; no record or no
  // session simply means the ordinary welcome.
  const [advertiser, setAdvertiser] = useState(false);
  const navigate = useNavigate();
  const editor = useProfileEditor(user);
  const {
    form, seed, setField, pickImage, uploading, saving, hasAnything, save,
    interests, setInterests,
  } = editor;

  useEffect(() => {
    const forced = isForced();
    if (!authenticated || !user || (wasWelcomed(user) && !forced)) {
      setOpen(false);                  // e.g. they logged out mid-flow
      setWelcomeActive(false);
      return;
    }
    // Off preview this is a ButrAuth-signup flow only: every other login came
    // in with a wallet they already use elsewhere on Hive.
    if (!SHOW_FOR_EVERY_LOGIN && !forced && !isManteAuthLogin()) return;

    // Claim the modal slot before InterestsPrompt's timer fires, then release
    // it again if we decide not to show.
    setWelcomeActive(true);
    let alive = true;
    (async () => {
      let profile = await fetchProfile(user);
      if (!alive) return;
      if (profile == null) {           // couldn't read Hive, try again next session
        setWelcomeActive(false);
        return;
      }
      reconcileAvatarOverride(user, profile.profile_image);
      // Anything already filled in (picture, display name, bio, location, cover)
      // means this isn't a fresh account, so no intro. ?welcome=1 still replays
      // it for review.
      if (!forced && !isProfileEmpty(profile)) {
        markWelcomed(user);            // already set up, never ask again
        setWelcomeActive(false);
        return;
      }
      // Nothing on Hive yet -- but this may not be a blank slate of a person.
      // Somebody who came through the warm-up has probably already written a
      // display name, a bio and picked a picture, and all of it was stored
      // off-chain because they had no account to write it to. Showing them an
      // empty form here asks them to do the same work twice, and silently drops
      // what they already chose the moment they save.
      //
      // Read by name rather than from the session: after graduation the account
      // IS the old handle (graduation creates it under that name), and the
      // public profile needs no session to answer, so this keeps working
      // however the identity is resolved.
      // Interests, ALWAYS — not only for an empty profile.
      //
      // What the account already has wins; the warm-up choices fill in when it
      // has none. Seeding this only in the empty-profile branch left the chips
      // blank whenever somebody had already set a profile, and because the save
      // writes whatever is ticked, saving from that state would have wiped
      // interests they had genuinely chosen.
      try {
        const onHive = await fetchUserInterests(user);
        if (!alive) return;
        if (onHive?.length) {
          setInterests(onHive);
        } else {
          const warmup = await fetchIncubationProfile(user).catch(() => null);
          if (!alive) return;
          if (Array.isArray(warmup?.interests) && warmup.interests.length) {
            setInterests(normalizeInterestList(warmup.interests));
          }
        }
      } catch { /* no interests to show; the chips simply start empty */ }

      if (isProfileEmpty(profile)) {
        try {
          const inc = await fetchIncubationProfile(user);
          const carried = inc?.profile;
          if (!alive) return;
          if (carried && !isProfileEmpty(carried)) {
            // Only the fields the editor actually owns, so nothing unexpected
            // rides along into a Hive profile update.
            profile = {
              ...profile,
              name: carried.name || profile.name || '',
              about: carried.about || profile.about || '',
              location: carried.location || profile.location || '',
              profile_image: carried.profile_image || profile.profile_image || '',
              cover_image: carried.cover_image || profile.cover_image || '',
              website: carried.website || profile.website || '',
            };
          }
        } catch { /* no warm-up profile, or the store is down: blank form */ }
      }

      const contact = await fetchWarmupContact().catch(() => null);
      if (!alive) return;
      setAdvertiser(!!contact?.email);

      seed(profile);
      setStep(0);
      setOpen(true);
    })();
    return () => { alive = false; };
  }, [authenticated, user, seed]);

  const finish = () => {
    if (user) markWelcomed(user);
    setOpen(false);
    setWelcomeActive(false);
  };

  // Escape closes it. The backdrop deliberately doesn't: a stray click would
  // burn the one welcome this account ever gets.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape' && !saving) finish(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, saving, user]);

  if (!open) return null;

  const submit = async () => {
    // Nothing filled in, so don't spend a transaction on an empty profile.
    if (!hasAnything) { finish(); return; }
    const ok = await save(t('app.welcome.profileLive'));
    if (ok) finish();
  };

  // Advertiser: save the brand profile (that is what moves it onto the Hive
  // account), then optionally on to booking. Only when they ask: never a redirect.
  const submitBrand = async ({ thenBook = false } = {}) => {
    const ok = hasAnything ? await save(t('app.welcome.brandProfileLive')) : true;
    if (!ok) return;
    finish();
    if (thenBook) navigate('/advertise');
  };

  return createPortal(
    <div className="welcome-overlay" role="dialog" aria-modal="true" aria-label={t('app.welcome.title')}>
      <div className="welcome-modal">
        {step === 0 ? (
          <>
            <div className="welcome-hero">
              <span className="welcome-wave" aria-hidden="true">👋</span>
              <h2>{advertiser && form.name ? t('app.welcome.titleNamed', { name: form.name }) : t('app.welcome.title')}</h2>
              <p className="welcome-hero-sub">
                {advertiser ? (
                  <Trans i18nKey="app.welcome.advertiserReady" values={{ user }} components={{ b: <strong /> }} />
                ) : (
                  <Trans i18nKey="app.welcome.heyUser" values={{ user }} components={{ b: <strong /> }} />
                )}
              </p>
            </div>

            <div className="welcome-grid">
              {(advertiser ? THINGS_AN_ADVERTISER_CAN_DO : THINGS_YOU_CAN_DO).map(({ Icon, titleKey, textKey }) => (
                <div className="welcome-card" key={titleKey}>
                  <span className="welcome-card-icon"><Icon size={18} /></span>
                  <div>
                    <h4>{t(titleKey)}</h4>
                    <p>{t(textKey)}</p>
                  </div>
                </div>
              ))}
            </div>

            <p className="welcome-note">
              {advertiser
                ? t('app.welcome.noteAdvertiser')
                : t('app.welcome.note')}
            </p>

            <div className="welcome-actions">
              <button type="button" className="welcome-skip" onClick={finish}>{t('app.welcome.maybeLater')}</button>
              <button type="button" className="welcome-primary" onClick={() => setStep(1)}>
                {advertiser ? t('app.welcome.checkBrandProfile') : t('app.welcome.setUpProfile')}
              </button>
            </div>
          </>
        ) : step === 1 ? (
          <>
            <div className="welcome-head">
              <h2>{advertiser ? t('app.welcome.brandProfileTitle') : t('app.welcome.profileTitle')}</h2>
              <p>
                {advertiser
                  ? t('app.welcome.brandProfileHint')
                  : t('app.welcome.profileHint')}
              </p>
            </div>

            <ProfileFields
              username={user}
              form={form}
              setField={setField}
              pickImage={pickImage}
              uploading={uploading}
              saving={saving}
            />

            {/* Split off the topics, which used to sit under all of this. The
                two together were taller than a phone screen, so the save button
                fell below the fold on exactly the devices most people sign up
                on. Nothing is written until the last step, so moving between
                them costs nothing. */}
            {advertiser ? (
              // No interests step for an advertiser: they came to book ads, and
              // their feed is not what this account is for.
              <div className="welcome-actions">
                <button type="button" className="welcome-skip" onClick={finish} disabled={saving}>
                  {t('app.welcome.skipForNow')}
                </button>
                <button type="button" className="welcome-back" onClick={() => submitBrand()} disabled={saving || uploading}>
                  {saving ? t('common.actions.saving') : t('common.actions.save')}
                </button>
                <button type="button" className="welcome-primary" onClick={() => submitBrand({ thenBook: true })} disabled={saving || uploading}>
                  {saving ? t('common.actions.saving') : t('app.welcome.saveAndBook')}
                </button>
              </div>
            ) : (
            <div className="welcome-actions">
              <button type="button" className="welcome-skip" onClick={finish} disabled={saving}>
                {t('app.welcome.skipForNow')}
              </button>
              <button
                type="button"
                className="welcome-primary"
                onClick={() => setStep(2)}
                disabled={uploading}
              >
                {uploading ? t('app.welcome.uploading') : t('common.actions.next')}
              </button>
            </div>
            )}
          </>
        ) : (
          <>
            <div className="welcome-head">
              <h2>{t('app.interests.title')}</h2>
              <p>
                {t('app.welcome.interestsHint')}
              </p>
            </div>

            {/* The SAME picker as Settings → Interests and the interests prompt.
                An earlier version rendered utils/interests INTERESTS, which is a
                different, older vocabulary: the stored topics are v2 slugs like
                "tech-science", so nothing a user had actually chosen could ever
                appear ticked. One picker, one taxonomy. */}
            <TagsV2Picker
              multi
              searchable
              value={interests}
              onChange={setInterests}
              disabled={saving}
            />

            <p className="welcome-fineprint">
              {t('app.welcome.interestsFineprint')}
            </p>

            <div className="welcome-actions">
              <button type="button" className="welcome-back" onClick={() => setStep(1)} disabled={saving}>
                {t('common.actions.back')}
              </button>
              <button type="button" className="welcome-primary" onClick={submit} disabled={saving || uploading}>
                {saving ? t('common.actions.saving') : t('app.welcome.saveAndExplore')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
