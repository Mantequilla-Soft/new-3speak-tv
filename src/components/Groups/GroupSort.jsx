import { useTranslation } from 'react-i18next';
import { Chip } from '../v2/ui';
import { Icon } from '../v2/Icon';
import './GroupSort.scss';

/**
 * One field, one direction. Deliberately not a row of filters: both lists are
 * a few hundred items with three or four numbers each, and every question
 * anyone actually asks of them ("biggest", "newest", "most active") is a sort,
 * not a filter. A filter would also hide things, which is the wrong default for
 * a directory people browse to discover something.
 *
 * Design 40b / 19d: the fields are chips (the selected one is ink-filled), and
 * the direction is a square button at the end of the row. Tapping the selected
 * chip again flips the direction too.
 */
export default function GroupSort({ options, field, direction, onFieldChange, onDirectionChange }) {
  const { t } = useTranslation();
  const current = options.find((o) => o.id === field) || options[0];
  const flip = () => onDirectionChange(direction === 'desc' ? 'asc' : 'desc');

  return (
    <div className="group-sort" role="group" aria-label={t('communities.sort.sortBy')}>
      <div className="v2-chips is-scroll group-sort-chips">
        {options.map((o) => (
          <Chip
            key={o.id}
            selected={o.id === current.id}
            onClick={() => (o.id === current.id ? flip() : onFieldChange(o.id))}
          >
            {o.label}
          </Chip>
        ))}
      </div>
      <button
        type="button"
        className="v2-iconbtn v2-btn--secondary h32 group-sort-dir"
        onClick={flip}
        // The label says what the button WILL do, the title says what you are
        // looking at now: an arrow on its own reads as either.
        aria-label={direction === 'desc' ? t('communities.sort.ascending') : t('communities.sort.descending')}
        title={direction === 'desc'
          ? t('communities.sort.highestFirst', { label: current.label })
          : t('communities.sort.lowestFirst', { label: current.label })}
      >
        <Icon name={direction === 'desc' ? 'arrow_downward' : 'arrow_upward'} size={18} />
      </button>
    </div>
  );
}

/**
 * Sort a list by one of the options above.
 *
 * Text sorts alphabetically and everything else numerically, decided by the
 * option rather than by sniffing the value, so a title that happens to be all
 * digits does not silently become a number. Missing values sort last in BOTH
 * directions: an entry with no date is not "the oldest".
 */
export function sortBy(items, options, field, direction, pin) {
  const opt = options.find((o) => o.id === field);
  if (!opt) return items;
  const sign = direction === 'asc' ? 1 : -1;

  const sorted = [...items].sort((a, b) => {
    const av = opt.value(a);
    const bv = opt.value(b);
    const aMissing = av === null || av === undefined || av === '';
    const bMissing = bv === null || bv === undefined || bv === '';
    if (aMissing && bMissing) return 0;
    if (aMissing) return 1;
    if (bMissing) return -1;
    if (opt.text) return sign * String(av).localeCompare(String(bv));
    return sign * (Number(av) - Number(bv));
  });

  // Yours first, in whatever order the sort put them. Done as a stable
  // partition AFTER sorting rather than as a tiebreak inside it, so the chosen
  // sort still governs within each group and "mine" never silently reorders the
  // rest.
  if (!pin?.ids?.size) return sorted;
  const mine = [];
  const others = [];
  for (const item of sorted) {
    (pin.ids.has(pin.idOf(item)) ? mine : others).push(item);
  }
  return [...mine, ...others];
}
