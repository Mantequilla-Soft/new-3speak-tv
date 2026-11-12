import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePortalDoc } from '../utils/portalDocument';
import { emojiSuggestions, convertClosedShortcode, insertPickedEmoji, loadEmojiData, emojiDataReady } from '../lib/emojiShortcodes';
import './useEmojiShortcodes.scss';

const GAP = 6;
const EDGE = 8;
const MAX_WIDTH = 320;

/**
 * `:shortcode:` emojis in a comment box, the way the chat does it
 * (lib/emojiShortcodes.js): ":" opens a list, ":fi" filters it, ↑/↓ + Enter/Tab
 * pick, Esc closes, and ":fire:" turns into 🔥 as the second ":" is typed.
 *
 *   const emoji = useEmojiShortcodes(ref, value, setValue);
 *   <textarea ref={ref} value={value}
 *     onChange={(e) => setValue(emoji.change(e))}
 *     onKeyDown={(e) => { if (emoji.keyDown(e)) return; ...own keys }}
 *     onBlur={emoji.blur} />
 *   {emoji.popup}
 *
 * `change(e)` returns the value to store (the emoji already swapped in). The list
 * renders in a portal next to the textarea, so a panel's overflow never clips it.
 */
export default function useEmojiShortcodes(ref, value, setValue) {
  const doc = usePortalDoc();
  const [ta, setTa] = useState(null); // { items, index }
  const [pos, setPos] = useState(null);
  const listRef = useRef(null);

  const placeCaret = useCallback((cursor) => {
    requestAnimationFrame(() => {
      const el = ref.current;
      if (el) { el.focus(); el.setSelectionRange(cursor, cursor); }
    });
  }, [ref]);

  // The emoji names load on demand (lib/emojiShortcodes.js): fetch them when the
  // box gets focus, so they are here before the first ":" is typed.
  useEffect(() => {
    const el = ref.current;
    if (!el || emojiDataReady()) return undefined;
    const go = () => { loadEmojiData().catch(() => {}); };
    el.addEventListener('focus', go, { once: true });
    return () => el.removeEventListener('focus', go);
  }, [ref]);

  const change = useCallback((e) => {
    const val = e.target.value;
    const cursor = e.target.selectionStart ?? val.length;
    if (!emojiDataReady()) {
      // Typed before the names arrived: show the list for what is in the box then.
      loadEmojiData().then(() => {
        const el = ref.current;
        if (!el) return;
        const items = emojiSuggestions(el.value, el.selectionStart ?? el.value.length);
        setTa(items ? { items, index: 0 } : null);
      }).catch(() => {});
    }
    const converted = convertClosedShortcode(val, cursor);
    if (converted) {
      setTa(null);
      placeCaret(converted.cursor);
      return converted.value;
    }
    const items = emojiSuggestions(val, cursor);
    setTa(items ? { items, index: 0 } : null);
    return val;
  }, [placeCaret, ref]);

  const pick = useCallback((emoji) => {
    const el = ref.current;
    const cursor = el ? el.selectionStart : value.length;
    const picked = insertPickedEmoji(value, cursor, emoji);
    setTa(null);
    if (!picked) return;
    setValue(picked.value);
    placeCaret(picked.cursor);
  }, [ref, value, setValue, placeCaret]);

  // True when the key was the list's (the caller then skips its own handling).
  const keyDown = useCallback((e) => {
    if (!ta) return false;
    if (e.key === 'ArrowDown') setTa((t) => ({ ...t, index: (t.index + 1) % t.items.length }));
    else if (e.key === 'ArrowUp') setTa((t) => ({ ...t, index: (t.index - 1 + t.items.length) % t.items.length }));
    else if (e.key === 'Enter' || e.key === 'Tab') pick(ta.items[ta.index].emoji);
    else if (e.key === 'Escape') { e.stopPropagation(); setTa(null); }
    else return false;
    e.preventDefault();
    return true;
  }, [ta, pick]);

  const blur = useCallback(() => { setTimeout(() => setTa(null), 120); }, []);

  // Under the textarea, or over it when there's no room below; inside the window.
  useLayoutEffect(() => {
    if (!ta || !ref.current) { setPos(null); return; }
    const win = doc.defaultView || window;
    const r = ref.current.getBoundingClientRect();
    const h = listRef.current?.offsetHeight || 0;
    const width = Math.min(MAX_WIDTH, Math.max(200, r.width));
    const left = Math.min(Math.max(EDGE, r.left), win.innerWidth - width - EDGE);
    const below = r.bottom + GAP;
    const top = below + h > win.innerHeight - EDGE && r.top - GAP - h >= EDGE ? r.top - GAP - h : below;
    setPos({ left, top, width });
  }, [ta, ref, doc]);

  const popup = ta ? createPortal(
    <ul
      ref={listRef}
      className="emoji-shortcode-list"
      role="listbox"
      style={pos ? { left: pos.left, top: pos.top, width: pos.width } : { left: -9999, top: 0, visibility: 'hidden' }}
    >
      {ta.items.map((it, i) => (
        <li
          key={it.name}
          role="option"
          aria-selected={i === ta.index}
          className={`emoji-shortcode-item${i === ta.index ? ' active' : ''}`}
          onMouseDown={(e) => { e.preventDefault(); pick(it.emoji); }}
          onMouseEnter={() => setTa((t) => (t ? { ...t, index: i } : t))}
        >
          <span className="emoji-shortcode-emoji">{it.emoji}</span>
          <span className="emoji-shortcode-name">:{it.name}:</span>
        </li>
      ))}
    </ul>,
    doc.body,
  ) : null;

  return { change, keyDown, blur, popup, open: !!ta };
}
