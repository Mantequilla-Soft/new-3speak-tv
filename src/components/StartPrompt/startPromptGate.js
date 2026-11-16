// When the "Pick up where you left off?" popup (StartPrompt.jsx) asks. Pure, so
// the rules are tested on their own.
import { START_PROMPT_KEY } from '../../lib/lastPage';

export const ANSWERED_KEY = START_PROMPT_KEY;
// Not in the first moments of a visit, and look again this much later while
// something is in the way (the changelog, the tour, another dialog).
export const FIRST_DELAY_MS = 3000;
export const RETRY_MS = 4000;

/**
 * Ask while Continue where I left off is off and nobody answered yet. A first
 * visit starts with it on (lib/store.js), so only people who used 3Speak before
 * are asked; switching it in Settings counts as an answer.
 */
export function shouldAsk({ answered = false, resumeLastPage }) {
  return !answered && !resumeLastPage;
}
