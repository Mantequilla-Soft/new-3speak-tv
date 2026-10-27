import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FiX } from 'react-icons/fi';
import { useTranslation } from 'react-i18next';
import { markLayoutTourSeen } from '../../lib/profileLayout';
import './ProfileLayoutTour.scss';

/**
 * A short popup wizard for the Overview's edit mode: one gesture per step,
 * each with a small animated picture of it. Opens by itself the first time a
 * creator clicks "Customize profile" (see ProfileOverview), and from the "?" in
 * the edit bar any time after. Centred on desktop, a bottom sheet on phones.
 */

const STEPS = ['intro', 'move', 'resize', 'props', 'hide', 'links', 'mobile', 'save'];

// The pictures: a tiny page of blocks, animated per step (all in the SCSS).
function Picture({ step }) {
  return (
    <div className={`plt-pic plt-pic--${step}`} aria-hidden="true">
      <div className="plt-block plt-a"><i /></div>
      <div className="plt-block plt-b"><i /></div>
      <div className="plt-block plt-c"><i /></div>
      <div className="plt-extra" />
      <div className="plt-cursor" />
    </div>
  );
}

export default function ProfileLayoutTour({ onClose }) {
  const { t } = useTranslation();
  const [i, setI] = useState(0);
  const dialogRef = useRef(null);
  const step = STEPS[i];
  const last = i === STEPS.length - 1;

  const close = () => { markLayoutTourSeen(); onClose(); };

  useEffect(() => {
    dialogRef.current?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowRight') setI((n) => Math.min(STEPS.length - 1, n + 1));
      if (e.key === 'ArrowLeft') setI((n) => Math.max(0, n - 1));
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return createPortal(
    <div className="plt-overlay" onClick={close}>
      <div
        ref={dialogRef}
        className="plt-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="plt-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="plt-close" onClick={close} aria-label={t('common.actions.close')}>
          <FiX size={18} />
        </button>

        {/* key: restart the step's animation when it comes back */}
        <Picture key={step} step={step} />

        <div className="plt-text">
          <span className="plt-count">{t('profile.layout.tour.stepOf', { n: i + 1, total: STEPS.length })}</span>
          <h3 id="plt-title">{t(`profile.layout.tour.${step}.title`)}</h3>
          <p>{t(`profile.layout.tour.${step}.body`)}</p>
        </div>

        <div className="plt-foot">
          <div className="plt-dots">
            {STEPS.map((s, n) => (
              <button
                key={s}
                type="button"
                className={n === i ? 'active' : ''}
                onClick={() => setI(n)}
                aria-label={t('profile.layout.tour.stepOf', { n: n + 1, total: STEPS.length })}
              />
            ))}
          </div>
          <div className="plt-buttons">
            {i > 0 ? (
              <button type="button" className="plt-btn" onClick={() => setI(i - 1)}>{t('profile.layout.tour.back')}</button>
            ) : (
              <button type="button" className="plt-btn" onClick={close}>{t('profile.layout.tour.skip')}</button>
            )}
            <button
              type="button"
              className="plt-btn plt-btn--primary"
              onClick={() => (last ? close() : setI(i + 1))}
            >
              {last ? t('profile.layout.tour.done') : t('profile.layout.tour.next')}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
