import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cx } from '../v2/helpers';
import { Icon } from '../v2/Icon';
import './WatchTabs.scss';

// The side tab last picked on the watch page ('discussion' | 'transcript' | ...).
const WATCH_TAB_KEY = '3speak-watch-side-tab';

// The two-column watch layout starts here (Watch v2, 02). Below it the page is one
// column and the side panels become a row of chips above one scroll area.
export const WATCH_WIDE_QUERY = '(min-width: 1024px)';

export function useWideWatch() {
  const [wide, setWide] = useState(
    () => typeof window !== 'undefined' && !!window.matchMedia?.(WATCH_WIDE_QUERY).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia?.(WATCH_WIDE_QUERY);
    if (!mq) return undefined;
    const on = () => setWide(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return wide;
}

/**
 * Which side tab is open. The tab last picked wins whenever this video has it
 * (the transcript tab arrives after the subtitles do, so without that a
 * transcript reader landed on Discussion every time); otherwise the current one
 * stays, else the first.
 *
 * A live stream opens on its Live chat instead, whatever was picked on another
 * video: the chat is what a stream is watched for. The chat tab can arrive late
 * (once the page knows the stream is live), so it is selected when it appears,
 * and after that the viewer's own pick on this page stays.
 */
export function useSideTab(ids) {
  const key = ids.join('|');
  const [active, setActive] = useState(null);
  const hadChat = useRef(false);
  useEffect(() => {
    const hasChat = ids.includes('chat');
    const chatArrived = hasChat && !hadChat.current;
    hadChat.current = hasChat;
    let pref = null;
    try { pref = localStorage.getItem(WATCH_TAB_KEY); } catch { /* storage off */ }
    setActive((cur) => {
      if (hasChat) return chatArrived || !cur || !ids.includes(cur) ? 'chat' : cur;
      return pref && ids.includes(pref)
        ? pref
        : (cur && ids.includes(cur) ? cur : ids[0] || null);
    });
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const pick = useCallback((id, { remember = true } = {}) => {
    setActive(id);
    if (!remember) return;
    try { localStorage.setItem(WATCH_TAB_KEY, id); } catch { /* storage off */ }
  }, []);
  return [active, pick];
}

/**
 * The watch page's side panel (02, 22a): a segmented track of panels over ONE
 * fixed-height area. Switching tabs never changes the panel's size. A `flush`
 * tab fills the area itself (the discussion scrolls its own list and pins its
 * composer at the bottom); the others scroll inside it.
 *
 * On a wide screen it sits beside the player and takes the player's height. On
 * a narrow one it is a row of chips above a fixed scroll area (STYLE_GUIDE §11,
 * "Mobile variant of any desktop panel").
 *
 * tabs: [{ id, label, count, icon, content, keepMounted, flush }]. A keepMounted tab
 * stays in the DOM while hidden: the discussion keeps its draft and the live
 * chat keeps the portal it is drawn into.
 */
export default function WatchTabs({ tabs, active, onChange, wide, label, className, panelRef }) {
  const list = useMemo(() => tabs.filter(Boolean), [tabs]);
  if (!list.length) return null;
  const current = list.some((tab) => tab.id === active) ? active : list[0].id;

  return (
    <section className={cx('wv2-side', wide ? 'is-wide' : 'is-narrow', className)} aria-label={label} ref={panelRef}>
      <div className={cx('wv2-side__tabs', wide ? 'v2-seg is-block' : 'is-chips')} role="tablist" aria-label={label}>
        {list.map((tab) => {
          const on = tab.id === current;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`wv2-tab-${tab.id}`}
              aria-selected={on}
              aria-controls={`wv2-panel-${tab.id}`}
              className={cx(wide ? 'v2-seg__opt h36' : 'v2-chip wv2-side__chip', on && 'is-on')}
              onClick={() => onChange?.(tab.id)}
            >
              {tab.icon && <Icon name={tab.icon} size={16} />}
              {tab.label}
              {tab.count != null && tab.count !== 0 && <span className={wide ? 'v2-seg__n' : 'v2-chip__n'}>{tab.count}</span>}
            </button>
          );
        })}
      </div>

      <div className="wv2-side__body">
        {list.map((tab) => {
          const on = tab.id === current;
          if (!on && !tab.keepMounted) return null;
          return (
            <div
              key={tab.id}
              id={`wv2-panel-${tab.id}`}
              role="tabpanel"
              aria-labelledby={`wv2-tab-${tab.id}`}
              className={cx('wv2-side__scroll', tab.flush && 'is-flush')}
              hidden={!on}
            >
              {tab.content}
            </div>
          );
        })}
      </div>
    </section>
  );
}
