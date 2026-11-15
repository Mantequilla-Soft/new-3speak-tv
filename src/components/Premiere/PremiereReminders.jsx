import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toastIn } from '../../utils/toast';
import { watchPath } from '../../utils/urls';
import { useMyPremiereReminders } from './usePremiereReminders';

const toast = toastIn('Video');
// Started longer ago than this, a reminder is old news and is not shown.
export const FRESH_MS = 15 * 60 * 1000;
const SEEN_KEY = 'premiere-reminders-shown';

function seen() {
  try { return new Set(JSON.parse(sessionStorage.getItem(SEEN_KEY) || '[]')); } catch { return new Set(); }
}
function markSeen(key) {
  const s = seen();
  s.add(key);
  try { sessionStorage.setItem(SEEN_KEY, JSON.stringify([...s].slice(-100))); } catch { /* storage off */ }
}

/**
 * The in-app banner for "Notify me": while the site is open, a premiere the
 * viewer asked to be reminded of shows a toast with Watch when it starts (and
 * once on opening the site, if it started in the last few minutes). Mounted once,
 * app wide; renders nothing. Delivery anywhere else (notifications, push) is the
 * checker's to add, from services/premieres.js dueReminders().
 */
export default function PremiereReminders() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { reminders } = useMyPremiereReminders({ refetchInterval: 5 * 60 * 1000 });
  const timers = useRef([]);

  useEffect(() => {
    const show = (p) => {
      const key = `${p.owner}/${p.permlink}@${p.startAt}`;
      if (seen().has(key)) return;
      markSeen(key);
      toast.info(t('premieres.startedToast', { title: p.title || p.permlink, owner: p.owner }), {
        duration: 15000,
        action: { label: t('premieres.watch'), onClick: () => navigate(watchPath(p.owner, p.permlink)) },
      });
    };
    timers.current.forEach(clearTimeout);
    timers.current = [];
    const now = Date.now();
    for (const p of reminders) {
      const start = Date.parse(p.startAt);
      if (!Number.isFinite(start)) continue;
      if (start <= now) {
        if (now - start < FRESH_MS) show(p);
      } else if (start - now < 2 ** 31 - 1) {
        timers.current.push(setTimeout(() => show(p), start - now));
      }
    }
    return () => timers.current.forEach(clearTimeout);
  }, [reminders, navigate, t]);

  return null;
}
