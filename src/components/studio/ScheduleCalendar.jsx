import { useEffect, useMemo, useRef, useState } from 'react';
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

// "Sat 18:00" for the sheet's main action ("Schedule for Sat 18:00").
export function formatScheduleWhen(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${formatDate(d, { weekday: 'short' })} ${String(value).slice(11, 16)}`;
}

// The viewer's time zone as "Berlin (CET)": the schedule is in local time.
function localZoneLabel() {
  try {
    const id = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    const city = id.includes('/') ? id.split('/').pop().replace(/_/g, ' ') : '';
    const short = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' })
      .formatToParts(new Date())
      .find((p) => p.type === 'timeZoneName')?.value || '';
    return city && short ? `${city} (${short})` : (city || short || id);
  } catch {
    return '';
  }
}

/**
 * The 17d schedule sheet's picker: a strip of day tiles (the whole allowed
 * range, scrolling sideways; the picked one cyan), then the time and the time
 * zone as two wells. Same value format and props as ScheduleCalendar.
 */
export function ScheduleDayStrip({ value, onChange, min, max }) {
  const { t } = useTranslation();
  const [datePart = '', timePart = ''] = (value || '').split('T');
  const minDay = (min || '').slice(0, 10);
  const maxDay = (max || '').slice(0, 10);
  const stripRef = useRef(null);
  const zone = useMemo(localZoneLabel, []);

  const days = useMemo(() => {
    const now = new Date();
    const first = minDay ? new Date(`${minDay}T00:00`) : new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const last = maxDay ? new Date(`${maxDay}T00:00`) : new Date(first.getFullYear(), first.getMonth(), first.getDate() + 90);
    const out = [];
    for (let d = new Date(first); d <= last && out.length < 400; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
      out.push({ iso: ymd(d.getFullYear(), d.getMonth(), d.getDate()), date: d });
    }
    return out;
  }, [minDay, maxDay]);

  // Bring the picked day into view when the sheet opens on a later week.
  useEffect(() => {
    const el = stripRef.current?.querySelector('.is-on');
    if (el && stripRef.current) stripRef.current.scrollLeft = Math.max(0, el.offsetLeft - stripRef.current.offsetLeft - 54);
    // only on open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clamp = (next) => {
    if (min && next < min) return min;
    if (max && next > max) return max;
    return next;
  };

  const pickDay = (iso) => {
    const time = timePart || (min ? min.slice(11, 16) : '12:00');
    onChange(clamp(`${iso}T${time}`));
  };

  const pickTime = (e) => {
    const time = e.target.value;
    if (!time) return;
    onChange(clamp(`${datePart || minDay}T${time}`));
  };

  return (
    <div className="schedule-strip">
      <div className="schedule-strip__label">{t('studio.schedule.pickDay')}</div>
      <div className="schedule-strip__days" ref={stripRef}>
        {days.map(({ iso, date }) => (
          <button
            type="button"
            key={iso}
            className={`schedule-strip__day${iso === datePart ? ' is-on' : ''}`}
            aria-pressed={iso === datePart}
            aria-label={formatDate(date, { dateStyle: 'full' })}
            onClick={() => pickDay(iso)}
          >
            <span>{formatDate(date, { weekday: 'short' })}</span>
            <b>{date.getDate()}</b>
          </button>
        ))}
      </div>
      <div className="schedule-strip__row">
        <label className="schedule-strip__well is-time">
          <Icon name="schedule" size={18} />
          <input type="time" value={timePart} onChange={pickTime} aria-label={t('studio.scheduled.fields.scheduledFor')} />
        </label>
        <span className="schedule-strip__well is-zone" title={Intl.DateTimeFormat().resolvedOptions().timeZone}>{zone}</span>
      </div>
    </div>
  );
}
