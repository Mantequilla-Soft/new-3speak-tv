import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '../v2/ui';
import { useTranslation } from 'react-i18next';
import { markLayoutTourSeen } from '../../lib/profileLayout';
import './ProfileLayoutTour.scss';

/**
 * The edit-mode tour (37c): eight steps in one small card at the bottom right
 * of the page, so the editor it explains stays in view and usable. A mono cyan
 * "Step 3 of 8" with Skip, the title, one muted paragraph, then Back and Next.
 * Opens by itself the first time a creator clicks "Customize profile" (see
 * ProfileOverview), and from the "?" in the edit bar any time after. Arrow
 * keys step through it, Escape closes it.
 */

const STEPS = ['intro', 'move', 'resize', 'props', 'hide', 'links', 'mobile', 'save'];

export default function ProfileLayoutTour({ onClose }) {
  const { t } = useTranslation();
  const [i, setI] = useState(0);
  const ref = useRef(null);
  const step = STEPS[i];
  const last = i === STEPS.length - 1;

  const close = () => { markLayoutTourSeen(); onClose(); };
  const closeRef = useRef(close);
  useEffect(() => { closeRef.current = close; });

  useEffect(() => { ref.current?.focus(); }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      if (e.key === 'ArrowRight') setI((n) => Math.min(STEPS.length - 1, n + 1));
      else if (e.key === 'ArrowLeft') setI((n) => Math.max(0, n - 1));
      else if (e.key === 'Escape') closeRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return createPortal(
    <div
      ref={ref}
      className="plt-card"
      role="dialog"
      aria-modal="false"
      aria-labelledby="plt-title"
      aria-describedby="plt-body"
      tabIndex={-1}
    >
      <div className="plt-head">
        <span className="plt-count">{t('profile.layout.tour.stepOf', { n: i + 1, total: STEPS.length })}</span>
        <button type="button" className="plt-skip" onClick={close}>{t('profile.layout.tour.skip')}</button>
      </div>
      <h3 id="plt-title">{t(`profile.layout.tour.${step}.title`)}</h3>
      <p id="plt-body">{t(`profile.layout.tour.${step}.body`)}</p>
      <div className="plt-foot">
        {/* Back from the second step on. */}
        {i > 0 ? (
          <Button variant="secondary" size={36} className="plt-btn" onClick={() => setI(i - 1)}>{t('profile.layout.tour.back')}</Button>
        ) : null}
        <Button
          variant="cyan"
          size={36}
          className="plt-btn plt-btn--primary"
          onClick={() => (last ? close() : setI(i + 1))}
        >
          {last ? t('profile.layout.tour.done') : t('profile.layout.tour.next')}
        </Button>
      </div>
    </div>,
    document.body,
  );
}
