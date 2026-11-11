// Whether the top bar shows its section tabs (Home, Shorts, Live, Audio,
// Groups). Out by default, as the 20a bar draws them; the account menu's
// "Hide pages" (42b) folds them away and the choice is remembered per browser.
// The bar and the menu both read it, so it lives here with a change event
// rather than in either component.
import { useEffect, useState } from 'react';

// Fired by the bottom bar's red "+" (BottomNav.jsx); the top bar's Create
// menu (Nav.jsx) opens on it.
export const OPEN_CREATE_EVENT = '3speak:open-create';

export const NAV_TABS_KEY = '3speak_nav_tabs_open';
const EVENT = '3speak:nav-tabs';

export function readNavTabsOpen() {
  try {
    // Only an explicit "false" hides them: anyone who never chose sees the tabs.
    return localStorage.getItem(NAV_TABS_KEY) !== 'false';
  } catch {
    // Private mode, or storage switched off: show them.
    return true;
  }
}

export function setNavTabsOpen(open) {
  try { localStorage.setItem(NAV_TABS_KEY, String(!!open)); } catch { /* see above */ }
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function useNavTabsOpen() {
  const [open, setOpen] = useState(readNavTabsOpen);
  useEffect(() => {
    const sync = () => setOpen(readNavTabsOpen());
    window.addEventListener(EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  return open;
}
