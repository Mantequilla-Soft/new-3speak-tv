import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import { START_TOUR_EVENT } from './welcomeState';
import './WelcomeTour.scss';

// A guided tour over the REAL page: each step spotlights an element that is on
// screen right now. Steps list several selectors because desktop and phone show
// different controls (logo menu vs bottom bar, search box vs Discover icon); the
// first one that is visible wins, and a step with nothing visible is skipped.
// A step without selectors is a centred card (intro and outro).
const STEPS = [
  { id: 'intro' },
  // What 3Speak is, as keyword chips plus one short paragraph.
  { id: 'about', chips: ['community', 'free', 'international', 'communities', 'decentralized', 'openSource', 'hive'] },
  // How creators and viewers earn (author rewards, the 50% / 10% ad split).
  { id: 'earnCreators', chips: ['authorRewards', 'adShare', 'noMinimum'] },
  { id: 'earnViewers', chips: ['watch', 'adShare', 'program'] },
  // Wide screens show the page links in the top bar; narrower ones hide them
  // behind the logo. Only one of these two survives (see visibleSteps).
  { id: 'pagesBar', titleKey: 'pagesDesktop', targets: ['#nav-tabs'], desktopOnly: true },
  { id: 'pagesDesktop', targets: ['.nav-logo-btn'], desktopOnly: true },
  { id: 'pagesPhone', targets: ['.bottom-nav'], phoneOnly: true },
  { id: 'search', targets: ['.navsearch-input-wrap', '.nav-mobile-discover:not(.nav-guest-faq-icon)'] },
  { id: 'stories', targets: ['.stories-scroll-wrapper'] },
  { id: 'feeds', targets: ['.home-tabs'] },
  { id: 'settings', targets: ['.nav-settings-btn'] },
  { id: 'faq', targets: ['a.nav-guest-about[href="/faq"]', '.nav-guest-faq-icon'] },
  { id: 'account', targets: ['.nav-guest-signup', '.nav-guest-login', '.bottom-nav a.bottom-nav-item[href="#"]'] },
  { id: 'done' },
];

const PHONE_MAX = 767; // same breakpoint as mix.respond(phone)
const PAD = 6; // breathing room around the spotlit element

const isPhone = () => window.innerWidth <= PHONE_MAX;

function findTarget(step) {
  if (!step.targets) return null;
  for (const sel of step.targets) {
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return el;
    }
  }
  return null;
}

// The steps that make sense on this screen, worked out once when the tour starts.
function visibleSteps() {
  const phone = isPhone();
  const steps = STEPS.filter((s) => {
    if (s.phoneOnly && !phone) return false;
    if (s.desktopOnly && phone) return false;
    return !s.targets || !!findTarget(s);
  });
  return steps.some((s) => s.id === 'pagesBar') ? steps.filter((s) => s.id !== 'pagesDesktop') : steps;
}

export default function WelcomeTour() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const [steps, setSteps] = useState(null); // null = not running
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState(null);
  const [cardPos, setCardPos] = useState(null);
  const cardRef = useRef(null);
  const nextRef = useRef(null);
  const pendingStart = useRef(false);

  const begin = useCallback(() => {
    setIndex(0);
    setSteps(visibleSteps());
  }, []);

  // The tour describes the home page, so it always runs there.
  const start = useCallback(() => {
    if (pathname !== '/') {
      pendingStart.current = true;
      navigate('/');
      return;
    }
    begin();
  }, [pathname, navigate, begin]);

  useEffect(() => {
    window.addEventListener(START_TOUR_EVENT, start);
    return () => window.removeEventListener(START_TOUR_EVENT, start);
  }, [start]);

  // Arrived on the home page after a start elsewhere, or opened with ?tour=1.
  // Waits a moment so the stories row and tabs have rendered.
  useEffect(() => {
    if (pathname !== '/') return undefined;
    const fromUrl = new URLSearchParams(search).get('tour') === '1';
    if (!pendingStart.current && !fromUrl) return undefined;
    pendingStart.current = false;
    const id = setTimeout(begin, 900);
    return () => clearTimeout(id);
  }, [pathname, search, begin]);

  const step = steps?.[index];
  const target = step ? findTarget(step) : null;

  // Leaving the tour never hides the welcome banner: only its X does.
  const close = useCallback(() => {
    setSteps(null);
    setRect(null);
  }, []);

  // Bring the spotlit element into view, then follow it while the page shifts
  // (images load, rows grow). Polling is cheap here and catches every kind of move.
  useEffect(() => {
    if (!step) return undefined;
    const el = findTarget(step);
    if (!el) { setRect(null); return undefined; }
    const r0 = el.getBoundingClientRect();
    if (r0.top < 70 || r0.bottom > window.innerHeight - 80) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    const measure = () => {
      const r = el.getBoundingClientRect();
      setRect((prev) => (prev && prev.top === r.top && prev.left === r.left && prev.width === r.width && prev.height === r.height)
        ? prev
        : { top: r.top, left: r.left, width: r.width, height: r.height });
    };
    measure();
    const id = setInterval(measure, 200);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      clearInterval(id);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [step]);

  // Place the card next to the spotlight on larger screens: below it if there
  // is room, otherwise above, kept inside the window. Phones use a bottom sheet
  // (top sheet when the spotlight is in the lower half, e.g. the bottom bar).
  useLayoutEffect(() => {
    if (!step || !cardRef.current) return;
    const card = cardRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (isPhone()) {
      const low = rect && rect.top + rect.height / 2 > vh / 2;
      setCardPos({ sheet: low ? 'top' : 'bottom' });
      return;
    }
    if (!rect) { setCardPos({ centered: true }); return; }
    const gap = 14;
    let top = rect.top + rect.height + PAD + gap;
    if (top + card.height > vh - 16) top = rect.top - PAD - gap - card.height;
    if (top < 16) top = Math.max(16, vh - card.height - 16);
    let left = rect.left + rect.width / 2 - card.width / 2;
    left = Math.min(Math.max(16, left), vw - card.width - 16);
    setCardPos({ top, left });
  }, [step, rect]);

  // Keyboard: arrows move, Escape leaves. Focus starts on the main button.
  useEffect(() => {
    if (!steps) return undefined;
    nextRef.current?.focus({ preventScroll: true });
    const onKey = (e) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight') setIndex((i) => Math.min(i + 1, steps.length - 1));
      else if (e.key === 'ArrowLeft') setIndex((i) => Math.max(i - 1, 0));
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [steps, index, close]);

  if (!step) return null;

  const last = index === steps.length - 1;
  const spot = target && rect ? {
    top: rect.top - PAD,
    left: rect.left - PAD,
    width: rect.width + PAD * 2,
    height: rect.height + PAD * 2,
  } : null;

  let cardClass = 'wt-card';
  let cardStyle;
  if (cardPos?.sheet) cardClass += ` wt-card--sheet wt-card--${cardPos.sheet}`;
  else if (cardPos?.centered || !cardPos) cardClass += ' wt-card--center';
  else cardStyle = { top: cardPos.top, left: cardPos.left };

  return createPortal(
    <div className="wt-root">
      {/* The spotlight's huge shadow IS the dimmed backdrop. Without a target the
          whole screen dims. Either layer swallows clicks so the page stays put. */}
      {spot
        ? <div className="wt-spot" style={spot} aria-hidden="true" />
        : <div className="wt-dim" aria-hidden="true" />}
      <div className="wt-blocker" onClick={(e) => e.stopPropagation()} />

      <div
        ref={cardRef}
        className={cardClass}
        style={cardStyle}
        role="dialog"
        aria-modal="true"
        aria-label={t('welcome.tour.aria')}
        aria-describedby="wt-text"
      >
        <div className="wt-progress">{t('welcome.tour.progress', { current: index + 1, total: steps.length })}</div>
        <h3 className="wt-title">{t(`welcome.tour.steps.${step.titleKey || step.id}.title`)}</h3>
        {step.chips && (
          <ul className="wt-chips">
            {step.chips.map((c) => <li key={c}>{t(`welcome.tour.steps.${step.id}.chips.${c}`)}</li>)}
          </ul>
        )}
        <p className="wt-text" id="wt-text">
          <Trans i18nKey={`welcome.tour.steps.${step.id}.text`} components={{ b: <b /> }} />
        </p>
        <div className="wt-dots" aria-hidden="true">
          {steps.map((s, i) => <span key={s.id} className={i === index ? 'on' : ''} />)}
        </div>
        <div className="wt-actions">
          {!last && (
            <button type="button" className="wt-skip" onClick={() => close()}>{t('welcome.tour.skip')}</button>
          )}
          <span className="wt-spacer" />
          {index > 0 && (
            <button type="button" className="wt-btn" onClick={() => setIndex(index - 1)}>{t('welcome.tour.back')}</button>
          )}
          <button
            type="button"
            ref={nextRef}
            className="wt-btn wt-btn--primary"
            onClick={() => (last ? close() : setIndex(index + 1))}
          >
            {last ? t('welcome.tour.done') : t('welcome.tour.next')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
