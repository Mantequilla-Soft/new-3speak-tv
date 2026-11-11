import { useMemo, useState } from 'react';
import { Icon } from '../v2/Icon';
import { useTranslation } from 'react-i18next';
import { formatDate } from '../../i18n';
import './ScheduleCalendar.scss';

// Weekday header keys (studio.schedule.days.*), Monday first.
const DAY_KEYS = ['mo', 'tu', 'we', 'th', 'fr', 'sa', 'su'];

const pad = (n) => String(n).padStart(2, '0');
const ymd = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;

/**
 * Inline date + time picker for the schedule sheets (uploader "Schedule this
 * post", scheduled-post editor "Scheduled for"). The month is always on screen,
 * so nobody has to find the native field's little calendar icon.
 *
 * Works on the same local "YYYY-MM-DDTHH:mm" string a datetime-local input uses,
 * so it drops in where one was. `min` / `max` are in that format too
 * (getMinMaxDates().minFormatted / maxFormatted); strings in this format compare
 * correctly as plain strings.
 *
 * Props: value, onChange(next), min, max
 */
export default function ScheduleCalendar({ value, onChange, min, max }) {
  const { t } = useTranslation();
  const [datePart = '', timePart = ''] = (value || '').split('T');
  const minDay = (min || '').slice(0, 10);
  const maxDay = (max || '').slice(0, 10);

  // The month on screen: the chosen day's, else the earliest allowed.
  const start = datePart || minDay || ymd(new Date().getFullYear(), new Date().getMonth(), 1);
  const [view, setView] = useState(() => ({
    y: Number(start.slice(0, 4)),
    m: Number(start.slice(5, 7)) - 1,
  }));

  const todayStr = (() => { const d = new Date(); return ymd(d.getFullYear(), d.getMonth(), d.getDate()); })();
  const monthKey = (y, m) => `${y}-${pad(m + 1)}`;
  const canPrev = !minDay || monthKey(view.y, view.m) > minDay.slice(0, 7);
  const canNext = !maxDay || monthKey(view.y, view.m) < maxDay.slice(0, 7);

  const shift = (delta) => setView(({ y, m }) => {
    const d = new Date(y, m + delta, 1);
    return { y: d.getFullYear(), m: d.getMonth() };
  });

  // Six rows at most, Monday-first, blanks before the 1st.
  const weeks = useMemo(() => {
    const first = new Date(view.y, view.m, 1);
    const lead = (first.getDay() + 6) % 7;
    const days = new Date(view.y, view.m + 1, 0).getDate();
    const cells = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
    while (cells.length % 7) cells.push(null);
    const rows = [];
    for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
    return rows;
  }, [view]);

  // Keep the result inside [min, max]: picking today with a time that has
  // already gone moves the time up to the earliest allowed one.
  const clamp = (next) => {
    if (min && next < min) return min;
    if (max && next > max) return max;
    return next;
  };

  const pickDay = (day) => {
    const time = timePart || (min ? min.slice(11, 16) : '12:00');
    onChange(clamp(`${ymd(view.y, view.m, day)}T${time}`));
  };

  const pickTime = (e) => {
    const time = e.target.value;
    if (!time) return;
    onChange(clamp(`${datePart || minDay}T${time}`));
  };

  return (
    <div className="schedule-calendar">
      <div className="schedule-calendar__head">
        <button
          type="button"
          className="schedule-calendar__nav"
          onClick={() => shift(-1)}
          disabled={!canPrev}
          aria-label={t('common.actions.back')}
        >
          <Icon name="chevron_left" size={18} />
        </button>
        <span className="schedule-calendar__month">
          {formatDate(new Date(view.y, view.m, 1), { month: 'long', year: 'numeric' })}
        </span>
        <button
          type="button"
          className="schedule-calendar__nav"
          onClick={() => shift(1)}
          disabled={!canNext}
          aria-label={t('common.actions.next')}
        >
          <Icon name="chevron_right" size={18} />
        </button>
      </div>

      <table className="schedule-calendar__grid">
        <thead>
          <tr>{DAY_KEYS.map((k) => <th key={k}>{t(`studio.schedule.days.${k}`)}</th>)}</tr>
        </thead>
        <tbody>
          {weeks.map((row, r) => (
            <tr key={r}>
              {row.map((day, c) => {
                if (!day) return <td key={c} />;
                const iso = ymd(view.y, view.m, day);
                const disabled = (minDay && iso < minDay) || (maxDay && iso > maxDay);
                const cls = [
                  'schedule-calendar__day',
                  iso === datePart ? 'is-selected' : '',
                  iso === todayStr ? 'is-today' : '',
                ].filter(Boolean).join(' ');
                return (
                  <td key={c}>
                    <button
                      type="button"
                      className={cls}
                      disabled={!!disabled}
                      onClick={() => pickDay(day)}
                      aria-pressed={iso === datePart}
                    >
                      {day}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      <label className="schedule-calendar__time">
        <Icon name="schedule" size={18} />
        <input type="time" value={timePart} onChange={pickTime} />
      </label>
    </div>
  );
}
