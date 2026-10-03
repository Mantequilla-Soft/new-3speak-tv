import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { IoChevronBack, IoChevronForward, IoGlobeOutline } from 'react-icons/io5';
import './SchedulePicker.scss';
import { useTranslation } from 'react-i18next';
import { formatDate } from '../../i18n';

// Translation-key suffixes for the weekday header (studio.schedule.days.*), Monday first.
const DAY_NAMES = ['mo','tu','we','th','fr','sa','su'];

function SchedulePicker({ value, onChange, minDate, maxDate, onValidChange }) {
  const { t, i18n } = useTranslation();
  // Parse existing value into date and time parts
  const [dateStr, timeStr] = useMemo(() => {
    if (!value) return ['', ''];
    const parts = value.split('T');
    return [parts[0] || '', parts[1] || ''];
  }, [value]);

  // Calendar view state
  const [viewYear, setViewYear] = useState(() => {
    if (dateStr) return parseInt(dateStr.split('-')[0]);
    return new Date().getFullYear();
  });
  const [viewMonth, setViewMonth] = useState(() => {
    if (dateStr) return parseInt(dateStr.split('-')[1]) - 1;
    return new Date().getMonth();
  });

  // Manual date input state
  const [manualDay, setManualDay] = useState('');
  const [manualMonth, setManualMonth] = useState('');
  const [manualYear, setManualYear] = useState('');

  // Time state
  const [hour, setHour] = useState(() => {
    if (timeStr) return parseInt(timeStr.split(':')[0]);
    return 12;
  });
  const [minute, setMinute] = useState(() => {
    if (timeStr) return parseInt(timeStr.split(':')[1]);
    return 0;
  });

  // Inline editing state for hour/minute
  const [editingHour, setEditingHour] = useState(false);
  const [editingMinute, setEditingMinute] = useState(false);
  const [editHourVal, setEditHourVal] = useState('');
  const [editMinuteVal, setEditMinuteVal] = useState('');

  // Parse min/max
  const minParsed = useMemo(() => minDate ? new Date(minDate) : null, [minDate]);
  const maxParsed = useMemo(() => maxDate ? new Date(maxDate) : null, [maxDate]);

  // Sync view month/year when value changes externally
  useEffect(() => {
    if (dateStr) {
      const [y, m, d] = dateStr.split('-');
      setViewYear(parseInt(y));
      setViewMonth(parseInt(m) - 1);
      setManualDay(String(parseInt(d)));
      setManualMonth(String(parseInt(m)));
      setManualYear(y);
    }
  }, [dateStr]);

  // Sync hour/minute when value changes externally
  useEffect(() => {
    if (timeStr) {
      setHour(parseInt(timeStr.split(':')[0]));
      setMinute(parseInt(timeStr.split(':')[1]));
    }
  }, [timeStr]);

  // Preselect with the next possible datetime on mount
  useEffect(() => {
    if (!value && minDate) {
      onChange(minDate);
    }
  }, []);

  const emitChange = useCallback((newDate, newTime) => {
    if (newDate && newTime) {
      onChange(`${newDate}T${newTime}`);
    } else if (newDate && timeStr) {
      onChange(`${newDate}T${timeStr}`);
    } else if (dateStr && newTime) {
      onChange(`${dateStr}T${newTime}`);
    } else if (newDate && !timeStr) {
      // Auto-set a default time
      const now = new Date();
      const nextHour = (now.getHours() + 2) % 24;
      const defaultTime = `${String(nextHour).padStart(2, '0')}:00`;
      onChange(`${newDate}T${defaultTime}`);
    }
  }, [dateStr, timeStr, onChange]);

  // Calendar helpers
  const getDaysInMonth = (year, month) => new Date(year, month + 1, 0).getDate();
  // Shift so Monday=0, Sunday=6
  const getFirstDayOfMonth = (year, month) => (new Date(year, month, 1).getDay() + 6) % 7;

  const isDateDisabled = useCallback((year, month, day) => {
    const d = new Date(year, month, day, 23, 59, 59);
    const dStart = new Date(year, month, day, 0, 0, 0);
    if (minParsed && d < minParsed) return true;
    if (maxParsed && dStart > maxParsed) return true;
    return false;
  }, [minParsed, maxParsed]);

  const isToday = (year, month, day) => {
    const now = new Date();
    return now.getFullYear() === year && now.getMonth() === month && now.getDate() === day;
  };

  const isSelected = (year, month, day) => {
    if (!dateStr) return false;
    const sel = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return sel === dateStr;
  };

  const selectDate = (day) => {
    const newDate = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    emitChange(newDate, null);
  };

  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(viewYear - 1); }
    else setViewMonth(viewMonth - 1);
  };

  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(viewYear + 1); }
    else setViewMonth(viewMonth + 1);
  };

  const canGoPrev = useMemo(() => {
    if (!minParsed) return true;
    const prevLast = viewMonth === 0 ? new Date(viewYear - 1, 11, 31) : new Date(viewYear, viewMonth, 0);
    return prevLast >= minParsed;
  }, [viewYear, viewMonth, minParsed]);

  const canGoNext = useMemo(() => {
    if (!maxParsed) return true;
    const nextFirst = viewMonth === 11 ? new Date(viewYear + 1, 0, 1) : new Date(viewYear, viewMonth + 1, 1);
    return nextFirst <= maxParsed;
  }, [viewYear, viewMonth, maxParsed]);

  // Second month (next month)
  const nextMonthIdx = viewMonth === 11 ? 0 : viewMonth + 1;
  const nextMonthYear = viewMonth === 11 ? viewYear + 1 : viewYear;

  // Build calendar grid for a given year/month
  const buildMonthGrid = useCallback((year, month) => {
    const daysInMonth = getDaysInMonth(year, month);
    const firstDay = getFirstDayOfMonth(year, month);
    const rows = [];
    let cells = [];

    for (let i = 0; i < firstDay; i++) {
      cells.push(<td key={`empty-${i}`} className="empty-cell" />);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const disabled = isDateDisabled(year, month, day);
      const today = isToday(year, month, day);
      const selected = isSelected(year, month, day);
      const y = year, m = month, d = day;

      cells.push(
        <td key={day}>
          <button
            className={`day-btn${selected ? ' selected' : ''}${today ? ' today' : ''}${disabled ? ' disabled' : ''}`}
            disabled={disabled}
            onClick={() => {
              const newDate = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
              emitChange(newDate, null);
            }}
            type="button"
          >
            {day}
          </button>
        </td>
      );

      if ((firstDay + day) % 7 === 0) {
        rows.push(<tr key={`row-${rows.length}`}>{cells}</tr>);
        cells = [];
      }
    }

    if (cells.length > 0) {
      while (cells.length < 7) cells.push(<td key={`pad-${cells.length}`} className="empty-cell" />);
      rows.push(<tr key={`row-${rows.length}`}>{cells}</tr>);
    }

    return rows;
  }, [dateStr, minParsed, maxParsed, emitChange]);

  const calendarDays = useMemo(() => buildMonthGrid(viewYear, viewMonth), [buildMonthGrid, viewYear, viewMonth]);
  const calendarDays2 = useMemo(() => buildMonthGrid(nextMonthYear, nextMonthIdx), [buildMonthGrid, nextMonthYear, nextMonthIdx]);

  // Manual date input handler
  const applyManualDate = () => {
    const d = parseInt(manualDay);
    const m = parseInt(manualMonth);
    const y = parseInt(manualYear);
    if (!d || !m || !y || m < 1 || m > 12 || d < 1 || d > 31) return;
    const newDate = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    emitChange(newDate, null);
  };

  // Time helpers
  const incrementHour = (dir) => {
    const newH = (hour + dir + 24) % 24;
    setHour(newH);
    const newTime = `${String(newH).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    if (dateStr) emitChange(null, newTime);
  };

  const incrementMinute = (dir) => {
    let newM = minute + dir * 5;
    if (newM >= 60) newM = 0;
    if (newM < 0) newM = 55;
    setMinute(newM);
    const newTime = `${String(hour).padStart(2, '0')}:${String(newM).padStart(2, '0')}`;
    if (dateStr) emitChange(null, newTime);
  };

  const toggleAmPm = () => {
    const newH = hour >= 12 ? hour - 12 : hour + 12;
    setHour(newH);
    const newTime = `${String(newH).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    if (dateStr) emitChange(null, newTime);
  };

  const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  const ampm = hour >= 12 ? 'PM' : 'AM';

  const startEditHour = () => {
    setEditHourVal(String(h12));
    setEditingHour(true);
  };

  const applyEditHour = () => {
    setEditingHour(false);
    const parsed = parseInt(editHourVal);
    if (!parsed || parsed < 1 || parsed > 12) return;
    // Convert 12h input to 24h based on current AM/PM
    let newH;
    if (ampm === 'AM') {
      newH = parsed === 12 ? 0 : parsed;
    } else {
      newH = parsed === 12 ? 12 : parsed + 12;
    }
    setHour(newH);
    const newTime = `${String(newH).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    if (dateStr) emitChange(null, newTime);
  };

  const startEditMinute = () => {
    setEditMinuteVal(String(minute).padStart(2, '0'));
    setEditingMinute(true);
  };

  const applyEditMinute = () => {
    setEditingMinute(false);
    const parsed = parseInt(editMinuteVal);
    if (isNaN(parsed) || parsed < 0 || parsed > 59) return;
    setMinute(parsed);
    const newTime = `${String(hour).padStart(2, '0')}:${String(parsed).padStart(2, '0')}`;
    if (dateStr) emitChange(null, newTime);
  };

  // Check if selected datetime is in the past
  const isPast = useMemo(() => {
    if (!dateStr || !timeStr || !minParsed) return false;
    const selected = new Date(`${dateStr}T${timeStr}`);
    return !isNaN(selected.getTime()) && selected < minParsed;
  }, [dateStr, timeStr, minParsed]);

  // Notify parent of validity
  useEffect(() => {
    if (onValidChange) onValidChange(!isPast);
  }, [isPast, onValidChange]);

  // UTC display
  const utcDisplay = useMemo(() => {
    if (!dateStr || !timeStr) return null;
    const local = new Date(`${dateStr}T${timeStr}`);
    if (isNaN(local.getTime())) return null;
    return formatDate(local, {
      timeZone: 'UTC',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }) + ' UTC';
  }, [dateStr, timeStr, i18n.language]);

  return (
    <div className="schedule-picker">
      <div className="schedule-picker__layout">
        {/* Left: Calendar + manual date */}
        <div className="schedule-picker__left">
          <div className="schedule-picker__calendar">
            <div className="calendar-header">
              <button type="button" className="nav-btn" onClick={prevMonth} disabled={!canGoPrev}>
                <IoChevronBack size={16} />
              </button>
              <span className="month-year">{formatDate(new Date(viewYear, viewMonth, 1), { month: 'long', year: 'numeric' })}</span>
              <span className="month-year second-month-label">{formatDate(new Date(nextMonthYear, nextMonthIdx, 1), { month: 'long', year: 'numeric' })}</span>
              <button type="button" className="nav-btn" onClick={nextMonth} disabled={!canGoNext}>
                <IoChevronForward size={16} />
              </button>
            </div>
            <div className="calendar-months">
              <table className="calendar-grid">
                <thead>
                  <tr>
                    {DAY_NAMES.map(d => <th key={d}>{t(`studio.schedule.days.${d}`)}</th>)}
                  </tr>
                </thead>
                <tbody>{calendarDays}</tbody>
              </table>
              <table className="calendar-grid second-month">
                <thead>
                  <tr>
                    {DAY_NAMES.map(d => <th key={d}>{t(`studio.schedule.days.${d}`)}</th>)}
                  </tr>
                </thead>
                <tbody>{calendarDays2}</tbody>
              </table>
            </div>
          </div>

          <div className="schedule-picker__manual-date">
            <label>{t('studio.schedule.manualDate')}</label>
            <div className="manual-date-inputs">
              <input
                type="text"
                inputMode="numeric"
                placeholder={t('studio.schedule.dd')}
                maxLength={2}
                value={manualDay}
                onChange={(e) => setManualDay(e.target.value.replace(/\D/g, ''))}
                onBlur={applyManualDate}
                onKeyDown={(e) => { if (e.key === 'Enter') applyManualDate(); }}
              />
              <span className="date-sep">.</span>
              <input
                type="text"
                inputMode="numeric"
                placeholder={t('studio.schedule.mm')}
                maxLength={2}
                value={manualMonth}
                onChange={(e) => setManualMonth(e.target.value.replace(/\D/g, ''))}
                onBlur={applyManualDate}
                onKeyDown={(e) => { if (e.key === 'Enter') applyManualDate(); }}
              />
              <span className="date-sep">.</span>
              <input
                type="text"
                inputMode="numeric"
                placeholder={t('studio.schedule.yyyy')}
                maxLength={4}
                value={manualYear}
                onChange={(e) => setManualYear(e.target.value.replace(/\D/g, ''))}
                onBlur={applyManualDate}
                onKeyDown={(e) => { if (e.key === 'Enter') applyManualDate(); }}
              />
            </div>
          </div>
        </div>

        {/* Right: Time picker */}
        <div className="schedule-picker__right">
          <div className="schedule-picker__time-picker">
            <div className="time-columns">
              <div className="time-col">
                <button type="button" className="spin-btn" onClick={() => incrementHour(1)}>
                  <IoChevronForward size={16} style={{ transform: 'rotate(-90deg)' }} />
                </button>
                {editingHour ? (
                  <input
                    className="time-value time-input"
                    type="text"
                    inputMode="numeric"
                    maxLength={2}
                    value={editHourVal}
                    onChange={(e) => setEditHourVal(e.target.value.replace(/\D/g, ''))}
                    onBlur={applyEditHour}
                    onKeyDown={(e) => { if (e.key === 'Enter') applyEditHour(); }}
                    autoFocus
                  />
                ) : (
                  <span className="time-value" onClick={startEditHour}>{String(h12).padStart(2, '0')}</span>
                )}
                <button type="button" className="spin-btn" onClick={() => incrementHour(-1)}>
                  <IoChevronForward size={16} style={{ transform: 'rotate(90deg)' }} />
                </button>
              </div>
              <span className="time-sep">:</span>
              <div className="time-col">
                <button type="button" className="spin-btn" onClick={() => incrementMinute(1)}>
                  <IoChevronForward size={16} style={{ transform: 'rotate(-90deg)' }} />
                </button>
                {editingMinute ? (
                  <input
                    className="time-value time-input"
                    type="text"
                    inputMode="numeric"
                    maxLength={2}
                    value={editMinuteVal}
                    onChange={(e) => setEditMinuteVal(e.target.value.replace(/\D/g, ''))}
                    onBlur={applyEditMinute}
                    onKeyDown={(e) => { if (e.key === 'Enter') applyEditMinute(); }}
                    autoFocus
                  />
                ) : (
                  <span className="time-value" onClick={startEditMinute}>{String(minute).padStart(2, '0')}</span>
                )}
                <button type="button" className="spin-btn" onClick={() => incrementMinute(-1)}>
                  <IoChevronForward size={16} style={{ transform: 'rotate(90deg)' }} />
                </button>
              </div>
              <div className="time-col ampm-col">
                <button type="button" className="ampm-btn" onClick={toggleAmPm}>
                  {ampm === 'AM' ? t('studio.schedule.am') : t('studio.schedule.pm')}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Past warning */}
      {isPast && (
        <div className="schedule-picker__past-warning">
          {t('studio.schedule.pastWarning')}
        </div>
      )}

      {/* UTC info underneath */}
      {utcDisplay && !isPast && (
        <div className="schedule-picker__utc-info">
          <IoGlobeOutline size={14} />
          <span>{t('studio.schedule.publishAt', { when: utcDisplay })}</span>
        </div>
      )}
    </div>
  );
}

export default SchedulePicker;
