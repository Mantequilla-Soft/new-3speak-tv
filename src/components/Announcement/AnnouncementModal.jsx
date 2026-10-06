import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { IoOpenOutline } from 'react-icons/io5';
import { useAppStore } from '../../lib/store';
import {
  readSeenAnnouncement,
  markAnnouncementSeen,
  fetchAnnouncements,
  sendAnnouncementReply,
} from '../../lib/announcements';
import mark from '../../assets/image/3S_mark.svg';
import './AnnouncementModal.scss';

// Routes the popup must never cover. /advertise is a landing page for people from
// outside 3Speak (same reason as the changelog popup), and /egress-stream is
// opened by the stream recorder, so anything on it ends up in the recording.
const SILENT_ROUTES = ['/advertise', '/egress-stream'];
const isSilentRoute = (pathname) => {
  const p = String(pathname || '').toLowerCase();
  return SILENT_ROUTES.some((r) => p === r || p.startsWith(`${r}/`));
};

// Crawlers and automated browsers (search engines that run the app, the stream
// recorder) would only ever see the popup, never close it.
const isAutomated = () =>
  typeof navigator !== 'undefined' &&
  (navigator.webdriver || /bot|crawl|spider|headless|lighthouse/i.test(navigator.userAgent || ''));

const MAX_REPLY = 2000;

// Logged-in users only. Shows what they have not seen yet, oldest first: the
// newest announcement addressed to them and the newest general one, at most one
// of each, one after the other.
export default function AnnouncementModal() {
  const { pathname } = useLocation();
  const silenced = isSilentRoute(pathname);
  const authenticated = useAppStore((s) => s.authenticated);
  const authChecked = useAppStore((s) => s.authChecked);
  const user = useAppStore((s) => s.user);
  // The "what's new" popup goes first; this one waits until that is closed.
  const changelogPending = useAppStore((s) => !!s.appUpdatedFrom);
  const [queue, setQueue] = useState([]);

  useEffect(() => {
    if (!authChecked || !authenticated || isAutomated()) return;
    const seen = readSeenAnnouncement();
    if (seen === null) return;
    let alive = true;
    fetchAnnouncements(user)
      .then(({ announcement, personal }) => {
        if (!alive) return;
        const next = [];
        if (personal && user && personal.number > readSeenAnnouncement(user)) next.push({ ...personal, personalFor: user });
        if (announcement && announcement.number > seen) next.push(announcement);
        setQueue(next.sort((a, b) => a.number - b.number));
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [authChecked, authenticated, user]);

  // Filtered here rather than trusted from the fetch: after an account switch the
  // old account's personal message must not show for a moment to the new one.
  const current = queue.find((a) => !a.personalFor || a.personalFor === user);
  const visible = !!current && authenticated && !silenced && !changelogPending;

  // Lock the page behind the popup, only while it is actually on screen.
  useEffect(() => {
    if (!visible) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [visible]);

  if (!visible) return null;

  // The only way out. Clicking the backdrop or pressing Escape does nothing on purpose.
  const close = () => {
    markAnnouncementSeen(current.number, current.personalFor || null);
    setQueue((q) => q.filter((a) => a.number !== current.number));
  };

  // Keyed by number, so the next queued announcement starts with a fresh reply box.
  return <AnnouncementCard key={current.number} announcement={current} user={user} onClose={close} />;
}

function AnnouncementCard({ announcement, user, onClose }) {
  const { t } = useTranslation();
  const [imageFailed, setImageFailed] = useState(false);
  const [reply, setReply] = useState('');
  const [sendState, setSendState] = useState('idle'); // idle | sending | sent | error | throttled
  const { number, message, link, linkText, imagePath, canRespond, personalFor } = announcement;

  const send = async (e) => {
    e.preventDefault();
    const text = reply.trim();
    if (!text || sendState === 'sending') return;
    setSendState('sending');
    try {
      await sendAnnouncementReply(number, text, user);
      setSendState('sent');
    } catch (err) {
      setSendState(err.status === 429 ? 'throttled' : 'error');
    }
  };

  return (
    <div className="announcement-overlay">
      <div className="announcement-modal" role="dialog" aria-modal="true" aria-label={t('announcement.ariaLabel')}>
        <div className="announcement-header">
          <img className="announcement-logo" src={mark} alt="3Speak" />
          {personalFor && <span className="announcement-personal">{t('announcement.personalLabel')}</span>}
        </div>

        {imagePath && !imageFailed && (
          <img className="announcement-image" src={imagePath} alt="" onError={() => setImageFailed(true)} />
        )}

        <p className="announcement-message">{message}</p>

        {link && (
          // A new tab keeps the popup here until Close. Opening it counts as seen,
          // so a 3Speak page opened by the link does not show the popup again.
          <a
            className="announcement-link"
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => markAnnouncementSeen(number, personalFor || null)}
          >
            <span>{linkText || t('announcement.linkFallback')}</span>
            <IoOpenOutline />
          </a>
        )}

        {canRespond && (
          sendState === 'sent' ? (
            <p className="announcement-reply-done">{t('announcement.replySent')}</p>
          ) : (
            <form className="announcement-reply" onSubmit={send}>
              <label htmlFor="announcement-reply-text">{t('announcement.replyLabel')}</label>
              <textarea
                id="announcement-reply-text"
                value={reply}
                onChange={(e) => { setReply(e.target.value); if (sendState !== 'sending') setSendState('idle'); }}
                placeholder={t('announcement.replyPlaceholder')}
                maxLength={MAX_REPLY}
                rows={3}
              />
              <div className="announcement-reply-row">
                <span className="announcement-reply-as">
                  {user ? t('announcement.replyAs', { user }) : t('announcement.replyNoName')}
                </span>
                <button type="submit" className="announcement-send" disabled={!reply.trim() || sendState === 'sending'}>
                  {sendState === 'sending' ? t('announcement.sending') : t('common.actions.send')}
                </button>
              </div>
              {sendState === 'error' && <p className="announcement-reply-error">{t('announcement.replyFailed')}</p>}
              {sendState === 'throttled' && <p className="announcement-reply-error">{t('announcement.replyTooMany')}</p>}
            </form>
          )
        )}

        <button type="button" className="announcement-close" onClick={onClose}>
          {t('common.actions.close')}
        </button>
      </div>
    </div>
  );
}
