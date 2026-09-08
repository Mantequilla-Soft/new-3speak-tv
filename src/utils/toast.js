import { toast as sonner } from 'sonner';

/**
 * Toasts with a category header.
 *
 * Every toast now reads as a heading plus the message underneath — "Upload" over
 * "File is larger than 1 GB" rather than that sentence alone — so someone who
 * glances at a notification knows what part of 3Speak is talking to them before
 * they read a word of it. The accent-rail style in toast.css is built around that
 * two-line shape; a title-only toast leaves its description line empty.
 *
 * 🚨 THE CATEGORY IS BOUND PER MODULE, NOT PER CALL.
 * There are ~520 toast calls across 77 files. Passing a header at each one would
 * be 520 edits to keep in step, and the header would drift the first time someone
 * copied a line between files. Instead each module binds its own category once, at
 * the import, and every existing `toast.success('...')` in it keeps working
 * untouched:
 *
 *     import { toastIn } from '../../utils/toast';
 *     const toast = toastIn('Upload');
 *
 * Where one module genuinely spans two areas, a single call can override the
 * header with `{ title: 'Something else' }` — see below.
 *
 * The returned object is a drop-in for sonner's `toast`: callable, with the same
 * methods, passing options straight through (so the `{ id }` progress pattern in
 * streamVod.js still updates one toast in place rather than stacking new ones) and
 * returning sonner's own toast id.
 */

// The methods that take (message, options) and render our text. `dismiss`,
// `custom` and `promise` are deliberately absent: they carry no message of ours
// to re-title, so they pass through untouched further down.
const TEXT_METHODS = ['success', 'error', 'warning', 'info', 'loading', 'message'];

/**
 * Bind a category, and get back something shaped exactly like sonner's `toast`.
 *
 * @param {string} category Heading shown above every message from this module.
 */
export function toastIn(category) {
  const headed = (send) => (message, options) => {
    const opts = options || {};

    // A caller who already wrote a two-line toast keeps the shape they wrote.
    // Their title stays the title; we do not push a third line in above it.
    if (opts.description !== undefined) return send(message, opts);

    // `title` is the per-call escape hatch for a module that spans two areas.
    const { title, ...rest } = opts;
    return send(title || category, { ...rest, description: message });
  };

  const api = headed((message, options) => sonner(message, options));
  for (const name of TEXT_METHODS) {
    api[name] = headed((message, options) => sonner[name](message, options));
  }

  // Pass-throughs. Bound rather than assigned so `this` is still sonner's own
  // toast object inside them.
  api.dismiss = (...args) => sonner.dismiss(...args);
  api.custom = (...args) => sonner.custom(...args);
  api.promise = (...args) => sonner.promise(...args);

  return api;
}

/* ─── hiding the stack ────────────────────────────────────────────────────
 * The toasts sit under the title bar, which is where the right-hand nav
 * drops its panels — the profile menu, notifications, the Share flyout. Those
 * open on top of whatever is on screen, so the stack gets out of their way
 * while one is up.
 *
 * Hidden, not dismissed: an upload sitting at 40% is a toast someone still
 * wants when they close the menu again, and dismissing it would take the
 * progress line with it. The attribute lives on <html> so the rule in
 * toast.css can reach sonner's own container, which is portalled to <body>.
 */
const HIDDEN_ATTR = 'data-toasts-hidden';

export const hideToastLayer = () => {
  document.documentElement.setAttribute(HIDDEN_ATTR, 'true');
};

export const showToastLayer = () => {
  document.documentElement.removeAttribute(HIDDEN_ATTR);
};

export default toastIn;
