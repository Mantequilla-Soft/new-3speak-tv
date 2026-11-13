// Rules for what may appear in the Spotlight hero on Home (HomeGrouped's
// featured pool). Owner 2026-11-12: never a video whose title names another
// platform (mostly cross-posts): Steemit, Blurt or DTube, any case, anywhere
// in the title.
const BLOCKED_TITLE = /steemit|blurt|dtube/i;

export const spotlightAllowed = (video) => !BLOCKED_TITLE.test(String(video?.title || ''));
