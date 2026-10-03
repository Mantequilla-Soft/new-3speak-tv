import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import utc from 'dayjs/plugin/utc';
import { useTranslation } from 'react-i18next';
import { formatTimeAgo } from '../../i18n';
import './TimeAgo.scss';

dayjs.extend(relativeTime);
dayjs.extend(utc);

// Ensure date is treated as UTC (Hive dates have no "Z" suffix)
function toUtc(date) {
  if (dayjs.isDayjs(date)) return date.isUTC() ? date : date.utc();
  const s = typeof date === 'string' ? date : '';
  // If no timezone indicator, treat as UTC
  if (s && !/Z$/.test(s) && !/[+-]\d{2}:\d{2}$/.test(s)) {
    return dayjs.utc(date);
  }
  return dayjs(date).utc();
}

// Locale-aware relative time ("3d ago" / "3 days ago" in English). The dates are
// normalised to UTC first, then handed to Intl via formatTimeAgo.
const shortTime = (d) => formatTimeAgo(d.toDate(), { style: 'narrow' });
const longTime = (d) => formatTimeAgo(d.toDate());

function TimeAgo({ date, unix, short }) {
  // Subscribes to language changes so the label re-renders in the new language.
  useTranslation();
  const d = unix ? dayjs.unix(date).utc() : toUtc(date);
  if (short) return <span>{shortTime(d)}</span>;
  return (
    <span className="time-ago-wrap">
      <span className="time-long">{longTime(d)}</span>
      <span className="time-short">{shortTime(d)}</span>
    </span>
  );
}

export default TimeAgo;
