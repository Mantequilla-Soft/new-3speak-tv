import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAppStore } from '../../lib/store';
import { usePromptsActive, setPromptActive } from '../../utils/welcomeGate';
import TrackChooser from './TrackChooser';
import { fetchIncubationProgress } from '../../lib/incubation';
import { withTracksKey } from './tracks';
import { useTranslation, Trans } from 'react-i18next';
import { Button, Dialog, Eyebrow, Icon, StepBar } from '../v2/ui';
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
    icon: 'hub',
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
    icon: 'eco',
    titleKey: 'incubation.welcome.warmup.title',
    body: (t) => (
      <>
        <p>
          <Trans i18nKey="incubation.welcome.warmup.p1" components={{ b: <strong /> }} />
        </p>
        <p>
          {t('incubation.welcome.warmup.p2')}
        </p>
      </>
    ),
  },
  {
    key: 'do',
    icon: 'bolt',
    titleKey: 'incubation.welcome.do.title',
    body: (t) => (
      <>
        <ul className="incw-list">
          <li><Icon name="check" size={18} /> <span>{t('incubation.welcome.do.upload')}</span></li>
          <li><Icon name="check" size={18} /> <span>{t('incubation.welcome.do.shorts')}</span></li>
          <li><Icon name="check" size={18} /> <span>{t('incubation.welcome.do.comment')}</span></li>
          <li><Icon name="check" size={18} /> <span>{t('incubation.welcome.do.follow')}</span></li>
          <li><Icon name="check" size={18} /> <span>{t('incubation.welcome.do.watch')}</span></li>
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
    icon: 'explore',
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
          <span><Icon name="payments" size={16} /> {t('incubation.welcome.path.perkEarn')}</span>
          <span><Icon name="key" size={16} /> {t('incubation.welcome.path.perkKeys')}</span>
          <span><Icon name="hub" size={16} /> {t('incubation.welcome.path.perkNetwork')}</span>
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
  // Their answer on the last step. Required: nothing they do counts towards
  // their list until they pick, so the popup cannot be closed without it
  // (owner 2026-10-12, after someone clicked it away and uploaded a video
  // that sat uncounted). Whatever they did before picking still counts after.
  const [chosen, setChosen] = useState(null);

  useEffect(() => {
    if (!authenticated || !incubationHandle) return undefined;
    if (promptsActive) return undefined;
    const greeted = seen().includes(incubationHandle);

    // "Seen" lives in this browser only, so a second device would greet them
    // again. The server knows whether they already picked a path: if they did,
    // they have been through this, so remember that here and stay closed
    // (owner 2026-10-06).
    //
    // It opens only on a confirmed needsTrack. It cannot be closed without a
    // path, so if the service is unreachable (which would also fail the save)
    // it waits for a later visit instead of locking them out of the site.
    // Greeted but still no path (they got past it before it was required):
    // ask again on every visit, straight at the question.
    let alive = true;
    // A beat after landing, so it does not race the page it is explaining.
    const timer = setTimeout(async () => {
      let progress = null;
      try {
        progress = await fetchIncubationProgress();
      } catch { /* unknown: try again next visit */ }
      if (!alive) return;
      if (progress && progress.track && !progress.needsTrack) {
        markSeen(incubationHandle);
        return;
      }
      if (!progress?.needsTrack) return;
      if (greeted) setStep(STEPS.length - 1);
      setPromptActive('incubation-welcome', true);
      setOpen(true);
    }, 900);
    return () => { alive = false; clearTimeout(timer); };
  }, [authenticated, incubationHandle, promptsActive]);

  const close = () => {
    if (incubationHandle) markSeen(incubationHandle);
    setOpen(false);
    setPromptActive('incubation-welcome', false);
  };

  if (!open) return null;

  const current = STEPS[step];
  const last = step === STEPS.length - 1;

  return (
    // The warm-up intro (design 46a). No close button, no Esc, no click-outside:
    // the only way out is picking a path. A 4px step bar on top (§11). Under
    // 768px a full-screen step page (.v2-onboard, 23a).
    <Dialog
      open
      dismissible={false}
      head={false}
      title={t('incubation.welcome.what.title')}
      width={520}
      className="incw v2-onboard"
      footer={(
        <>
          {step > 0 && (
            <Button variant="secondary" className="v2-onboard__skip" onClick={() => setStep((n) => n - 1)}>
              {t('common.actions.back')}
            </Button>
          )}
          {last && chosen ? (
            <Button as={Link} to="/profile" variant="primary" next className="incw-primary" onClick={close}>
              {t('incubation.welcome.showList')}
            </Button>
          ) : last ? (
            <Button variant="primary" next className="incw-primary" disabled>
              {t('incubation.welcome.showList')}
            </Button>
          ) : (
            <Button variant="primary" next className="incw-primary" onClick={() => setStep((n) => n + 1)}>
              {t('common.actions.next')}
            </Button>
          )}
        </>
      )}
    >
      <StepBar steps={STEPS.length} current={step} />
      <div className="v2-onboard__eyebrow">
        {step === 0 ? t('app.welcome.eyebrow') : t('app.welcome.stepOf', { n: step + 1, total: STEPS.length })}
      </div>
      <h2 className="incw-title">{t(current.titleKey)}</h2>
      <div className="incw-body">
        {current.body(t)}
      </div>
      {current.key === 'path' && (
        <>
          <Eyebrow as="h3" className="incw-choose">{t('incubation.progress.choosePath')}</Eyebrow>
          <TrackChooser current={chosen} onChosen={setChosen} />
        </>
      )}
    </Dialog>
  );
}
