// Things a new user has no way to know, and would be pleased to find out.
//
// Deliberately NOT here: anything about keys, passwords, recovery or wallets.
// Someone in their warm-up has no keys yet, and a tip about protecting them
// would be both useless and alarming. Those belong to the moment they get an
// account, not to their first week.
//
// Each tip earns its place by being ACTIONABLE and specific to 3Speak. "Welcome
// to 3Speak" is not a tip. "Type / to search from anywhere" is.
export const TIPS = [
  {
    id: 'shorts-camera',
    title: 'Shorts are a tab, not a different app',
    body: 'Open Shorts from the top bar to watch, or use Share to post one. Vertical clips from your phone work as they are.',
    to: '/shorts',
    cta: 'Open Shorts',
  },
  {
    id: 'search-slash',
    title: 'Press / to search',
    body: 'From anywhere on the site, the slash key jumps into the search box. It looks through videos, creators and communities.',
  },
  {
    id: 'communities',
    title: 'Communities gather people around one subject',
    body: 'Join a few and their videos start showing up in your feeds. You can post into a community too, so the right people see it.',
    to: '/groups',
    cta: 'Browse communities',
  },
  {
    id: 'follow-feed',
    title: 'Your follows have their own feed',
    body: 'Once you follow a few creators, the follow feed is only their videos. It is the fastest way to stop scrolling past things you do not care about.',
    to: '/follow-feed',
    cta: 'See it',
  },
  {
    id: 'interests',
    title: 'Tell us what you are into',
    body: 'Pick a few topics in Settings and the home feeds reweight towards them straight away. It works better than any amount of scrolling.',
  },
  {
    id: 'hide-watched',
    title: 'Watched videos can disappear from feeds',
    body: 'Settings has a "hide watched" switch, on by default, so the same video stops following you around after you have seen it.',
  },
  {
    id: 'timestamps',
    title: 'Comment on an exact moment',
    body: 'While a video is playing, a comment can carry the timestamp you were at. Readers get a link straight to that second.',
  },
  {
    id: 'badges',
    title: 'Badges are given, not claimed',
    body: 'People on Hive are awarded badges for events and milestones. Open one to see everyone who holds it and what they publish.',
    to: '/groups?tab=badges',
    cta: 'Look at badges',
  },
  {
    id: 'audio',
    title: '3Speak carries audio too',
    body: 'Podcasts and music live under Audio in the top bar, with their own player. You can publish audio the same way you publish video.',
    to: '/audio',
    cta: 'Open Audio',
  },
  {
    id: 'backlog',
    title: 'Nothing you post now is wasted',
    body: 'Everything you publish during your warm-up can be republished to Hive under your own name once your account arrives, and you choose what comes with you.',
  },
];
