import { ADVERTISER_SIGNUP } from '../../utils/config';

// The kinds of warm-up user. The ids must match the tracks in
// server/warmup.cjs, which decide each one's goals. `icon` is a Material
// Symbols name (components/v2/Icon.jsx).
export const TRACKS = [
  {
    id: 'viewer',
    icon: 'visibility',
    titleKey: 'incubation.tracks.viewer.title',
    bodyKey: 'incubation.tracks.viewer.body',
  },
  {
    id: 'creator',
    icon: 'videocam',
    titleKey: 'incubation.tracks.creator.title',
    bodyKey: 'incubation.tracks.creator.body',
  },
  {
    id: 'musician',
    icon: 'music_note',
    titleKey: 'incubation.tracks.musician.title',
    bodyKey: 'incubation.tracks.musician.body',
  },
  {
    id: 'podcaster',
    icon: 'podcasts',
    titleKey: 'incubation.tracks.podcaster.title',
    bodyKey: 'incubation.tracks.podcaster.body',
  },
  {
    id: 'advertiser',
    icon: 'storefront',
    titleKey: 'incubation.tracks.advertiser.title',
    bodyKey: 'incubation.tracks.advertiser.body',
  },
];

// Returns the i18n KEY of the track's title (translate it at render with t()).
export const trackTitleKey = (id) => TRACKS.find((tr) => tr.id === id)?.titleKey || null;

// The tracks a person may still pick. The advertiser track stays visible to
// someone already on it, so their own choice never disappears from the chooser.
export const openTracks = (current = null) =>
  TRACKS.filter((tr) => tr.id !== 'advertiser' || ADVERTISER_SIGNUP || current === 'advertiser');

// The "viewers ..., creators ..." sentence names advertisers only while they can sign up.
export const withTracksKey = (key) => (ADVERTISER_SIGNUP ? key : `${key}NoAdvertisers`);
