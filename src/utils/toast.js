import { createElement } from 'react';
import { toast as sonner } from 'sonner';
import { t } from '../i18n';
import { Icon } from '../components/v2/Icon';

/**
 * The look of each category (34d: "one toast shape whose icon and colour come
 * from the category"): its Material Symbol and its tone. Accent = uploads,
 * money, votes and live; cyan = publishing, people, playlists and the rest of
 * the app talking; muted = reports. Errors and warnings always read in the
 * accent, whatever their category.
 */
const CATEGORY_STYLE = {
  '3Speak': ['info', 'cyan'],
  Ads: ['campaign', 'accent'],
  Advertising: ['campaign', 'accent'],
  App_update: ['install_mobile', 'cyan'],
  Audio: ['graphic_eq', 'cyan'],
  Badges: ['military_tech', 'cyan'],
  Business_contact: ['business_center', 'cyan'],
  Captions: ['subtitles', 'cyan'],
  Channel_Surfing: ['live_tv', 'cyan'],
  Chat: ['chat_bubble', 'cyan'],
  Comment: ['chat', 'cyan'],
  Community: ['groups', 'cyan'],
  Feedback: ['rate_review', 'cyan'],
  Following: ['person_add', 'cyan'],
  Follows: ['person_add', 'cyan'],
  Gated_video: ['lock', 'accent'],
  Install: ['install_mobile', 'cyan'],
  Live: ['sensors', 'accent'],
  Notifications: ['notifications', 'cyan'],
  Playlist: ['playlist_add', 'cyan'],
  Podcasts: ['podcasts', 'cyan'],
  Post: ['edit_note', 'cyan'],
  Profile: ['person', 'cyan'],
  Promotion: ['rocket_launch', 'accent'],
  Publish_to_Hive: ['send', 'cyan'],
  Report: ['flag', 'muted'],
  Settings: ['settings', 'cyan'],
  Shorts: ['smart_display', 'cyan'],
  Sign_in: ['login', 'cyan'],
  Spotlight: ['auto_awesome', 'cyan'],
  Supporters: ['favorite', 'accent'],
  Tip: ['volunteer_activism', 'accent'],
  Upload: ['cloud_upload', 'accent'],
  Video: ['movie', 'cyan'],
  Vote: ['arrow_upward', 'accent'],
  Wallet: ['account_balance_wallet', 'accent'],
  Your_account: ['manage_accounts', 'cyan'],
  Your_name: ['badge', 'cyan'],
};

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
 * The heading is translated when each toast is shown, from
 * src/locales/<lang>/toastCategories.json (keyed by the English category, spaces as _), so a
 * module keeps its plain `toastIn('Upload')` and still speaks the reader's
 * language. A category missing there just shows in English.
 *
 * @param {string} category Heading shown above every message from this module.
 */
export function toastIn(englishCategory) {
  // Keys are the English category with anything but letters/digits/_/- turned into
  // "_" ("Sign in" → Sign_in): the translation editor only accepts plain key names.
  const slug = String(englishCategory).replace(/[^\w-]/g, '_');
  const key = `toastCategories.${slug}`;
  const heading = () => t(key, { defaultValue: englishCategory });
  const [iconName, categoryTone] = CATEGORY_STYLE[slug] || ['info', 'cyan'];

  // The category's icon and tone (34d), unless the caller chose an icon of
  // their own. A loading toast keeps its spinner. The tone rides on a class
  // (toast.css: .ts-tone-*).
  const styled = (method, opts) => {
    const tone = method === 'error' || method === 'warning' ? 'accent' : categoryTone;
    const out = { ...opts, className: [opts.className, 'ts-cat', `ts-tone-${tone}`].filter(Boolean).join(' ') };
    if (out.icon === undefined && method !== 'loading') out.icon = createElement(Icon, { name: iconName, size: 24 });
    return out;
  };

  const headed = (send, method) => (message, options) => {
    const opts = options || {};

    // A caller who already wrote a two-line toast keeps the shape they wrote.
    // Their title stays the title; we do not push a third line in above it.
    if (opts.description !== undefined) return send(message, styled(method, opts));

    // `title` is the per-call escape hatch for a module that spans two areas.
    const { title, ...rest } = opts;
    return send(title || heading(), styled(method, { ...rest, description: message }));
  };

  const api = headed((message, options) => sonner(message, options), 'default');
  for (const name of TEXT_METHODS) {
    api[name] = headed((message, options) => sonner[name](message, options), name);
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
