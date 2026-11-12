import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createAuthUserSlice } from './slices/createAuthStore';
import { createStudioSlice } from './slices/createStudioSlice';
import { createUserDetailsSlice } from './slices/createUserStore';
import { createVideoSlice } from './slices/createVideoSlice';
import {createPostProcessingSlice} from "./slices/createPostProcessingSlice"
import { createThemeSlice } from './slices/createThemeSlice';
import { createMiniPlayerSlice } from './slices/createMiniPlayerSlice';
import { createAudioPlayerSlice } from './slices/createAudioPlayerSlice';

export const useAppStore = create(
  persist(
    (...a) => ({
      ...createAuthUserSlice(...a),
      ...createStudioSlice(...a),
      ...createUserDetailsSlice(...a),
      ...createVideoSlice(...a),
      ...createPostProcessingSlice(...a),
      ...createThemeSlice(...a),
      ...createMiniPlayerSlice(...a),
      ...createAudioPlayerSlice(...a),
      watchHistoryEnabled: true,
      setWatchHistoryEnabled: (enabled) => a[0]({ watchHistoryEnabled: enabled }),
      showNsfw: false,
      setShowNsfw: (val) => a[0]({ showNsfw: typeof val === 'function' ? val(a[1]().showNsfw) : val }),
      // Video card size on a phone: 'small' (two per row) | 'large' (one per
      // row). Default large since store v3, as design 20a draws the phone feed;
      // desktop always uses small ones (hooks/useCardSize). Drives home, profile
      // and playlist card grids.
      homeCardSize: 'large',
      setHomeCardSize: (val) => a[0]({ homeCardSize: typeof val === 'function' ? val(a[1]().homeCardSize) : val }),
      // Spotlight card width on the Discover tab: 'small' | 'medium' (2 / 3 cards
      // wide). Not used in large-card mode, which keeps 2.
      spotlightSize: 'small',
      setSpotlightSize: (val) => a[0]({ spotlightSize: val }),
      // Hover/scroll video previews on cards (default on).
      previewEnabled: true,
      setPreviewEnabled: (val) => a[0]({ previewEnabled: typeof val === 'function' ? val(a[1]().previewEnabled) : val }),
      // The Spotlight's muted clips (owner 2026-11-12); off = pictures only.
      heroPreviewEnabled: true,
      setHeroPreviewEnabled: (val) => a[0]({ heroPreviewEnabled: typeof val === 'function' ? val(a[1]().heroPreviewEnabled) : val }),
      // Selected content interests (ids from utils/interests.js). Canonical copy
      // lives in the user's Hive posting_json_metadata; this is a local cache for
      // instant UI, hydrated from Hive on load. Used later to bias served content.
      interests: [],
      setInterests: (val) => a[0]({ interests: typeof val === 'function' ? val(a[1]().interests) : val }),
      // Shorts feed mode: 'discover' (everything, interests only BOOST the ranking)
      // vs 'interests' (ONLY shorts whose winning topic is one of my interests).
      // Applies to the main shorts feed only — a creator's shorts (?user=…) always
      // stay their own date-sorted feed.
      shortsFeedMode: 'discover',
      setShortsFeedMode: (val) => a[0]({ shortsFeedMode: val === 'interests' ? 'interests' : 'discover' }),
      // Show the comment input bar under a short. Off by default — it eats vertical
      // space and the comments panel is a tap away.
      shortsCommentBar: false,
      setShortsCommentBar: (val) => a[0]({ shortsCommentBar: !!(typeof val === 'function' ? val(a[1]().shortsCommentBar) : val) }),
      // Shorts rails interleaved into the video feeds and the watch page's
      // recommendations. ON by default; turning it off skips the shorts request
      // entirely, it doesn't just hide the rows.
      inlineShorts: true,
      setInlineShorts: (val) => a[0]({ inlineShorts: !!(typeof val === 'function' ? val(a[1]().inlineShorts) : val) }),
      // Land on /shorts instead of the home feed when 3Speak is opened. Off by default.
      openShortsOnStart: false,
      setOpenShortsOnStart: (val) => a[0]({ openShortsOnStart: !!(typeof val === 'function' ? val(a[1]().openShortsOnStart) : val) }),
      // Hide videos the user has already watched from discovery feeds (default ON).
      hideWatched: true,
      setHideWatched: (val) => a[0]({ hideWatched: typeof val === 'function' ? val(a[1]().hideWatched) : val }),
      // Leave out videos + shorts the pipeline flagged AI-generated, in every feed
      // (Card3, the shorts rails, the shorts swipe feed). Default ON since store v2;
      // turned off, flagged content just carries an AI pill. Filtered client-side,
      // see utils/aiFlags.
      hideAi: true,
      setHideAi: (val) => a[0]({ hideAi: !!(typeof val === 'function' ? val(a[1]().hideAi) : val) }),
      // Private mode: suppresses the COUNTRY on this viewer's watch sessions.
      //
      // It is no longer about the IP. As of 2026-07-14 no viewer IP is stored for
      // ANYONE — the player resolves it to an ISO country on ingest and throws it away
      // inside the request — and the persistent per-browser viewer id is gone too.
      // Private mode now drops that last coarse signal as well, so these sessions
      // appear in no creator's country breakdown. Default OFF.
      privateMode: false,
      setPrivateMode: (val) => a[0]({ privateMode: typeof val === 'function' ? val(a[1]().privateMode) : val }),
      // Simple feeds: when ON, discovery feeds skip the ranking algorithm and are
      // just sorted newest-first (chronological). Default OFF (algo on).
      // Set on startup to the previous app version when the user upgraded (null = first
      // visit or no change). A future changelog / "what's new" prompt reads this.
      // Deliberately NOT persisted — recomputed each load by checkAppVersion().
      appUpdatedFrom: null,
      setAppUpdatedFrom: (v) => a[0]({ appUpdatedFrom: v }),
    }),
    {
      name: 'user-store', // The storage key for persisting user data
      // Bump when a persisted default changes and existing stores must be migrated.
      // v1: "Hide watched" flipped to default-ON — turn it on for everyone whose
      // store predates the change (they had the old default `false` saved).
      // v2: "Hide AI-generated" flipped to default-ON, same reason. A saved `false`
      // was nearly always the untouched old default, since the setting started OFF:
      // the only one it overrides is someone who turned it on and back off again.
      // v3: phone cards default to large (one per row, design 20a). A saved 'small'
      // was the untouched old default for nearly everyone (the switch started off),
      // so it becomes 'large'; a saved 'large' was picked and stays.
      // v4 (owner 2026-11-12): "Simple feeds" is gone; a saved value is dropped,
      // so everyone is back on the recommended feeds.
      version: 4,
      migrate: (persistedState, version) => {
        if (version < 1 && persistedState) persistedState.hideWatched = true;
        if (version < 2 && persistedState) persistedState.hideAi = true;
        if (version < 3 && persistedState && persistedState.homeCardSize !== 'large') persistedState.homeCardSize = 'large';
        if (version < 4 && persistedState) delete persistedState.simpleFeed;
        return persistedState;
      },
      partialize: (state) => ({
        user: state.user, // Persist only the `user` slice
        isProcessing: state.isProcessing,
        theme: state.theme, // Persist theme preference
        watchHistoryEnabled: state.watchHistoryEnabled,
        showNsfw: state.showNsfw,
        homeCardSize: state.homeCardSize,
        spotlightSize: state.spotlightSize,
        previewEnabled: state.previewEnabled,
        heroPreviewEnabled: state.heroPreviewEnabled,
        interests: state.interests,
        shortsFeedMode: state.shortsFeedMode,
        shortsCommentBar: state.shortsCommentBar,
        openShortsOnStart: state.openShortsOnStart,
        inlineShorts: state.inlineShorts,
        hideWatched: state.hideWatched,
        hideAi: state.hideAi,
        privateMode: state.privateMode,
      }),
    }
  )
);
