import { useSyncExternalStore } from 'react';

// "This visitor has been welcomed": set when they close the welcome banner with
// its X, so the banner does not come back on every visit. A choice the
// visitor made in the UI, so it is consent-exempt like the other settings in
// lib/consent.js. Storage can be missing or blocked: then the banner simply
// shows again next time.
// Renamed from 3speak_welcome_done when finishing the tour stopped counting as
// a dismissal: flags set that way must not hide the banner.
const KEY = '3speak_welcome_closed';

// Fired by the welcome banner (or anything else) to start the tour.
export const START_TOUR_EVENT = 'start-welcome-tour';
export const startWelcomeTour = () => window.dispatchEvent(new Event(START_TOUR_EVENT));

const listeners = new Set();

function read() {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function markWelcomeDone() {
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    // Private mode or blocked storage: the banner just shows again next visit.
  }
  listeners.forEach((fn) => fn());
}

// /?welcome=1: show the banner again (testing, or a link that re-offers it).
export function resetWelcome() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing stored, nothing to clear.
  }
  listeners.forEach((fn) => fn());
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useWelcomeDone() {
  return useSyncExternalStore(subscribe, read, () => false);
}
