import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { clockText } from '../../lib/sliderKeys';
import {
  currentIndex, fetchChatReplay, fetchStreamPolls, pollOutcome, replayTimeline,
} from '../../lib/streamChatReplay';
import { batchCheckFlags } from '../../utils/hiddenCreators';
import { Button } from '../v2/ui';
import '../Premiere/Premiere.scss';
import './StreamChatReplay.scss';

/** After the viewer scrolls the list themselves, it stops following the video this long. */
const HANDS_OFF_MS = 6000;

/**
 * A finished stream's live chat beside its VOD (the premiere replay's look):
 * every line at the second it was written, the polls the host ran in between,
 * and the list follows the video: what was said up to now is in full colour
 * and scrolled into view, what comes later is dimmed. Times seek.
 */
export default function StreamChatReplay({ author, permlink, currentTime = 0, onSeek = null }) {
  const { t } = useTranslation();
  const [state, setState] = useState({ loading: true, lines: [], polls: [] });
  const listRef = useRef(null);
  const [handsOff, setHandsOff] = useState(false);

  useEffect(() => {
    let alive = true;
    setState({ loading: true, lines: [], polls: [] });
    (async () => {
      const [lines, polls] = await Promise.all([
        fetchChatReplay(author, permlink).catch(() => []),
        fetchStreamPolls(permlink).catch(() => []),
      ]);
      // Same rule as the comments: hidden creators and muted accounts stay out.
      let shown = lines;
      if (lines.length) {
        try {
          const { hidden, muted } = await batchCheckFlags(lines.map((l) => l.user));
          shown = lines.filter((l) => !hidden.has(l.user.toLowerCase()) && !muted.has(l.user.toLowerCase()));
        } catch { /* fail open */ }
      }
      if (alive) setState({ loading: false, lines: shown, polls });
    })();
    return () => { alive = false; };
  }, [author, permlink]);

  const items = useMemo(() => replayTimeline(state.lines, state.polls), [state.lines, state.polls]);
  const now = Math.floor(currentTime || 0);
  const at = currentIndex(items, now);

  // Follow the video: keep the newest line said so far at the bottom of the
  // list, unless the viewer is reading somewhere else right now.
  useEffect(() => {
    const el = listRef.current;
    if (!el || at < 0 || handsOff) return;
    const node = el.querySelector(`[data-idx="${at}"]`);
    if (!node) return;
    const top = node.offsetTop + node.offsetHeight - el.clientHeight + 8;
    el.scrollTop = Math.max(0, top);
  }, [at, handsOff]);

  useEffect(() => {
    if (!handsOff) return undefined;
    const id = setTimeout(() => setHandsOff(false), HANDS_OFF_MS);
    return () => clearTimeout(id);
  }, [handsOff]);

  const seek = (sec) => { setHandsOff(false); onSeek?.(sec); };
  const time = (sec) => (onSeek ? (
    <button type="button" className="premiere-chat__time num" onClick={() => seek(sec)} aria-label={t('liveInteract.replay.seekTo', { time: clockText(sec) })}>
      {clockText(sec)}
    </button>
  ) : <span className="premiere-chat__time num">{clockText(sec)}</span>);

  return (
    <div className="premiere-chat is-replay stream-replay">
      <div
        className="hh-chat__messages premiere-chat__list"
        ref={listRef}
        role="log"
        aria-live="off"
        aria-label={t('liveInteract.replay.label')}
        aria-busy={state.loading}
        // A wheel or a touch is the viewer reading; programmatic scrolls are not.
        onWheel={() => setHandsOff(true)}
        onTouchMove={() => setHandsOff(true)}
      >
        {state.loading && <p className="hh-chat__empty">{t('liveInteract.replay.loading')}</p>}
        {!state.loading && items.length === 0 && <p className="hh-chat__empty">{t('liveInteract.replay.empty')}</p>}
        {items.map((item, i) => {
          const later = i > at;
          if (item.type === 'pollCard') {
            const p = item.poll;
            const win = pollOutcome(p);
            const total = p.total ?? 0;
            return (
              <div key={item.key} data-idx={i} className={`hh-chat__msg premiere-chat__msg stream-replay__poll${later ? ' is-later' : ''}`}>
                {time(item.offset)}
                <span className="hh-chat__msg-body">
                  <span className="stream-replay__poll-kind">{p.kind === 'prediction' ? t('liveInteract.replay.prediction') : t('liveInteract.replay.poll')}</span>
                  <span className="hh-chat__msg-text stream-replay__poll-q">{p.question}</span>
                  <span className="stream-replay__poll-result">
                    {win !== null && p.options[win] ? t('liveInteract.replay.won', { option: p.options[win].label }) : null}
                    {win !== null && p.options[win] ? ' · ' : null}
                    {t('liveInteract.replay.votes', { count: total })}
                  </span>
                </span>
              </div>
            );
          }
          const l = item.line;
          return (
            <div key={item.key} data-idx={i} className={`hh-chat__msg premiere-chat__msg${later ? ' is-later' : ''}`}>
              {time(l.offset)}
              <span className="hh-chat__msg-body">
                <span className="hh-chat__msg-name">{l.user}</span>
                <span className="hh-chat__msg-text">{l.text}</span>
              </span>
            </div>
          );
        })}
      </div>
      {handsOff && at >= 0 && (
        <div className="stream-replay__follow">
          <Button variant="secondary" size={32} icon="arrow_downward" onClick={() => setHandsOff(false)}>{t('liveInteract.replay.follow')}</Button>
        </div>
      )}
    </div>
  );
}
