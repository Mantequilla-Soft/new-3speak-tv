import { ChevronLeft } from 'lucide-react';
import './StepActions.scss';
// The wizard's shared page width. Every step renders this component, so this is
// the one place that guarantees the rule is loaded on whichever step opens first.
import './EmbedWizard.scss';

/**
 * The upload wizard's action row (Back, extra actions, Next/Proceed/Publish).
 *
 * Every step renders it TWICE, once directly below the stepper and once at the
 * end of the page, from the same props object, so the two rows can never
 * disagree about a label, a handler or a disabled state:
 *
 *   const actions = { back: {...}, secondary: [...], primary: [...] };
 *   <StepActions placement="top" {...actions} />
 *   ...page...
 *   <StepActions placement="bottom" {...actions} />
 *
 * Validation stays in the handlers (toasts), never in this row, so pressing the
 * top Next shows exactly the same message as the bottom one, once.
 *
 * Desktop: one row, Back on the left, everything else on the right.
 * Phones: the primary action(s) on their own full-width line on top, Back and
 * the secondary actions sharing the line below.
 *
 * Action: { key, label, onClick, disabled?, title? }
 */
export default function StepActions({ placement = 'bottom', back = null, secondary = [], primary = [] }) {
  const second = secondary.filter(Boolean);
  const main = primary.filter(Boolean);
  const solo = !back && second.length === 0;

  const button = (a, variant) => (
    <button
      key={a.key}
      type="button"
      className={`step-actions__btn step-actions__btn--${variant}`}
      onClick={a.onClick}
      disabled={!!a.disabled}
      aria-disabled={a.disabled ? 'true' : undefined}
      title={a.title || undefined}
    >
      {variant === 'back' && <ChevronLeft size={18} strokeWidth={2.25} aria-hidden="true" />}
      {a.label}
    </button>
  );

  return (
    <div className={`step-actions step-actions--${placement}${solo ? ' step-actions--solo' : ''}`}>
      {back && button({ key: 'back', ...back }, 'back')}
      {/* Pushes the rest right on desktop; the line break between the two rows on phones. */}
      <span className="step-actions__break" aria-hidden="true" />
      {second.map((a) => button(a, 'secondary'))}
      {main.map((a) => button(a, 'primary'))}
    </div>
  );
}
