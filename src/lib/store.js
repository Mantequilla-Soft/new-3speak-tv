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
      sidebarOpen: false,
      setSidebarOpen: (open) => a[0]({ sidebarOpen: typeof open === 'function' ? open(a[1]().sidebarOpen) : open }),
      // User preference: completely hide the persistent left sidebar (default true).
      // The hamburger drawer in the top bar still works regardless.
      sidebarHidden: true,
      setSidebarHidden: (val) => a[0]({ sidebarHidden: typeof val === 'function' ? val(a[1]().sidebarHidden) : val }),
      showNsfw: false,
      setShowNsfw: (val) => a[0]({ showNsfw: typeof val === 'function' ? val(a[1]().showNsfw) : val }),
      // Video card size: 'small' | 'large' (default small — a first-time visitor
      // sees more videos per screen; returning users keep whatever they persisted).
      // Drives home, profile and playlist card grids.
      homeCardSize: 'small',
      setHomeCardSize: (val) => a[0]({ homeCardSize: typeof val === 'function' ? val(a[1]().homeCardSize) : val }),
      // Hover/scroll video previews on cards (default on).
      previewEnabled: true,
      setPreviewEnabled: (val) => a[0]({ previewEnabled: typeof val === 'function' ? val(a[1]().previewEnabled) : val }),
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
      simpleFeed: false,
      setSimpleFeed: (val) => a[0]({ simpleFeed: typeof val === 'function' ? val(a[1]().simpleFeed) : val }),
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
      version: 1,
      migrate: (persistedState, version) => {
        if (version < 1 && persistedState) persistedState.hideWatched = true;
        return persistedState;
      },
      partialize: (state) => ({
        user: state.user, // Persist only the `user` slice
        isProcessing: state.isProcessing,
        theme: state.theme, // Persist theme preference
        watchHistoryEnabled: state.watchHistoryEnabled,
        sidebarOpen: state.sidebarOpen,
        sidebarHidden: state.sidebarHidden,
        showNsfw: state.showNsfw,
        homeCardSize: state.homeCardSize,
        previewEnabled: state.previewEnabled,
        interests: state.interests,
        shortsFeedMode: state.shortsFeedMode,
        shortsCommentBar: state.shortsCommentBar,
        openShortsOnStart: state.openShortsOnStart,
        inlineShorts: state.inlineShorts,
        hideWatched: state.hideWatched,
        privateMode: state.privateMode,
        simpleFeed: state.simpleFeed,
      }),
    }
  )
);
