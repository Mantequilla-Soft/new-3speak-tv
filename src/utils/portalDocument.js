import { createContext, useContext } from 'react';

// The document portals and outside-click listeners belong to: the page's own,
// or the audio player's pop-out window while the player sits in there
// (components/GlobalAudioPlayer/AudioPip.jsx). Outside a provider, the page's.
export const PortalDocContext = createContext(null);

export const usePortalDoc = () => useContext(PortalDocContext) || document;
