import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import {
  FaVideo, FaMobileAlt, FaComments, FaUserPlus, FaClock, FaKey, FaCoins, FaGlobeAmericas,
  FaCubes, FaSeedling, FaBolt, FaRocket,
} from 'react-icons/fa';
import { MdClose } from 'react-icons/md';
import { useAppStore } from '../../lib/store';
import { usePromptsActive, setPromptActive } from '../../utils/welcomeGate';
import './IncubationWelcome.scss';

// Shown once per handle, per browser. Not a server flag: it is a greeting, and
// the cost of someone seeing it twice on a new laptop is far lower than the cost
// of a round trip on every page load to find out.
const SEEN_KEY = '3speak_incubation_welcome_seen';

// Guards the SHAPE, not just the parse. A stored value that is valid JSON but
// not an array (anything hand-edited, or a key some future version reuses) would
// otherwise sail through JSON.parse and throw on .includes below -- and because
// it lives in localStorage it would do that on every load, permanently.
const seen = () => {
  try {
    const list = JSON.parse(localStorage.getItem(SEEN_KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch { return []; }
};
const markSeen = (handle) => {
  try {
    const all = new Set(seen());
    all.add(handle);
    localStorage.setItem(SEEN_KEY, JSON.stringify([...all]));
  } catch { /* private mode: they see it again, which is survivable */ }
};

// The word "incubation" is ours, not theirs. Nobody signing up for a video site
// thinks of themselves as being incubated, so the copy says "warm-up" and talks
// about what actually happens instead.
const STEPS = [
  {
    key: 'what',
    Icon: FaCubes,
    title: 'Welcome to 3Speak',
    body: (
      <>
        <p>
          3Speak is a video platform built on <strong>Hive</strong>, a public blockchain.
          Videos here are not owned by us: they belong to the people who post them, and
          they can earn real rewards from the people who watch them.
        </p>
      </>
    ),
  },
  {
    key: 'warmup',
    Icon: FaSeedling,
    title: 'You are in your warm-up',
    body: (
      <>
        <p>
          A Hive account is real and permanent, and someone has to pay for it. So instead
          of asking you for anything up front, we gave you a name and a place to publish
          straight away.
        </p>
        <p>
          Everything you make during the warm-up lives on 3Speak. When you are ready, the
          team reviews your channel and gives you a Hive account of your own, free. Your
          videos, shorts and follows then go to the blockchain under your own name, and
          you choose what comes with you.
        </p>
      </>
    ),
  },
  {
    key: 'do',
    Icon: FaBolt,
    title: 'What you can do right now',
    body: (
      <>
        <ul className="incw-list">
          <li><FaVideo aria-hidden="true" /> <span>Upload videos, exactly as anyone else here does.</span></li>
          <li><FaMobileAlt aria-hidden="true" /> <span>Post shorts from your phone or your desktop.</span></li>
          <li><FaComments aria-hidden="true" /> <span>Comment on anything, including videos by people already on Hive.</span></li>
          <li><FaUserPlus aria-hidden="true" /> <span>Follow creators and join communities.</span></li>
          <li><FaClock aria-hidden="true" /> <span>Watch. Your history and your feed are yours from day one.</span></li>
        </ul>
        <p className="incw-aside">
          A few things wait for your account: earning rewards and tipping. Those move
          real money, so they need an account that really is yours.
        </p>
      </>
    ),
  },
  {
    key: 'next',
    Icon: FaRocket,
    title: 'What happens next',
    body: (
      <>
        <p>
          Your profile shows a short list of things to do: post a video, a couple of
          shorts, follow a few people, write some comments, and watch some videos on
          3Speak.
        </p>
        <p>
          It is not a test. It is simply how we can tell a real channel from an empty
          or malicious one. Once the list is done the team reviews your channel and
          upgrades you as soon as possible.
        </p>
        <div className="incw-perks">
          <span><FaCoins aria-hidden="true" /> Posts that earn</span>
          <span><FaKey aria-hidden="true" /> Keys only you hold</span>
          <span><FaGlobeAmericas aria-hidden="true" /> The whole Hive network</span>
        </div>
      </>
    ),
  },
];

/**
 * The first thing a new user with no Hive account sees.
 *
 * They arrived through a Google button and were handed a video platform built on
 * a blockchain, without ever being told that. This explains where they are, why
 * nobody asked them for a wallet, and what the list on their profile is for.
 */
export default function IncubationWelcome() {
  const incubationHandle = useAppStore((s) => s.incubationHandle);
  const authenticated = useAppStore((s) => s.authenticated);
  const promptsActive = usePromptsActive('incubation-welcome');
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!authenticated || !incubationHandle) return undefined;
    if (promptsActive) return undefined;
    if (seen().includes(incubationHandle)) return undefined;

    // A beat after landing, so it does not race the page it is explaining.
    const t = setTimeout(() => {
      setPromptActive('incubation-welcome', true);
      setOpen(true);
    }, 900);
    return () => clearTimeout(t);
  }, [authenticated, incubationHandle, promptsActive]);

  const close = () => {
    if (incubationHandle) markSeen(incubationHandle);
    setOpen(false);
    setPromptActive('incubation-welcome', false);
  };

  if (!open) return null;

  const current = STEPS[step];
  const { Icon } = current;
  const last = step === STEPS.length - 1;

  return createPortal(
    <div className="incw-overlay" onClick={close}>
      <div className="incw" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Welcome to 3Speak">
        <button type="button" className="incw-close" onClick={close} aria-label="Close">
          <MdClose size={18} />
        </button>

        <div className="incw-body">
          <h2>
            <span className="incw-head-icon"><Icon size={16} aria-hidden="true" /></span>
            {current.title}
          </h2>
          {current.body}
        </div>

        <div className="incw-foot">
          {/* Dots, not a numbered wizard: it is four short screens, and a
              progress count would make it feel like paperwork. */}
          <div className="incw-dots" aria-hidden="true">
            {STEPS.map((s, i) => (
              <span key={s.key} className={i === step ? 'is-on' : ''} />
            ))}
          </div>
          <div className="incw-actions">
            {step > 0 && (
              <button type="button" className="incw-secondary" onClick={() => setStep((n) => n - 1)}>
                Back
              </button>
            )}
            {last ? (
              <Link to="/profile" className="incw-primary" onClick={close}>
                Show me my list
              </Link>
            ) : (
              <button type="button" className="incw-primary" onClick={() => setStep((n) => n + 1)}>
                Next
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
