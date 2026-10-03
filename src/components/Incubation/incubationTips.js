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
    titleKey: 'incubation.tips.shortsCamera.title',
    bodyKey: 'incubation.tips.shortsCamera.body',
    to: '/shorts',
    ctaKey: 'incubation.tips.shortsCamera.cta',
  },
  {
    id: 'search-slash',
    titleKey: 'incubation.tips.searchSlash.title',
    bodyKey: 'incubation.tips.searchSlash.body',
  },
  {
    id: 'communities',
    titleKey: 'incubation.tips.communities.title',
    bodyKey: 'incubation.tips.communities.body',
    to: '/groups',
    ctaKey: 'incubation.tips.communities.cta',
  },
  {
    id: 'follow-feed',
    titleKey: 'incubation.tips.followFeed.title',
    bodyKey: 'incubation.tips.followFeed.body',
    to: '/follow-feed',
    ctaKey: 'incubation.tips.followFeed.cta',
  },
  {
    id: 'interests',
    titleKey: 'incubation.tips.interests.title',
    bodyKey: 'incubation.tips.interests.body',
  },
  {
    id: 'hide-watched',
    titleKey: 'incubation.tips.hideWatched.title',
    bodyKey: 'incubation.tips.hideWatched.body',
  },
  {
    id: 'timestamps',
    titleKey: 'incubation.tips.timestamps.title',
    bodyKey: 'incubation.tips.timestamps.body',
  },
  {
    id: 'badges',
    titleKey: 'incubation.tips.badges.title',
    bodyKey: 'incubation.tips.badges.body',
    to: '/groups?tab=badges',
    ctaKey: 'incubation.tips.badges.cta',
  },
  {
    id: 'audio',
    titleKey: 'incubation.tips.audio.title',
    bodyKey: 'incubation.tips.audio.body',
    to: '/audio',
    ctaKey: 'incubation.tips.audio.cta',
  },
  {
    id: 'backlog',
    titleKey: 'incubation.tips.backlog.title',
    bodyKey: 'incubation.tips.backlog.body',
  },
];
