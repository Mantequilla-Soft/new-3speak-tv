import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../lib/store';
import { fetchPremiereChat, sendPremiereChat, removePremiereChat, mergeChat } from '../../lib/premieres';
import { clockText } from '../../lib/sliderKeys';
import { toastIn } from '../../utils/toast';
import { Button, IconButton } from '../v2/ui';
import './Premiere.scss';

const toast = toastIn('Chat');
export const POLL_MS = 3000;

/**
 * A premiere's chat, from the checker (routes/premieres.js), never Hive.
 *
 *  live    while the premiere runs: polled every few seconds, newest at the
 *          bottom, a composer for a signed-in viewer. Drawn like a stream's
 *          live chat (the stream-chat look: the name in bold cyan, then the
 *          text on one line).
 *  replay  afterwards ("Premiere chat"): every message with the second of the
 *          video it was sent at; the time seeks there.
 *
 * Its author and the creator can take a message down.
 */
export default function PremiereChat({ owner, permlink, live, onSeek = null }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const authenticated = useAppStore((s) => s.authenticated);
  const viewer = useAppStore((s) => s.user);
  const user = authenticated ? viewer : null;
  const [messages, setMessages] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef(null);
  const lastAtRef = useRef(0);
  const stickRef = useRef(true);

  useEffect(() => {
    let alive = true;
    let timer = null;
    lastAtRef.current = 0;
    setMessages([]);
    setLoaded(false);
    const poll = async () => {
      try {
        const got = await fetchPremiereChat(owner, permlink, lastAtRef.current);
        if (!alive) return;
        setMessages((held) => {
          const next = mergeChat(held, got);
          const last = next[next.length - 1];
          if (last) lastAtRef.current = Math.max(lastAtRef.current, Date.parse(last.at));
          return next;
        });
        setLoaded(true);
      } catch { /* the next poll tries again */ }
      // Not while the tab is hidden: it catches up on the next one.
      if (alive && live) timer = setTimeout(poll, document.hidden ? POLL_MS * 4 : POLL_MS);
    };
    poll();
    return () => { alive = false; clearTimeout(timer); };
  }, [owner, permlink, live]);

  // Live: keep the newest in view unless the viewer scrolled up to read.
  useEffect(() => {
    const el = listRef.current;
    if (live && el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages, live]);

  const send = async (e) => {
    e.preventDefault();
    const body = text.trim();
    if (!body || sending || !user) return;
    setSending(true);
    try {
      const m = await sendPremiereChat(user, owner, permlink, body);
      setText('');
      stickRef.current = true;
      if (m) setMessages((held) => mergeChat(held, { messages: [m] }));
    } catch (err) {
      toast.error(err?.status === 429 ? t('premieres.chat.slowDown') : err?.status === 409 ? t('premieres.chat.closed') : t('premieres.chat.sendFailed'));
    } finally {
      setSending(false);
    }
  };

  const remove = async (m) => {
    try {
      await removePremiereChat(user, owner, permlink, m.id);
      setMessages((held) => mergeChat(held, { removed: [m.id] }));
    } catch {
      toast.error(t('premieres.chat.removeFailed'));
    }
  };

  const canRemove = (m) => !!user && (m.user === user || user === owner);

  return (
    <div className={`premiere-chat ${live ? 'is-live' : 'is-replay'}`}>
      <div
        className="hh-chat__messages premiere-chat__list"
        ref={listRef}
        role="log"
        aria-live={live ? 'polite' : 'off'}
        aria-label={live ? t('premieres.chat.liveLabel') : t('premieres.chat.replayLabel')}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {loaded && !messages.length && (
          <p className="hh-chat__empty">{live ? t('premieres.chat.emptyLive') : t('premieres.chat.emptyReplay')}</p>
        )}
        {messages.map((m) => (
          <div className="hh-chat__msg premiere-chat__msg" key={m.id}>
            {!live && (
              onSeek ? (
                <button type="button" className="premiere-chat__time num" onClick={() => onSeek(m.offset)} aria-label={t('premieres.chat.seekTo', { time: clockText(m.offset) })}>
                  {clockText(m.offset)}
                </button>
              ) : <span className="premiere-chat__time num">{clockText(m.offset)}</span>
            )}
            <span className="hh-chat__msg-body">
              <span className="hh-chat__msg-name">{m.user}</span>
              <span className="hh-chat__msg-text">{m.text}</span>
            </span>
            {canRemove(m) && (
              <IconButton icon="delete" size={32} variant="ghost" className="premiere-chat__remove" label={t('premieres.chat.remove')} onClick={() => remove(m)} />
            )}
          </div>
        ))}
      </div>
      {live && (user ? (
        <form className="hh-chat__input-row premiere-chat__compose" onSubmit={send}>
          <input
            className="hh-chat__input"
            value={text}
            maxLength={200}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('premieres.chat.placeholder')}
            aria-label={t('premieres.chat.placeholder')}
          />
          <IconButton type="submit" icon="send" size={44} round variant="primary" label={t('premieres.chat.send')} disabled={!text.trim() || sending} />
        </form>
      ) : (
        <div className="hh-chat__guest-prompt premiere-chat__guest">
          <span>{t('premieres.chat.signIn')}</span>
          <Button variant="secondary" size={36} trailing="login" onClick={() => navigate('/login')}>{t('common.actions.login')}</Button>
        </div>
      ))}
    </div>
  );
}
