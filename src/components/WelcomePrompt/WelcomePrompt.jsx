import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Video, Zap, Radio, Users, MessageCircle, Sparkles } from 'lucide-react';
import { useAppStore } from '../../lib/store';
import { isManteAuthLogin } from '../../hive-api/aioha';
import { fetchProfile, isProfileEmpty } from '../../utils/profileMeta';
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

export default function WelcomePrompt() {
  const user = useAppStore((s) => s.user);
  const authenticated = useAppStore((s) => s.authenticated);

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const editor = useProfileEditor(user);
  const { form, seed, setField, pickImage, uploading, saving, hasAnything, save } = editor;

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
      const profile = await fetchProfile(user);
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

  return createPortal(
    <div className="welcome-overlay" role="dialog" aria-modal="true" aria-label="Welcome to 3Speak">
      <div className="welcome-modal">
        {step === 0 ? (
          <>
            <div className="welcome-hero">
              <span className="welcome-wave" aria-hidden="true">👋</span>
              <h2>Welcome to 3Speak</h2>
              <p className="welcome-hero-sub">
                Hey <strong>@{user}</strong>, you made it. 3Speak is a creator owned video platform
                built on Hive: your account, your audience and your content belong to you, not to us.
              </p>
            </div>

            <div className="welcome-grid">
              {THINGS_YOU_CAN_DO.map(({ Icon, title, text }) => (
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
              One last thing before you start: let people know who they are watching.
            </p>

            <div className="welcome-actions">
              <button type="button" className="welcome-skip" onClick={finish}>Maybe later</button>
              <button type="button" className="welcome-primary" onClick={() => setStep(1)}>
                Set up my profile
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="welcome-head">
              <h2>Let people know who you are</h2>
              <p>
                This is what shows on your profile and next to everything you post.
                You can change it any time from your profile.
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

            <p className="welcome-fineprint">
              Saved to your Hive account, so every Hive app shows the same profile.
            </p>

            <div className="welcome-actions">
              <button type="button" className="welcome-skip" onClick={finish} disabled={saving}>
                Skip for now
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
