import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
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
  { Icon: Video, title: 'Post videos', text: 'Upload long form video that stays yours, on a chain nobody can quietly delete it from.' },
  { Icon: Zap, title: 'Film shorts', text: 'Something quick, vertical and easy to share. Great for finding your first viewers.' },
  { Icon: Radio, title: 'Go live', text: 'Stream to your people, bring guests on stage, and keep the recording afterwards.' },
  { Icon: Users, title: 'Build a community', text: 'Start a space around what you care about, or join one that is already buzzing.' },
  { Icon: MessageCircle, title: 'Make real friends', text: 'Comment, chat and collaborate with actual humans who show up for each other.' },
  { Icon: Sparkles, title: 'Get inspired, get involved', text: 'Discover creators, support the ones you love, and earn while you are at it.' },
];

// The same welcome for someone who came to ADVERTISE: what their account is for
// is booking ads, so that is what it shows them. Talking to customers is in the
// list, as the optional extra it is for them.
const THINGS_AN_ADVERTISER_CAN_DO = [
  { Icon: Megaphone, title: 'Book ads across 3Speak', text: 'Video spots, shorts spots, player banners, tickers and pre-upload spots, from one day to three months.' },
  { Icon: Wallet, title: 'Pay from your own wallet', text: 'In HBD or HIVE, straight from this account. No card and no middleman.' },
  { Icon: Crosshair, title: 'Choose where it runs', text: 'Pick the format, the position in the video and how many days it runs.' },
  { Icon: BarChart3, title: 'See what it delivered', text: 'Plays and clicks for every booking, and credit back if a booking falls short.' },
  { Icon: MessageCircle, title: 'Talk to your customers', text: 'If you want to: post videos, answer comments and follow people under your brand.' },
  { Icon: Users, title: 'One account everywhere', text: 'The same brand and login across every Hive app, with a key only you hold.' },
];

export default function WelcomePrompt() {
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
    const ok = await save('Your profile is live. Welcome to 3Speak!');
    if (ok) finish();
  };

  // Advertiser: save the brand profile (that is what moves it onto the Hive
  // account), then optionally on to booking. Only when they ask: never a redirect.
  const submitBrand = async ({ thenBook = false } = {}) => {
    const ok = hasAnything ? await save('Your brand profile is live. Welcome to 3Speak!') : true;
    if (!ok) return;
    finish();
    if (thenBook) navigate('/advertise');
  };

  return createPortal(
    <div className="welcome-overlay" role="dialog" aria-modal="true" aria-label="Welcome to 3Speak">
      <div className="welcome-modal">
        {step === 0 ? (
          <>
            <div className="welcome-hero">
              <span className="welcome-wave" aria-hidden="true">👋</span>
              <h2>{advertiser ? `Welcome to 3Speak${form.name ? `, ${form.name}` : ''}` : 'Welcome to 3Speak'}</h2>
              <p className="welcome-hero-sub">
                {advertiser ? (
                  <>Your advertiser account <strong>@{user}</strong> is ready. This is the account you book ads with and pay from.</>
                ) : (
                  <>
                    Hey <strong>@{user}</strong>, you made it. 3Speak is built on Hive, so your
                    account, your audience and your content belong to you.
                  </>
                )}
              </p>
            </div>

            <div className="welcome-grid">
              {(advertiser ? THINGS_AN_ADVERTISER_CAN_DO : THINGS_YOU_CAN_DO).map(({ Icon, title, text }) => (
                <div className="welcome-card" key={title}>
                  <span className="welcome-card-icon"><Icon size={18} /></span>
                  <div>
                    <h4>{title}</h4>
                    <p>{text}</p>
                  </div>
                </div>
              ))}
            </div>

            <p className="welcome-note">
              {advertiser
                ? 'First, a quick look at your brand profile: it is what viewers see next to your ads.'
                : 'One last thing before you start: let people know who they are watching.'}
            </p>

            <div className="welcome-actions">
              <button type="button" className="welcome-skip" onClick={finish}>Maybe later</button>
              <button type="button" className="welcome-primary" onClick={() => setStep(1)}>
                {advertiser ? 'Check my brand profile' : 'Set up my profile'}
              </button>
            </div>
          </>
        ) : step === 1 ? (
          <>
            <div className="welcome-head">
              <h2>{advertiser ? 'Your brand profile' : 'Let people know who you are'}</h2>
              <p>
                {advertiser
                  ? 'Carried over from your warm-up. Saving puts it on your Hive account; you can change it any time.'
                  : 'This is what people see on your profile. You can change it any time.'}
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
                  Skip for now
                </button>
                <button type="button" className="welcome-back" onClick={() => submitBrand()} disabled={saving || uploading}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
                <button type="button" className="welcome-primary" onClick={() => submitBrand({ thenBook: true })} disabled={saving || uploading}>
                  {saving ? 'Saving…' : 'Save and book my first ad'}
                </button>
              </div>
            ) : (
            <div className="welcome-actions">
              <button type="button" className="welcome-skip" onClick={finish} disabled={saving}>
                Skip for now
              </button>
              <button
                type="button"
                className="welcome-primary"
                onClick={() => setStep(2)}
                disabled={uploading}
              >
                {uploading ? 'Uploading…' : 'Next'}
              </button>
            </div>
            )}
          </>
        ) : (
          <>
            <div className="welcome-head">
              <h2>What are you into?</h2>
              <p>
                We use these to pick what shows up on your home page. Choose as many
                as you like, or none, and change them whenever you want.
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
              Saved to your Hive account, so every Hive app shows the same profile
              and the same interests.
            </p>

            <div className="welcome-actions">
              <button type="button" className="welcome-back" onClick={() => setStep(1)} disabled={saving}>
                Back
              </button>
              <button type="button" className="welcome-primary" onClick={submit} disabled={saving || uploading}>
                {saving ? 'Saving…' : 'Save and start exploring'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
