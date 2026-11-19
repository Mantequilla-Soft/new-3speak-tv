import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePolls, PollCardView, isPollFinished } from '@snapie/hangouts-react';
import { Icon } from '../v2/ui';
import './FloatingStreamPoll.scss';

// The running poll or prediction over the phone stream player, on its own
// layer above the video (the chat overlay lets taps fall through to the
// video, so a card inside it could not be voted on). Once the viewer voted or
// staked it folds into a chip at the top of the screen; the chip opens it
// again. Card and chip each move by dragging and keep their spot on this
// device. A finished poll leaves: its results are a message in the chat.
const CARD_KEY = '3speak-stream-poll-pos';
const CHIP_KEY = '3speak-stream-poll-chip-pos';
// Room kept clear at the bottom for the docked chat composer.
const BOTTOM_CLEAR = 72;
// A press that moves less than this is a tap, not a drag.
const TAP_SLOP = 6;

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));

function readPos(key) {
  try {
    const p = JSON.parse(localStorage.getItem(key) || 'null');
    if (Number.isFinite(p?.x) && Number.isFinite(p?.y)) return { x: p.x, y: p.y };
  } catch { /* no saved spot */ }
  return { x: 0, y: 0 };
}

/** How far the box may still move each way inside its positioned parent. */
function room(box, { x, y }) {
  const area = box?.offsetParent;
  if (!area) return null;
  const b = box.getBoundingClientRect();
  const a = area.getBoundingClientRect();
  return {
    minX: x - (b.left - a.left), maxX: x + (a.right - b.right),
    minY: y - (b.top - a.top), maxY: y + (a.bottom - BOTTOM_CLEAR - b.bottom),
  };
}

/**
 * A box moved by dragging (translate from where CSS puts it), kept inside its
 * positioned parent, the spot saved under `key`. `onTap` runs for a press that
 * did not move. The pager on the player listens natively, so touches on the
 * box are stopped natively too: a drag is never a swipe to the next stream.
 */
function useDraggable(key, active, onTap) {
  const [pos, setPos] = useState(() => readPos(key));
  const posRef = useRef(pos);
  posRef.current = pos;
  const boxRef = useRef(null);
  const drag = useRef(null);

  const ref = useCallback((el) => {
    const stop = (e) => e.stopPropagation();
    const prev = boxRef.current;
    if (prev === el) return;
    if (prev) for (const type of ['touchstart', 'touchend', 'wheel']) prev.removeEventListener(type, stop);
    boxRef.current = el;
    if (el) for (const type of ['touchstart', 'touchend', 'wheel']) el.addEventListener(type, stop, { passive: true });
  }, []);

  // A spot saved on a bigger screen, or before the phone turned, is pulled in.
  useEffect(() => {
    if (!active) return undefined;
    const fit = () => {
      const r = room(boxRef.current, posRef.current);
      if (!r) return;
      const { x, y } = posRef.current;
      const nx = clamp(x, r.minX, r.maxX);
      const ny = clamp(y, r.minY, r.maxY);
      if (nx !== x || ny !== y) setPos({ x: nx, y: ny });
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [active]);

  const handlers = {
    onPointerDown: (e) => {
      e.stopPropagation();
      const r = room(boxRef.current, posRef.current);
      if (!r) return;
      drag.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, ...posRef.current, ...r, moved: false };
      e.currentTarget.setPointerCapture?.(e.pointerId);
    },
    onPointerMove: (e) => {
      const d = drag.current;
      if (!d || d.id !== e.pointerId) return;
      e.stopPropagation();
      const dx = e.clientX - d.sx;
      const dy = e.clientY - d.sy;
      if (!d.moved && Math.hypot(dx, dy) < TAP_SLOP) return;
      d.moved = true;
      setPos({ x: clamp(d.x + dx, d.minX, d.maxX), y: clamp(d.y + dy, d.minY, d.maxY) });
    },
    onPointerUp: (e) => {
      const d = drag.current;
      if (!d || d.id !== e.pointerId) return;
      drag.current = null;
      if (!d.moved) { onTap?.(); return; }
      try { localStorage.setItem(key, JSON.stringify(posRef.current)); } catch { /* this visit only */ }
    },
    onPointerCancel: () => { drag.current = null; },
  };
  return { ref, style: { transform: `translate(${pos.x}px, ${pos.y}px)` }, handlers };
}

function useNow(on) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [on]);
  return now;
}

const clockLabel = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export default function FloatingStreamPoll({ roomName, labels }) {
  const { t } = useTranslation();
  const polls = usePolls(roomName);
  const poll = polls.poll;
  const pollId = poll?.id ?? null;
  const open = !!poll && poll.status === 'open';
  const now = useNow(open);
  const voted = polls.myVote !== null || !!polls.myStake;

  // Folded to the chip: the viewer closed it, or voted. Opening it again after
  // the vote keeps it open; a new poll starts open.
  const [closedId, setClosedId] = useState(null);
  const [openedId, setOpenedId] = useState(null);
  const unfold = () => { setClosedId(null); setOpenedId(pollId); };
  const fold = () => { setOpenedId(null); setClosedId(pollId); };

  const live = !!poll && !isPollFinished(poll);
  const folded = live && (closedId === pollId || (voted && openedId !== pollId));
  const card = useDraggable(CARD_KEY, live && !folded);
  const chip = useDraggable(CHIP_KEY, folded, unfold);

  if (!live) return null;
  const prediction = poll.kind === 'prediction';
  const badge = (prediction ? labels?.predictionBadge : labels?.pollBadge)
    || t(prediction ? 'liveInteract.labels.predictionBadge' : 'liveInteract.labels.pollBadge');

  if (folded) {
    return (
      <button
        ref={chip.ref}
        type="button"
        className="ws-poll-chip"
        style={chip.style}
        {...chip.handlers}
        // A tap opens it (pointer up, in the drag hook); this is the keyboard.
        onClick={(e) => { e.stopPropagation(); if (e.detail === 0) unfold(); }}
        aria-label={t(prediction ? 'misc.watchStream.predictionShow' : 'misc.watchStream.pollShow')}
        title={t(prediction ? 'misc.watchStream.predictionShow' : 'misc.watchStream.pollShow')}
      >
        <Icon name={prediction ? 'trending_up' : 'ballot'} size={18} />
        <span>{badge}</span>
        {voted && <Icon name="check" size={16} />}
        {open && <span className="num">{clockLabel(poll.endsAt - now)}</span>}
      </button>
    );
  }

  return (
    <div ref={card.ref} className="ws-poll" style={card.style} onClick={(e) => e.stopPropagation()}>
      <div className="ws-poll__bar">
        <div
          className="ws-poll__handle"
          {...card.handlers}
          aria-label={t('misc.watchStream.pollMove')}
          title={t('misc.watchStream.pollMove')}
        >
          <Icon name="drag_indicator" size={18} />
        </div>
        <button
          type="button"
          className="ws-poll__close"
          onClick={fold}
          aria-label={t('misc.watchStream.pollHide')}
          title={t('misc.watchStream.pollHide')}
        >
          <Icon name="close" size={18} />
        </button>
      </div>
      <PollCardView
        poll={poll}
        now={now}
        labels={labels}
        myVote={polls.myVote}
        myStake={polls.myStake}
        balance={polls.balance}
        canVote={polls.isAuthenticated}
        busy={polls.busy}
        error={polls.error}
        onVote={(o) => { void polls.vote(o); }}
        onStake={(o, a) => { void polls.stake(o, a); }}
      />
    </div>
  );
}
