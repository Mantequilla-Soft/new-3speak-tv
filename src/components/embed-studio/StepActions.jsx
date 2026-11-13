import { Button } from '../v2/ui';
import './StepActions.scss';
// The wizard's shared page width. Every step renders this component, so this is
// the one place that guarantees the rule is loaded on whichever step opens first.
import './EmbedWizard.scss';

/**
 * The upload wizard's action row (Back, extra actions, Next/Proceed/Publish).
 *
 * Every step renders it TWICE, once in the top bar (StepProgress `actions`)
 * and once at the end of the page, from the same props object, so the two rows
 * can never disagree about a label, a handler or a disabled state:
 *
 *   const actions = { back: {...}, secondary: [...], primary: [...] };
 *   <StepProgress step={step} actions={actions} />
 *   ...page...
 *   <StepActions placement="bottom" {...actions} />
 *
 * Validation stays in the handlers (toasts), never in this row, so pressing the
 * top Next shows exactly the same message as the bottom one, once.
 *
 * v2 buttons: Back and the extra actions are secondary, the way on is the one
 * accent button with a trailing arrow (or its own `icon`). A second primary that
 * is disabled waiting for the first (Post after Watch ad) is drawn secondary, so
 * the view keeps one solid accent fill.
 * Desktop: one row, Back on the left, everything else on the right.
 * Phones: the primary action(s) on their own full-width line on top, Back and
 * the secondary actions sharing the line below.
 *
 * Action: { key, label, onClick, disabled?, title?, icon? }
 */
export default function StepActions({ placement = 'bottom', back = null, secondary = [], primary = [] }) {
  const second = secondary.filter(Boolean);
  const main = primary.filter(Boolean);
  const solo = !back && second.length === 0;
  const firstLive = main.findIndex((a) => !a.disabled);

  const button = (a, variant) => (
    <Button
      key={a.key}
      variant={variant}
      size={48}
      className={`step-actions__btn step-actions__btn--${variant === 'primary' ? 'primary' : a.key === 'back' ? 'back' : 'secondary'}${variant === 'primary' ? ' is-next' : ''}`}
      onClick={a.onClick}
      disabled={!!a.disabled}
      aria-disabled={a.disabled ? 'true' : undefined}
      title={a.title || undefined}
      icon={a.key === 'back' ? 'arrow_back' : undefined}
      trailing={variant === 'primary' ? (a.icon || 'arrow_forward') : a.icon}
    >
      {a.label}
    </Button>
  );

  return (
    <div className={`step-actions step-actions--${placement}${solo ? ' step-actions--solo' : ''}`}>
      {back && button({ key: 'back', ...back }, 'secondary')}
      {/* Pushes the rest right on desktop; the line break between the two rows on phones. */}
      <span className="step-actions__break" aria-hidden="true" />
      {second.map((a) => button(a, 'secondary'))}
      {main.map((a, i) => button(a, a.disabled && firstLive !== -1 && i !== firstLive ? 'secondary' : 'primary'))}
    </div>
  );
}
