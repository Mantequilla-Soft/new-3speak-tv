import { FaEye, FaVideo, FaBullhorn } from 'react-icons/fa';

// The kinds of warm-up user. The ids must match the tracks in
// server/warmup.cjs, which decide each one's goals.
export const TRACKS = [
  {
    id: 'viewer',
    Icon: FaEye,
    titleKey: 'incubation.tracks.viewer.title',
    bodyKey: 'incubation.tracks.viewer.body',
  },
  {
    id: 'creator',
    Icon: FaVideo,
    titleKey: 'incubation.tracks.creator.title',
    bodyKey: 'incubation.tracks.creator.body',
  },
  {
    id: 'advertiser',
    Icon: FaBullhorn,
    titleKey: 'incubation.tracks.advertiser.title',
    bodyKey: 'incubation.tracks.advertiser.body',
  },
];

// Returns the i18n KEY of the track's title (translate it at render with t()).
export const trackTitleKey = (id) => TRACKS.find((tr) => tr.id === id)?.titleKey || null;
