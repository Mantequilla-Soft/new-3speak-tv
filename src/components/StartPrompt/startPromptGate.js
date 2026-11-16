// When the "Pick up where you left off?" popup (StartPrompt.jsx) asks. Pure, so
// the rules are tested on their own.
import { START_PROMPT_KEY } from '../../lib/lastPage';

export const ANSWERED_KEY = START_PROMPT_KEY;
// Not in the first moments of a visit, and look again this much later while
// something is in the way (the changelog, the tour, another dialog).
export const FIRST_DELAY_MS = 3000;
export const RETRY_MS = 4000;

// TEMPORARY (owner 2026-11-16): on preview the popup comes up on every load,
// whatever was set or answered, so the dialog can be looked over. Remove before
// the release that ships it.
export const ALWAYS_ON_HOSTS = ['preview.3speak.tv'];

/**
 * Ask while Continue where I left off is off and nobody answered yet. A first
 * visit starts with it on (lib/store.js), so only people who used 3Speak before
 * are asked; switching it in Settings counts as an answer.
 */
export function shouldAsk({ always = false, answered = false, resumeLastPage }) {
  if (always) return true;
  return !answered && !resumeLastPage;
}
