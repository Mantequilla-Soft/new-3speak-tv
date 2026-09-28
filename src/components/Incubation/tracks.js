import { FaEye, FaVideo, FaBullhorn } from 'react-icons/fa';

// The kinds of warm-up user. The ids must match the tracks in
// server/warmup.cjs, which decide each one's goals.
export const TRACKS = [
  {
    id: 'viewer',
    Icon: FaEye,
    title: 'Mostly a viewer',
    body: 'I am here to watch, comment and follow creators.',
  },
  {
    id: 'creator',
    Icon: FaVideo,
    title: 'Mostly a creator',
    body: 'I want to publish videos and shorts and build a channel.',
  },
  {
    id: 'advertiser',
    Icon: FaBullhorn,
    title: 'An advertiser',
    body: 'I represent a brand and want to reach 3Speak viewers.',
  },
];

export const trackTitle = (id) => TRACKS.find((t) => t.id === id)?.title || null;
