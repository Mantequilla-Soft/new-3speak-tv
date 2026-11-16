// Which questions the "Pick up where you left off?" popup (StartPrompt.jsx) asks.
// Pure, so the rules are tested on their own.

export const ANSWERED_KEY = '3speak_start_prompt';
// Someone who just said "Essential only" on the cookie banner is not asked again
// in the same breath: only once that answer is a day old.
export const CONSENT_SETTLED_MS = 24 * 60 * 60 * 1000;
// Not in the first moments of a visit, and look again this much later while
// something is in the way (the changelog, the tour, another dialog).
export const FIRST_DELAY_MS = 3000;
export const RETRY_MS = 4000;

// TEMPORARY (owner 2026-11-16): on preview the popup comes up on every load with
// both questions, whatever was set or answered, so the dialog can be looked over.
// Remove before the release that ships it.
export const ALWAYS_ON_HOSTS = ['preview.3speak.tv'];

/**
 * 'lastPage' (Continue where I left off is off) and/or 'playback' (the cookie
 * banner was answered without "where you left off in each video", a day or more
 * ago). Empty once answered, or when there is nothing to ask.
 */
export function startPromptItems({ always = false, answered = false, resumeLastPage, consentDecidedAt, functionalConsent, now = Date.now() }) {
  if (always) return ['lastPage', 'playback'];
  if (answered) return [];
  const items = [];
  if (!resumeLastPage) items.push('lastPage');
  const decided = consentDecidedAt ? Date.parse(consentDecidedAt) : NaN;
  if (!functionalConsent && Number.isFinite(decided) && now - decided >= CONSENT_SETTLED_MS) items.push('playback');
  return items;
}
