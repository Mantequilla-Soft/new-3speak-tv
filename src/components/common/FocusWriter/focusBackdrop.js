import { createContext, useContext } from 'react';

/**
 * The picture behind focus mode (FocusWriter): what the comment is about. A
 * page provides it around its comment boxes, so every editor inside picks it
 * up without passing it down:
 * - a video or a Short: its thumbnail,
 * - a post: its thumbnail,
 * - an audio post or the audio player: its cover,
 * - a snap: the banner of the channel whose Community tab it is in.
 * Null: no picture, the dark room only.
 */
const FocusBackdropContext = createContext(null);

export const FocusBackdropProvider = FocusBackdropContext.Provider;

export function useFocusBackdrop() {
  return useContext(FocusBackdropContext);
}
