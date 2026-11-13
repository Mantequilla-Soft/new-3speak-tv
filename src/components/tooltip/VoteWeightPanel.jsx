import { useTranslation } from 'react-i18next';
import { Button } from '../v2/ui';
import { Icon } from '../v2/Icon';
import { cx } from '../v2/helpers';

const PRESETS = [25, 50, 75, 100];

/**
 * Vote with weight (design 17b): the weight as a big accent number with what it
 * adds in money under it, the slider, 25/50/75/100 preset tiles, then the
 * primary Vote button. Shared by UpvoteTooltip and CardVoteTooltip, in a
 * popover on desktop and in a bottom sheet on phones. `children` sit between
 * the presets and the button (the optional topic tag).
 */
export default function VoteWeightPanel({ weight, setWeight, voteValue, isCalculating, isLoading, onVote, children }) {
  const { t } = useTranslation();
  return (
    <div className="vote-weight">
      <div className="vote-weight__big">
        <span className="vote-weight__pct">{weight}%</span>
        <span className="vote-weight__value" aria-live="polite">
          {isCalculating
            ? <Icon name="progress_activity" size={16} className="v2-spin" />
            : t('engagement.vote.addsAbout', { value: `$${voteValue}` })}
        </span>
      </div>
      <input
        type="range"
        className="vote-weight__slider"
        min="1"
        max="100"
        value={weight}
        onChange={(e) => setWeight(Number(e.target.value))}
        disabled={isLoading}
        aria-label={t('engagement.vote.weight', { weight })}
        style={{ '--fill': `${weight}%` }}
      />
      <div className="vote-weight__presets">
        {PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            className={cx('vote-weight__preset', weight === p && 'is-on')}
            aria-pressed={weight === p}
            onClick={() => setWeight(p)}
            disabled={isLoading}
          >
            {p}%
          </button>
        ))}
      </div>
      {children}
      <Button variant="primary" size={44} block trailing="arrow_upward" className="vote-weight__submit" onClick={onVote} disabled={isLoading} loading={isLoading}>
        {t('engagement.vote.vote')}
      </Button>
    </div>
  );
}
