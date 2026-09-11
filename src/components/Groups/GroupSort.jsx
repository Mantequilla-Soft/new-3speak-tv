import { MdArrowDownward, MdArrowUpward } from 'react-icons/md';
import './GroupSort.scss';

/**
 * One field, one direction. Deliberately not a row of filter chips: both lists
 * are a few hundred items with three or four numbers each, and every question
 * anyone actually asks of them ("biggest", "newest", "most active") is a sort,
 * not a filter. A filter would also hide things, which is the wrong default for
 * a directory people browse to discover something.
 */
export default function GroupSort({ options, field, direction, onFieldChange, onDirectionChange }) {
  const current = options.find((o) => o.id === field) || options[0];

  return (
    <div className="group-sort">
      <label className="group-sort-label" htmlFor="group-sort-field">Sort by</label>
      <select
        id="group-sort-field"
        className="group-sort-select"
        value={current.id}
        onChange={(e) => onFieldChange(e.target.value)}
      >
        {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
      <button
        type="button"
        className="group-sort-dir"
        onClick={() => onDirectionChange(direction === 'desc' ? 'asc' : 'desc')}
        // The label says what the button WILL do, the title says what you are
        // looking at now: an arrow on its own reads as either.
        aria-label={direction === 'desc' ? 'Sort ascending' : 'Sort descending'}
        title={direction === 'desc'
          ? `Highest ${current.label.toLowerCase()} first`
          : `Lowest ${current.label.toLowerCase()} first`}
      >
        {direction === 'desc' ? <MdArrowDownward size={16} /> : <MdArrowUpward size={16} />}
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
