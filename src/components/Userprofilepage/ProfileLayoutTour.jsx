import { useEffect, useState } from 'react';
import { Button, Dialog } from '../v2/ui';
import { useTranslation } from 'react-i18next';
import { markLayoutTourSeen } from '../../lib/profileLayout';
import './ProfileLayoutTour.scss';

/**
 * A short popup wizard for the Overview's edit mode: one gesture per step,
 * each with a small animated picture of it. Opens by itself the first time a
 * creator clicks "Customize profile" (see ProfileOverview), and from the "?" in
 * the edit bar any time after. The shared v2 dialog: centred on desktop, a
 * bottom sheet on phones (37c).
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
  const step = STEPS[i];
  const last = i === STEPS.length - 1;

  const close = () => { markLayoutTourSeen(); onClose(); };

  // Arrow keys step through; Escape is the dialog's own.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'ArrowRight') setI((n) => Math.min(STEPS.length - 1, n + 1));
      if (e.key === 'ArrowLeft') setI((n) => Math.max(0, n - 1));
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <Dialog
      open
      onClose={close}
      width={480}
      head={false}
      title={t(`profile.layout.tour.${step}.title`)}
      closeLabel={t('common.actions.close')}
      className="plt-dialog"
      bodyClassName="plt-body"
      footer={(
        <div className="plt-foot">
          {/* Skip lives in the step card; Back from the second step on. */}
          {i > 0 ? (
            <Button variant="secondary" size={36} className="plt-btn" onClick={() => setI(i - 1)}>{t('profile.layout.tour.back')}</Button>
          ) : null}
          <Button
            variant="cyan"
            size={36}
            className="plt-btn plt-btn--primary"
            trailing={last ? 'check' : 'arrow_forward'}
            onClick={() => (last ? close() : setI(i + 1))}
          >
            {last ? t('profile.layout.tour.done') : t('profile.layout.tour.next')}
          </Button>
        </div>
      )}
    >
      {/* key: restart the step's animation when it comes back */}
      <Picture key={step} step={step} />

      <div className="plt-text">
        <div className="plt-text-head">
          <span className="plt-count">{t('profile.layout.tour.stepOf', { n: i + 1, total: STEPS.length })}</span>
          <button type="button" className="plt-skip" onClick={close}>{t('profile.layout.tour.skip')}</button>
        </div>
        <h3 id="plt-title">{t(`profile.layout.tour.${step}.title`)}</h3>
        <p>{t(`profile.layout.tour.${step}.body`)}</p>
      </div>

      {/* The eight steps as a step bar; each segment jumps to its step. */}
      <div className="plt-dots">
        {STEPS.map((s, n) => (
          <button
            key={s}
            type="button"
            className={n <= i ? 'active' : ''}
            aria-current={n === i ? 'step' : undefined}
            onClick={() => setI(n)}
            aria-label={t('profile.layout.tour.stepOf', { n: n + 1, total: STEPS.length })}
          />
        ))}
      </div>
    </Dialog>
  );
}
