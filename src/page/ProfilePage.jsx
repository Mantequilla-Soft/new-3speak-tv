import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import axios from "axios";
import { toastIn } from '../utils/toast';
import { useAppStore } from "../lib/store";
import { getFollowers } from "../hive-api/api";
import { MY_VIDEOS_URL, CHECKER_URL } from "../utils/config";

import Card3 from "../components/Cards/Card3";
import Follower from "../components/Userprofilepage/Follower";
import BarLoader from "../components/Loader/BarLoader";
import CreatorStats from "../components/CreatorStats/CreatorStats";
import CommunitySnaps from "../components/Userprofilepage/CommunitySnaps";
import SpotlightEditor from "../components/Spotlight/SpotlightEditor";
import { fetchSnaps } from "../lib/snaps";
import { useContentBatch } from "../hooks/useContentBatch";
import { useWatchHistory } from "../hooks/useWatchHistory";
import useViewCounts from "../hooks/useViewCounts";
import { fetchUserShortsWithDetails } from "../hive-api/hiveApi";

import { FaVideo, FaPlus } from "react-icons/fa";
import { IoMdShare, IoMdAdd } from "react-icons/io";
import { MdLock, MdPublic, MdClose } from "react-icons/md";
import SocialLinks from "../components/Userprofilepage/SocialLinks";
import LeaderboardBadges from "../components/LeaderboardBadges/LeaderboardBadges";
import HiveBadges from "../components/HiveBadges/HiveBadges";
import ProfileStreams from "../components/Userprofilepage/ProfileStreams";
import AddSocialLink_modal from "../components/modal/AddSocialLink_modal";
import EditVideoHintModal from "../components/modal/EditVideoHintModal";
import { fetchScheduledPosts, normalizeScheduledForCard } from "../utils/scheduledPosts";

import { LineSpinner, Quantum } from "ldrs/react";
import "ldrs/react/Quantum.css";

import { UPLOAD_TOKEN, UPLOAD_URL } from "../utils/config";
import "./ProfilePage.scss";
import checker from "../../public/images/checker.png";
import { useMyPlaylists } from "../hooks/useMyPlaylists";
import { useWatchedVideosCount } from "../hooks/useWatchedVideos";
import PlaylistCard from "../components/Cards/PlaylistCard";
import WatchedPlaylistCard from "../components/Cards/WatchedPlaylistCard";
import WatchLaterPlaylistCard from "../components/Cards/WatchLaterPlaylistCard";
import UserAudioList from "../components/Userprofilepage/UserAudioList";
import { createPlaylist } from "../utils/playlistOperations";
import { useQueryClient } from "@tanstack/react-query";
import ProfileHeader from "../components/ProfileHeader/ProfileHeader";
import ProfileStats from "../components/ProfileHeader/ProfileStats";
import ProfileOverview from "../components/Userprofilepage/ProfileOverview";
import ProfileEmptyState from "../components/Userprofilepage/ProfileEmptyState";
import ProfileEditModal from "../components/WelcomePrompt/ProfileEditModal";
import { FiEdit2 } from "react-icons/fi";

// Every toast from this module is headed "Profile"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Profile');

// Reserved playlist name for Watch Later
const WATCH_LATER_NAME = 'Watch Later';

function ProfilePage() {

  const { user, authenticated } = useAppStore();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();

  const [follower, setFollower] = useState(null);
  const [show, setShow] = useState(() => {
    // Initialize show based on URL tab parameter
    const tab = searchParams.get('tab');
    if (tab === 'playlists') return 'playlists';
    if (tab === 'shorts') return 'shorts';
    if (tab === 'supporters') return 'supporters';
    if (tab === 'audio') return 'audio';
    if (tab === 'community') return 'community';
    if (tab === 'links') return 'links';
    if (tab === 'stats') return 'stats';
    if (tab === 'video') return 'video';
    // Same landing tab as the public profile — one profile screen, one behaviour.
    return 'overview';
  });
  // Sync tab state when URL search params change (e.g. navigating from sidebar)
  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab === 'playlists') setShow('playlists');
    else if (tab === 'shorts') setShow('shorts');
    else if (tab === 'supporters') setShow('supporters');
    else if (tab === 'audio') setShow('audio');
    else if (tab === 'community') setShow('community');
    else if (tab === 'links') setShow('links');
    else if (tab === 'stats') setShow('stats');
    else if (tab === 'video') setShow('video');
    else if (!tab) setShow('overview');
  }, [searchParams]);

  // Switch tab AND reflect it in the URL so browser back-navigation
  // (e.g. returning from an opened short/playlist) lands on the same tab.
  // `permlink`/`opts` are the Overview page's community cards routing to one
  // specific snap (`opts.openComments` additionally opens + focuses its thread)
  // — see ProfileOverview's openCommunityTab and SnapCard's onOpenTab.
  const selectTab = useCallback((tab, permlink, opts) => {
    setShow(tab);
    const params = new URLSearchParams();
    if (tab && tab !== 'overview') params.set('tab', tab);
    if (permlink) params.set('snap', permlink);
    if (opts?.openComments) params.set('comments', '1');
    const q = params.toString() ? `?${params.toString()}` : '';
    navigate(`/profile${q}`, { replace: true });
  }, [navigate]);

  // The specific snap an Overview card routed here for (if any).
  const targetSnap = searchParams.get('snap') || null;
  const openSnapComments = searchParams.get('comments') === '1';

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [newPlaylistAccess, setNewPlaylistAccess] = useState('public');
  const [newPlaylistTags, setNewPlaylistTags] = useState([]);
  const [tagInput, setTagInput] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [showSocialLinkModal, setShowSocialLinkModal] = useState(false);
  const [showEditHint, setShowEditHint] = useState(false);
  const [socialLinksRefreshKey, setSocialLinksRefreshKey] = useState(0);
  const [editProfileOpen, setEditProfileOpen] = useState(false);
  // Bumped after a profile save so the header re-reads the bio from Hive.
  const [profileRefreshKey, setProfileRefreshKey] = useState(0);

  // Fetch user's playlists (all - public and private)
  const { data: playlists = [], isLoading: playlistsLoading, refetch: refetchPlaylists } = useMyPlaylists();

  // Fetch watched videos count
  const { data: watchedCount = 0, isLoading: watchedCountLoading } = useWatchedVideosCount();

  // Handle create playlist
  const handleCreatePlaylist = async () => {
    if (!newPlaylistName.trim()) {
      toast.error('Please enter a playlist name');
      return;
    }

    setIsCreating(true);
    try {
      await createPlaylist(newPlaylistName.trim(), newPlaylistAccess, null, newPlaylistTags);
      toast.success('Playlist created! It may take a moment to appear.');
      setShowCreateModal(false);
      setNewPlaylistName('');
      setNewPlaylistAccess('public');
      setNewPlaylistTags([]);
      setTagInput('');
      setTimeout(() => {
        refetchPlaylists();
        queryClient.invalidateQueries(['myPlaylists', user]);
      }, 3000);
    } catch (error) {
      toast.error('Failed to create playlist: ' + error.message);
    } finally {
      setIsCreating(false);
    }
  };

  /* ===============================
     IN-PROGRESS UPLOAD STATE
  =============================== */
  const [inProgress, setInProgress] = useState(null);
  const pollingRef = useRef(null);
  const refetchRef = useRef(null);

  /* ===============================
     FETCH IN-PROGRESS UPLOADS
  =============================== */
  const fetchInProgressUploads = useCallback(async () => {
    if (!user) return;

    try {
      const res = await axios.get(
        `${UPLOAD_URL}/api/upload/in-progress`,
        {
          headers: {
            "X-Hive-Username": user,
          },
        }
      );

      const json = res.data;

      console.log(json)

      if (!json.success) return;

      setInProgress(json.data);

      // stop polling when done
      if (json.data.count === 0 && pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
        if (refetchRef.current) {
          refetchRef.current();
        }
      }
    } catch (err) {
      console.error(
        "In-progress fetch error:",
        err.response?.data || err.message
      );
    }
  }, [user]);


  /* ===============================
     START POLLING ON LOAD
  =============================== */
  useEffect(() => { 
    if (!user) return;

    // Clear any existing interval first
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }

    // Run immediately
    fetchInProgressUploads(); 

    // Set up polling interval
    pollingRef.current = setInterval(() => { 
      fetchInProgressUploads(); 
    }, 5000); 

    return () => { 
      if (pollingRef.current) { 
        clearInterval(pollingRef.current); 
        pollingRef.current = null;
      } 
    };
  }, [user, fetchInProgressUploads]);


  /* ===============================
     FOLLOWERS
  =============================== */
  useEffect(() => {
    if (!user) return;
    getFollowers(user)
      .then(setFollower)
      .catch(console.error);
  }, [user]);

  /* ===============================
     VIDEO FEED (INFINITE SCROLL)
  =============================== */
  const fetchVideos = async ({ pageParam = 0 }) => {
    if (!user) {
      console.error('No user found');
      return [];
    }

    const pageSize = 20;

    try {
      // Use new reliable API endpoint with server-side pagination
      const res = await axios.get(`${MY_VIDEOS_URL}/api/my-videos`, {
        params: {
          username: user,
          limit: pageSize,
          offset: pageParam * pageSize,
          status: 'all', // Get published and scheduled videos
          sort: 'newest', // Sort by newest first
          include_unlisted: 1, // own profile: show unlisted videos (badged) so they can be re-listed
        },
        headers: {
          'Content-Type': 'application/json'
        }
      });

      const responseData = res.data?.data || {};
      const allVideos = responseData.videos || [];
      
      // Filter out "uploaded" status videos (incomplete uploads)
      const filteredVideos = allVideos.filter(video => video.status !== 'uploaded');
      
      // Attach original count for pagination logic
      filteredVideos._originalCount = allVideos.length;
      
      return filteredVideos;
    } catch (error) {
      console.error('Failed to fetch videos:', error.response?.status, error.response?.data);
      toast.error('Failed to load videos');
      return [];
    }
  };

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    refetch,
  } = useInfiniteQuery({
    queryKey: ["ProfilePage", user],
    queryFn: fetchVideos,
    getNextPageParam: (lastPage, allPages) => {
      // Check original count before filtering to determine if more pages exist
      const originalCount = lastPage?._originalCount || lastPage?.length || 0;
      if (!lastPage || originalCount < 20) return undefined;
      // Return the next page number
      return allPages.length;
    },
  });

  // Store refetch in ref for use in fetchInProgressUploads
  useEffect(() => {
    refetchRef.current = refetch;
  }, [refetch]);

  const videos = useMemo(() => data?.pages.flat() || [], [data]);

  // ───── Scheduled posts (own profile only) ─────
  // Scheduled videos aren't on Hive yet, so they come from the checker, not the
  // my-videos API. We surface them in the Videos list at the position they will
  // occupy once live — i.e. above the published posts (their publish date is in
  // the future), newest scheduled first — each with a "Scheduled" badge. The
  // card links to the watch page in scheduled mode (see Card3 + Watch).
  const { data: scheduledData } = useQuery({
    queryKey: ["profile-scheduled-posts", user],
    queryFn: () => fetchScheduledPosts(user),
    enabled: !!user,
    staleTime: 30 * 1000,
  });

  // Community-post count for the tab header (like Playlists shows its count).
  const { data: snapCountData } = useQuery({
    queryKey: ["community-snaps-count", user],
    queryFn: () => fetchSnaps(user, 1, 1),
    enabled: !!user,
    staleTime: 60 * 1000,
  });
  const snapCount = snapCountData?.total || 0;

  // Video/shorts counts for their tab headers — SAME query key ProfileStats
  // uses for the "50 videos / 14 shorts" stat line, so this is a cache hit,
  // not a second request.
  const { data: profileCounts } = useQuery({
    queryKey: ["profile-counts", user],
    queryFn: async () => (await axios.get(`${CHECKER_URL}/user/${encodeURIComponent(user)}/counts`)).data,
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
  // 🔐 Supporters-only shelf. Public and unfiltered by entitlement on purpose:
  // it exists to show non-subscribers what they are missing. The tab is hidden
  // entirely when the creator has none, so nobody sees an empty paywall pitch.
  const { data: gatedData, isLoading: isGatedLoading } = useQuery({
    queryKey: ["profile-gated", user],
    queryFn: async () =>
      (await axios.get(`${CHECKER_URL}/feeds/creator-gated/${encodeURIComponent(user)}?limit=48`)).data,
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
  const gatedVideos = gatedData?.videos || [];
  const hasGated = gatedVideos.length > 0;

  const videoCount = profileCounts?.videos || 0;
  const shortsCount = profileCounts?.shorts || 0;

  // Audio count for its tab header — the /audio endpoint already returns a
  // `total` alongside the page of items; limit=1 keeps this a count-only call.
  const { data: audioCountData } = useQuery({
    queryKey: ["audio-count", user],
    queryFn: async () => (await axios.get(`${CHECKER_URL}/audio?owner=${encodeURIComponent(user)}&limit=1`)).data,
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
  const audioCount = audioCountData?.total || 0;

  // Streams tab only exists when there's something to show — a running
  // OpenPods session, or the VOD of a finished one. Counts both.
  const { data: streamCount = 0 } = useQuery({
    queryKey: ["profile-streams-count", user],
    queryFn: async () => {
      const hangoutsApi = (import.meta.env.VITE_HANGOUTS_API_URL || '').replace(/\/$/, '');
      const [vods, rooms] = await Promise.all([
        axios
          .get(`${MY_VIDEOS_URL}/api/my-videos?username=${encodeURIComponent(user)}&limit=50&status=published&openpod=1`)
          .then((r) => r.data?.data?.videos || [])
          .catch(() => []),
        hangoutsApi
          ? fetch(`${hangoutsApi}/streams`)
              .then((r) => (r.ok ? r.json() : []))
              .then((list) => (Array.isArray(list) ? list : []).filter(
                (x) => String(x.host || '').toLowerCase() === String(user).toLowerCase(),
              ))
              .catch(() => [])
          : Promise.resolve([]),
      ]);
      return vods.length + rooms.length;
    },
    enabled: !!user,
    staleTime: 60 * 1000,
  });

  const scheduledCards = useMemo(() => {
    return (scheduledData || [])
      .map(normalizeScheduledForCard)
      .sort((a, b) => new Date(b.scheduledOn || 0) - new Date(a.scheduledOn || 0));
  }, [scheduledData]);

  // The Videos tab list: scheduled (future) on top, then the published feed.
  // Kept separate from `videos` so the on-chain batch hooks below don't try to
  // resolve content/views for posts that don't exist on Hive yet.
  const videoListItems = useMemo(
    () => [...scheduledCards, ...videos],
    [scheduledCards, videos],
  );

  // Batch fetch content data
  const { getContentForVideo } = useContentBatch(videos);

  // Batch check watch history
  const { isWatched } = useWatchHistory(videos);

  // Batch fetch view counts
  const { getViewCount } = useViewCounts(videos);

  /* ===============================
     SHORTS FEED
  =============================== */
  const fetchMyShorts = async ({ pageParam = 1 }) => {
    // Own profile: include unlisted shorts (badged) so they can be re-listed.
    const data = await fetchUserShortsWithDetails(user, pageParam, 20, true);
    return data;
  };

  const {
    data: shortsData,
    fetchNextPage: fetchNextShortsPage,
    hasNextPage: hasNextShortsPage,
    isFetchingNextPage: isFetchingNextShortsPage,
    isLoading: isShortsLoading,
  } = useInfiniteQuery({
    queryKey: ["MyShorts", user],
    queryFn: fetchMyShorts,
    getNextPageParam: (lastPage) => {
      if (lastPage?.page < lastPage?.totalPages) {
        return lastPage.page + 1;
      }
      return undefined;
    },
    enabled: show === 'shorts',
  });

  const shortsVideos = useMemo(() => (
    (shortsData?.pages || []).flatMap(page =>
      (page?.shorts || []).map(s => ({
        author: s.author,
        permlink: s.permlink,
        title: (s.caption || s.title || '').slice(0, 80),
        images: { thumbnail: s.thumbnailUrl },
        duration: 0,
        stats: {
          total_hive_reward: parseFloat(s.stats?.payout) || 0,
          num_votes: s.stats?.likes || 0,
        },
        created_at: s.createdAt,
        unlisted: s.unlisted, // Card3 shows the "Unlisted" badge
      }))
    )
  ), [shortsData?.pages]);

  /* ===============================
     SCROLL HANDLER
  =============================== */
  useEffect(() => {
    const handleScroll = () => {
      if (
        window.innerHeight + window.scrollY >=
          document.body.offsetHeight - 200
      ) {
        if (show === 'shorts' && !isFetchingNextShortsPage && hasNextShortsPage) {
          fetchNextShortsPage();
        } else if (show === 'video' && !isFetchingNextPage && hasNextPage) {
          fetchNextPage();
        }
      }
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, [show, isFetchingNextPage, hasNextPage, fetchNextPage, isFetchingNextShortsPage, hasNextShortsPage, fetchNextShortsPage]);

  /* ===============================
     NAVIGATION
  =============================== */
  const handleUploadNavigate = () => {
    if (!authenticated) {
      toast.error("Login to upload video");
    } else {
      navigate("/studio");
    }
  };

  return (
    <div className="profile-page-container">
      {/* ================= PROFILE HEADER ================= */}
      <ProfileHeader
        username={user}
        name={user}
        fetchBio
        showHandle
        meta={<ProfileStats username={user} followers={follower?.follower_count} onFollowersClick={() => setShow("follower")} />}
        refreshKey={profileRefreshKey}
        onAvatarClick={() => setEditProfileOpen(true)}
        badges={
          <>
            {/* Hive/PeakD badges take the first line; ours wrap underneath.
                This page is only ever the signed-in user's own profile, so the
                arrange controls always apply. */}
            <HiveBadges username={user} canArrange />
            <div className="own-badges">
              <LeaderboardBadges username={user} />
              <SocialLinks
                hiveUsername={user}
                refreshKey={socialLinksRefreshKey}
                canDelete
                onChange={() => setSocialLinksRefreshKey((k) => k + 1)}
              />
              <button
                type="button"
                className="add-social-link-btn"
                onClick={() => setShowSocialLinkModal(true)}
                title="Link an external profile"
              >
                <FaPlus /> Add profile
              </button>
            </div>
          </>
        }
        actions={
          <>
            <button
              className="btn btn-secondary"
              onClick={() => setEditProfileOpen(true)}
              title="Edit your picture, name, bio and location"
            >
              <FiEdit2 className="icon" /> Edit
            </button>

            {/* Follower pill removed — the count in the stat line under the bio
                opens this list instead. */}
            <button
              className="btn btn-secondary"
              onClick={async () => {
                const profileUrl = `${window.location.origin}/@${user}`;
                const shareData = { title: `${user} on 3Speak`, url: profileUrl };
                try {
                  if (navigator.share && navigator.canShare?.(shareData)) {
                    await navigator.share(shareData);
                  } else {
                    await navigator.clipboard.writeText(profileUrl);
                    toast.success('Profile link copied to clipboard!');
                  }
                } catch (err) {
                  if (err.name !== 'AbortError') {
                    await navigator.clipboard.writeText(profileUrl);
                    toast.success('Profile link copied to clipboard!');
                  }
                }
              }}
            >
              <IoMdShare />
            </button>
          </>
        }
      />

      {/* ================= TOGGLE ================= */}
      <div className="toggle-wrap">
        <div className="wrap">
          <span className={show === "overview" ? "active" : ""} onClick={() => selectTab("overview")}>Overview</span>
          <span className={show === "video" ? "active" : ""} onClick={() => selectTab("video")}>
            Videos {videoCount > 0 && `(${videoCount})`}
          </span>
          <span className={show === "shorts" ? "active" : ""} onClick={() => selectTab("shorts")}>
            Shorts {shortsCount > 0 && `(${shortsCount})`}
          </span>
          <span className={show === "audio" ? "active" : ""} onClick={() => selectTab("audio")}>
            Audio {audioCount > 0 && `(${audioCount})`}
          </span>
          {hasGated && (
            <span className={show === "supporters" ? "active" : ""} onClick={() => selectTab("supporters")}>
              🔒 Supporters ({gatedVideos.length})
            </span>
          )}
          {streamCount > 0 && (
            <span className={show === "streams" ? "active" : ""} onClick={() => selectTab("streams")}>
              Streams ({streamCount})
            </span>
          )}
          <span className={show === "community" ? "active" : ""} onClick={() => selectTab("community")}>
            Community {snapCount > 0 && `(${snapCount})`}
          </span>
          <span className={show === "playlists" ? "active" : ""} onClick={() => selectTab("playlists")}>
            Playlists
          </span>
          <span className={show === "links" ? "active" : ""} onClick={() => selectTab("links")}>Links</span>
          <span className={show === "stats" ? "active" : ""} onClick={() => selectTab("stats")}>Analytics</span>
        </div>

        <div className="wrap-in">
          <span onClick={() => navigate(`/wallet/${user}`)}>Wallet</span>
        </div>
      </div>

    {inProgress?.count > 0 && (
      <div className="active-renders">
        {inProgress.videos.map(video => { 
          const progress = Number(video.progress_percent).toFixed(2);

          return (
          <div key={video.video_id} className="render-card">
          <div className="left">
            <div className="icon">▶</div>
            <div className="info">
              <h3>{video.title}</h3>
              <p className="sub">🎬 Processing your videos</p>
              <div className="meta">
                <span className="status">{video.status_label}</span>
                <span className="time">{video.elapsed_minutes} min ago</span>
              </div>
            </div>
          </div>

         <div className="wrap-progress">
          <div className="right">
            <div className="percent">{progress}%</div>
          </div>
          <div className="progress">
            <div className="bar" style={{ width: `${progress}%` }}></div>
          </div>
        </div>
        </div>
      )})}
      </div>
      )}


      


      

      {/* ================= VIDEO LIST / PLAYLISTS ================= */}
      <div className="container-video">
        {show === "overview" ? (
          <ProfileOverview
            username={user}
            /* /profile IS the signed-in user's own profile, and /p/<self>
               redirects here, so this is unconditionally true. Without it
               ChannelTrailer defaulted to isOwnProfile=false and swallowed the
               "Add a channel trailer" prompt, leaving the feature undiscoverable
               for anyone who hadn't already set one. */
            isOwnProfile
            videos={videoListItems}
            shorts={shortsVideos}
            playlists={playlists}
            snapCount={snapCount}
            onOpenTab={selectTab}
            getContentForVideo={getContentForVideo}
            isWatched={isWatched}
            getViewCount={getViewCount}
          />
        ) : show === "video" ? (
          isLoading ? (
            <BarLoader />
          ) : videoListItems.length === 0 ? (
            <ProfileEmptyState kind="video" isOwnProfile username={user} />
          ) : (
            <Card3 videos={videoListItems} loading={isFetchingNextPage} getContentForVideo={getContentForVideo} isWatched={isWatched} getViewCount={getViewCount} />
          )
        ) : show === "shorts" ? (
          isShortsLoading ? (
            <BarLoader />
          ) : shortsVideos.length === 0 ? (
            <ProfileEmptyState kind="shorts" isOwnProfile username={user} />
          ) : (
            <Card3 videos={shortsVideos} loading={isFetchingNextShortsPage} linkPrefix="/shorts" linkQuery={`&user=${user}`} getViewCount={getViewCount} shortsGrid />
          )
        ) : show === "supporters" ? (
          isGatedLoading ? (
            <BarLoader />
          ) : (
            <Card3 videos={gatedVideos} getViewCount={getViewCount} />
          )
        ) : show === "audio" ? (
          <UserAudioList user={user} isOwnProfile />
        ) : show === "streams" ? (
          <ProfileStreams user={user} getViewCount={getViewCount} />
        ) : show === "community" ? (
          <CommunitySnaps user={user} canPost={!!user} targetPermlink={targetSnap} openComments={openSnapComments} />
        ) : show === "links" ? (
          <SpotlightEditor username={user} />
        ) : show === "stats" ? (
          <CreatorStats user={user} />
        ) : show === "playlists" ? (
          <>
            <button className="create-playlist-btn" onClick={() => setShowCreateModal(true)}>
              <IoMdAdd /> Create Playlist
            </button>
            {playlistsLoading && watchedCountLoading ? (
              <BarLoader />
            ) : (
              <>
                {/* Special playlists row: Watch Later and Watched */}
                <div className="special-playlists-row">
                  {/* Watch Later playlist */}
                  {playlists.find(p => p.name === WATCH_LATER_NAME) && (
                    <WatchLaterPlaylistCard
                      playlist={playlists.find(p => p.name === WATCH_LATER_NAME)}
                      username={user}
                    />
                  )}
                  {/* Watched Videos pseudo-playlist */}
                  {watchedCount > 0 && (
                    <WatchedPlaylistCard count={watchedCount} username={user} />
                  )}
                </div>
                {/* Regular playlists (excluding Watch Later) */}
                {playlists.filter(p => p.name !== WATCH_LATER_NAME).length === 0 && watchedCount === 0 && !playlists.find(p => p.name === WATCH_LATER_NAME) ? (
                  <ProfileEmptyState
                    kind="playlists"
                    isOwnProfile
                    username={user}
                    onAction={() => setShowCreateModal(true)}
                  />
                ) : (
                  <PlaylistCard playlists={playlists.filter(p => p.name !== WATCH_LATER_NAME)} loading={playlistsLoading} showPrivacyBadge={true} />
                )}
              </>
            )}
          </>
        ) : (
          <Follower count={follower} username={user} />
        )}
      </div>

      {/* Create Playlist Modal */}
      {showCreateModal && (
        <div className="create-playlist-modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="create-playlist-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Create New Playlist</h3>
            <div className="form-group">
              <label>Playlist Name</label>
              <input
                type="text"
                value={newPlaylistName}
                onChange={(e) => setNewPlaylistName(e.target.value)}
                placeholder="Enter playlist name"
                autoFocus
              />
            </div>
            <div className="form-group">
              <label>Visibility</label>
              <div className="privacy-buttons">
                <button
                  type="button"
                  className={`privacy-btn ${newPlaylistAccess === 'public' ? 'active' : ''}`}
                  onClick={() => setNewPlaylistAccess('public')}
                >
                  <MdPublic /> Public
                </button>
                <button
                  type="button"
                  className={`privacy-btn ${newPlaylistAccess === 'private' ? 'active' : ''}`}
                  onClick={() => setNewPlaylistAccess('private')}
                >
                  <MdLock /> Private
                </button>
              </div>
            </div>
            <div className="form-group">
              <label>Tags</label>
              <div className="tags-input-wrap">
                <div className="tags-list">
                  {newPlaylistTags.map((tag) => (
                    <span key={tag} className="tag-chip">
                      {tag}
                      <button type="button" onClick={() => setNewPlaylistTags(prev => prev.filter(t => t !== tag))}>
                        <MdClose />
                      </button>
                    </span>
                  ))}
                </div>
                <input
                  type="text"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.key === 'Enter' || e.key === ',' || e.key === ' ') && tagInput.trim()) {
                      e.preventDefault();
                      const tag = tagInput.trim().toLowerCase().replace(/,/g, '');
                      if (tag && !newPlaylistTags.includes(tag)) {
                        setNewPlaylistTags(prev => [...prev, tag]);
                      }
                      setTagInput('');
                    } else if (e.key === 'Backspace' && !tagInput && newPlaylistTags.length > 0) {
                      setNewPlaylistTags(prev => prev.slice(0, -1));
                    }
                  }}
                  placeholder={newPlaylistTags.length === 0 ? 'Type a tag and press Enter' : 'Add more...'}
                />
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn-cancel" onClick={() => setShowCreateModal(false)} disabled={isCreating}>
                Cancel
              </button>
              <button className="btn-create" onClick={handleCreatePlaylist} disabled={isCreating}>
                {isCreating ? 'Creating...' : 'Create Playlist'}
              </button>
            </div>
          </div>
        </div>
      )}

      <AddSocialLink_modal
        isOpen={showSocialLinkModal}
        onClose={() => setShowSocialLinkModal(false)}
        hiveUsername={user}
        onChange={() => setSocialLinksRefreshKey((k) => k + 1)}
      />

      <EditVideoHintModal
        isOpen={showEditHint}
        onClose={() => setShowEditHint(false)}
      />

      <ProfileEditModal
        open={editProfileOpen}
        username={user}
        onClose={() => setEditProfileOpen(false)}
        onSaved={() => setProfileRefreshKey((k) => k + 1)}
      />
    </div>
  );
}

export default ProfilePage;