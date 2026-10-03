import { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { IoClose, IoChevronBack, IoChevronForward, IoLogoGithub, IoCheckmarkCircle } from 'react-icons/io5';
import { useAppStore } from '../../lib/store';
import { APP_VERSION } from '../../version';
import { CHANGELOG, changelogSince } from '../../changelog';
import { markVersionSeen } from '../../utils/appVersion';
import { formatDaysAgo } from '../../i18n';
import logo from '../../assets/image/3S_logo.svg';
import logoDark from '../../assets/image/3S_logodark.png';
import './ChangelogModal.scss';

// DUMMY MODE: while we design the popup it opens on every load with the latest
// entries so we can iterate on styling. To go live, set DUMMY_MODE = false — then
// it only opens for users who upgraded (store.appUpdatedFrom, set by checkAppVersion).
const DUMMY_MODE = false;

// Short, friendly relative date e.g. "2 weeks ago", in the reader's language.
const timeAgo = formatDaysAgo;

// Routes that must never be interrupted by "what's new". /advertise is a landing
// page we send people to from outside 3Speak, and a changelog for an app they have
// not used yet is the worst possible first thing to put in front of them.
const SILENT_ROUTES = ['/advertise'];
const isSilentRoute = (pathname) => {
  const p = String(pathname || '').toLowerCase();
  return SILENT_ROUTES.some((r) => p === r || p.startsWith(`${r}/`));
};

export default function ChangelogModal() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const silenced = isSilentRoute(pathname);
  const appUpdatedFrom = useAppStore((s) => s.appUpdatedFrom);
  const setAppUpdatedFrom = useAppStore((s) => s.setAppUpdatedFrom);
  const theme = useAppStore((s) => s.theme);
  const [open, setOpen] = useState(false);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(true);
  // Custom scrollbar geometry (percent-based) so we get a real, themed, fixed
  // thickness in every browser — Firefox can't size a native scrollbar.
  const [thumb, setThumb] = useState({ width: 100, left: 0, visible: false });
  const scrollRef = useRef(null);
  const trackRef = useRef(null);

  useEffect(() => {
    // Held, not spent: `appUpdatedFrom` is left alone and markVersionSeen() is not
    // called, so the popup still appears the moment they leave this route.
    if (silenced) return;
    if (DUMMY_MODE) {
      setOpen(true);
      return;
    }
    if (!appUpdatedFrom) return;
    // Version bumped without a changelog entry for it — nothing to show, just advance.
    if (changelogSince(appUpdatedFrom).length === 0) {
      markVersionSeen();
      setAppUpdatedFrom(null);
      return;
    }
    setOpen(true);
  }, [appUpdatedFrom, setAppUpdatedFrom, silenced]);

  // Lock the page behind the popup so the scroll wheel never scrolls the site.
  // Must honour `silenced` too: a popup that is open but not rendered would
  // otherwise leave the page underneath unscrollable with nothing to close.
  useEffect(() => {
    if (!open || silenced) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [open, silenced]);

  // Recompute edge fades + the custom scrollbar thumb size/position.
  const updateFades = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setAtStart(el.scrollLeft <= 1);
    setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 1);

    const ratio = el.scrollWidth > 0 ? el.clientWidth / el.scrollWidth : 1;
    const visible = ratio < 0.999;
    const width = Math.max(ratio * 100, 8); // percent, min 8% so it stays grabbable
    const maxScroll = el.scrollWidth - el.clientWidth;
    const left = maxScroll > 0 ? (el.scrollLeft / maxScroll) * (100 - width) : 0;
    setThumb({ width, left, visible });
  }, []);

  // Drag the custom thumb to scroll the entries row.
  const onThumbDown = useCallback((e) => {
    e.preventDefault();
    const el = scrollRef.current;
    const track = trackRef.current;
    if (!el || !track) return;
    const startX = e.clientX;
    const startScroll = el.scrollLeft;
    const trackW = track.clientWidth;
    const thumbW = (thumb.width / 100) * trackW;
    const maxScroll = el.scrollWidth - el.clientWidth;
    const movableTrack = trackW - thumbW;
    const onMove = (ev) => {
      if (movableTrack <= 0) return;
      const delta = ev.clientX - startX;
      el.scrollLeft = startScroll + (delta / movableTrack) * maxScroll;
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [thumb.width]);

  // Click on the empty track to page toward the click point.
  const onTrackDown = useCallback((e) => {
    if (e.target !== trackRef.current) return; // ignore clicks on the thumb
    const el = scrollRef.current;
    const track = trackRef.current;
    if (!el || !track) return;
    const rect = track.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    el.scrollTo({ left: frac * (el.scrollWidth - el.clientWidth), behavior: 'smooth' });
  }, []);

  // Desktop arrow nav — centre the next/previous card in the viewport.
  const scrollByCard = useCallback((dir) => {
    const el = scrollRef.current;
    if (!el) return;
    const cards = el.querySelectorAll('.changelog-entry');
    if (!cards.length) return;
    const mid = el.getBoundingClientRect().left + el.clientWidth / 2;
    // Find the card nearest the centre now, then centre the next/prev one.
    let curr = 0, best = Infinity;
    cards.forEach((c, i) => {
      const r = c.getBoundingClientRect();
      const d = Math.abs(r.left + r.width / 2 - mid);
      if (d < best) { best = d; curr = i; }
    });
    const target = cards[Math.max(0, Math.min(cards.length - 1, curr + dir))];
    const tr = target.getBoundingClientRect();
    el.scrollBy({ left: tr.left + tr.width / 2 - mid, behavior: 'smooth' });
  }, []);

  // Translate vertical mouse-wheel into horizontal scrolling of the entries row.
  // Native non-passive listener so we can preventDefault (background stays put).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !open) return;
    updateFades();
    const onWheel = (e) => {
      if (e.deltaY === 0) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('resize', updateFades);
    return () => {
      el.removeEventListener('wheel', onWheel);
      window.removeEventListener('resize', updateFades);
    };
  }, [open, updateFades]);

  // Also covers arriving at a silenced route with the popup already up: it goes
  // away, and comes back on the way out, because `open` is never cleared here.
  if (!open || silenced) return null;

  const entries = DUMMY_MODE ? CHANGELOG : changelogSince(appUpdatedFrom);
  if (entries.length === 0) return null;

  const close = () => {
    setOpen(false);
    if (!DUMMY_MODE) {
      markVersionSeen(); // write the version only AFTER the popup has been shown
      setAppUpdatedFrom(null);
    }
  };

  return (
    <div className="changelog-overlay">
      <div className="changelog-modal" role="dialog" aria-modal="true">
        <button className="changelog-close" onClick={close} aria-label={t('common.actions.close')}>
          <IoClose />
        </button>

        <div className="changelog-header">
          <img className="changelog-logo" src={theme === 'dark' ? logoDark : logo} alt="3Speak" />
          <h2>{t('app.changelog.title')}</h2>
          <p className="changelog-subtitle">{t('app.changelog.subtitle', { version: APP_VERSION })}</p>
        </div>

        <div className={`changelog-scroller${atStart ? ' at-start' : ''}${atEnd ? ' at-end' : ''}`}>
          <div className="changelog-body" ref={scrollRef} onScroll={updateFades}>
            {entries.map((entry) => (
              <div className="changelog-entry" key={entry.version}>
                <div className="changelog-entry-meta">
                  <span className="changelog-entry-version">v{entry.version}</span>
                  {entry.date && <span className="changelog-entry-date">{timeAgo(entry.date)}</span>}
                </div>
                <p className="changelog-entry-summary">{entry.summary}</p>
              </div>
            ))}
          </div>
          <span className="changelog-fade left" aria-hidden="true" />
          <span className="changelog-fade right" aria-hidden="true" />
          {thumb.visible && (
            <div className="changelog-scrollbar" ref={trackRef} onPointerDown={onTrackDown}>
              <div
                className="changelog-scrollbar-thumb"
                style={{ width: `${thumb.width}%`, left: `${thumb.left}%` }}
                onPointerDown={onThumbDown}
              />
            </div>
          )}
          {entries.length > 1 && (
            <>
              <button className="changelog-arrow left" onClick={() => scrollByCard(-1)} disabled={atStart} aria-label={t('app.changelog.previousUpdates')}>
                <IoChevronBack />
              </button>
              <button className="changelog-arrow right" onClick={() => scrollByCard(1)} disabled={atEnd} aria-label={t('app.changelog.newerUpdates')}>
                <IoChevronForward />
              </button>
            </>
          )}
        </div>

        <div className="changelog-footer">
          <a
            className="changelog-repo"
            href="https://github.com/Mantequilla-Soft/new-3speak-tv/tree/production"
            target="_blank"
            rel="noopener noreferrer"
          >
            <IoLogoGithub />
            <span>{t('app.changelog.readTheCode')}</span>
          </a>
          <button className="changelog-cta" onClick={close}>
            <IoCheckmarkCircle />
            <span>{t('app.changelog.gotIt')}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
