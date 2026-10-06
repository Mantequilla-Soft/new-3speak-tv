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
import TrackChooser from './TrackChooser';
import { withTracksKey } from './tracks';
import { useTranslation, Trans } from 'react-i18next';
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
//
// Text is i18n keys: `titleKey` is translated at render, and `body` is a
// function of `t` so nothing is translated at import time.
const STEPS = [
  {
    key: 'what',
    Icon: FaCubes,
    titleKey: 'incubation.welcome.what.title',
    body: () => (
      <>
        <p>
          <Trans i18nKey="incubation.welcome.what.p1" components={{ b: <strong /> }} />
        </p>
      </>
    ),
  },
  {
    key: 'warmup',
    Icon: FaSeedling,
    titleKey: 'incubation.welcome.warmup.title',
    body: (t) => (
      <>
        <p>
          {t('incubation.welcome.warmup.p1')}
        </p>
        <p>
          {t('incubation.welcome.warmup.p2')}
        </p>
      </>
    ),
  },
  {
    key: 'do',
    Icon: FaBolt,
    titleKey: 'incubation.welcome.do.title',
    body: (t) => (
      <>
        <ul className="incw-list">
          <li><FaVideo aria-hidden="true" /> <span>{t('incubation.welcome.do.upload')}</span></li>
          <li><FaMobileAlt aria-hidden="true" /> <span>{t('incubation.welcome.do.shorts')}</span></li>
          <li><FaComments aria-hidden="true" /> <span>{t('incubation.welcome.do.comment')}</span></li>
          <li><FaUserPlus aria-hidden="true" /> <span>{t('incubation.welcome.do.follow')}</span></li>
          <li><FaClock aria-hidden="true" /> <span>{t('incubation.welcome.do.watch')}</span></li>
        </ul>
        <p className="incw-aside">
          {t('incubation.welcome.do.aside')}
        </p>
      </>
    ),
  },
  {
    // The question itself is rendered below the body (TrackChooser), because it
    // needs state; see `current.key === 'path'` in the component.
    key: 'path',
    Icon: FaRocket,
    titleKey: 'incubation.trackQuestion.title',
    body: (t) => (
      <>
        <p>
          {t(withTracksKey('incubation.welcome.path.p1'))}
        </p>
        <p>
          {t('incubation.welcome.path.p2')}
        </p>
        <div className="incw-perks">
          <span><FaCoins aria-hidden="true" /> {t('incubation.welcome.path.perkEarn')}</span>
          <span><FaKey aria-hidden="true" /> {t('incubation.welcome.path.perkKeys')}</span>
          <span><FaGlobeAmericas aria-hidden="true" /> {t('incubation.welcome.path.perkNetwork')}</span>
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
  const { t } = useTranslation();
  const incubationHandle = useAppStore((s) => s.incubationHandle);
  const authenticated = useAppStore((s) => s.authenticated);
  const promptsActive = usePromptsActive('incubation-welcome');
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  // Their answer on the last step. Optional here: until they pick, the nav pill
  // says "Choose your path" and their profile asks again.
  const [chosen, setChosen] = useState(null);

  useEffect(() => {
    if (!authenticated || !incubationHandle) return undefined;
    if (promptsActive) return undefined;
    if (seen().includes(incubationHandle)) return undefined;

    // A beat after landing, so it does not race the page it is explaining.
    const timer = setTimeout(() => {
      setPromptActive('incubation-welcome', true);
      setOpen(true);
    }, 900);
    return () => clearTimeout(timer);
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
      <div className="incw" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={t('incubation.welcome.what.title')}>
        <button type="button" className="incw-close" onClick={close} aria-label={t('common.actions.close')}>
          <MdClose size={18} />
        </button>

        <div className="incw-body">
          <h2>
            <span className="incw-head-icon"><Icon size={16} aria-hidden="true" /></span>
            {t(current.titleKey)}
          </h2>
          {current.body(t)}
          {current.key === 'path' && (
            <>
              <h3 className="incw-choose">{t('incubation.progress.choosePath')}</h3>
              <TrackChooser current={chosen} onChosen={setChosen} />
            </>
          )}
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
                {t('common.actions.back')}
              </button>
            )}
            {last ? (
              <Link to="/profile" className="incw-primary" onClick={close}>
                {chosen ? t('incubation.welcome.showList') : t('incubation.welcome.decideLater')}
              </Link>
            ) : (
              <button type="button" className="incw-primary" onClick={() => setStep((n) => n + 1)}>
                {t('common.actions.next')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
