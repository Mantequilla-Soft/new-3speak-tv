import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom';
import { getFollowers, getRelationshipBetweenAccounts, isAccountValid } from '../../hive-api/api';
// Aliased: this component already has a local `isCreatorHidden` boolean (the
// viewer's PERSONAL "not interested" hide state). This one is the moderation check.
import { isCreatorHidden as isModeratedCreatorHidden } from '../../utils/hiddenCreators';
import { followWithAioha, isLoggedIn } from '../../hive-api/aioha';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import "./UserProfilePage.scss"
import BarLoader from '../Loader/BarLoader';
import { Quantum } from 'ldrs/react'
import 'ldrs/react/Quantum.css'
import { useInfiniteQuery, useQuery, useQueryClient as useReactQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { MY_VIDEOS_URL, CHECKER_URL } from '../../utils/config';
import Card3 from '../Cards/Card3';
import { IoMdShare, IoMdAdd } from 'react-icons/io';
import { MdRssFeed } from 'react-icons/md';
import { MdAdd, MdClose, MdPlayArrow, MdFlag, MdChatBubbleOutline } from 'react-icons/md';
import ReportModal, { isReported } from '../modal/ReportModal';
import { RiUserFollowLine, RiUserUnfollowLine } from 'react-icons/ri';
import { BiDollar } from 'react-icons/bi';
import { IoBanOutline, IoEyeOutline } from 'react-icons/io5';
import { getHidden, hideCreator, unhideCreator } from '../../utils/userFilters';
import Follower from './Follower';
import PlaylistCard from '../Cards/PlaylistCard';
import { useUserPlaylists } from '../../hooks/useUserPlaylists';
import { useAppStore } from '../../lib/store';
import CreatorStats from '../CreatorStats/CreatorStats';
import { createPlaylist } from '../../utils/playlistOperations';
import { toastIn } from '../../utils/toast';
import { useContentBatch } from '../../hooks/useContentBatch';
import { useWatchHistory } from '../../hooks/useWatchHistory';
import useViewCounts from '../../hooks/useViewCounts';
import { fetchUserShortsWithDetails } from '../../hive-api/hiveApi';
import ShortsIcon from '../icons/ShortsIcon';
import TipModal from '../tip-reward/TipModal';
import UserAudioList from './UserAudioList';
import CommunitySnaps from './CommunitySnaps';
import SpotlightEditor from '../Spotlight/SpotlightEditor';
import ProfileStreams from './ProfileStreams';
import { fetchSnaps } from '../../lib/snaps';
import SocialLinks from './SocialLinks';
import LeaderboardBadges from '../LeaderboardBadges/LeaderboardBadges';
import HiveBadges from '../HiveBadges/HiveBadges';
import ProfileHeader from '../ProfileHeader/ProfileHeader';
import ProfileStats from '../ProfileHeader/ProfileStats';
import ProfileOverview from './ProfileOverview';
import ProfileLinksButton from './ProfileLinksButton';
import ProfileEmptyState from './ProfileEmptyState';

// Every toast from this module is headed "Profile"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Profile');

function UserProfilePage() {
    const { user } = useParams();
    const [searchParams] = useSearchParams();
    const navigate = useNavigate()
    const location = useLocation();
    const queryClient = useReactQueryClient();
    const { user: authenticatedUser, authenticated } = useAppStore();
    const [follower, setFollower] = useState(null)
    const [isFollowing, setIsFollowing] = useState(false);
    const [followLoading, setFollowLoading] = useState(false);
    const [show, setShow] = useState(() => {
      const tab = searchParams.get('tab');
      if (tab === 'playlists') return 'playlists';
      if (tab === 'shorts') return 'shorts';
      if (tab === 'audio') return 'audio';
      if (tab === 'community') return 'community';
      if (tab === 'links') return 'links';
      if (tab === 'stats') return 'stats';
      if (tab === 'video') return 'video';
      // Overview is the landing tab: it shows what KIND of channel this is
      // before dropping the visitor into one endless list.
      return 'overview';
    });

    // Keep tab state in sync with the URL (browser back/forward, sidebar links)
    useEffect(() => {
      const tab = searchParams.get('tab');
      if (tab === 'playlists') setShow('playlists');
      else if (tab === 'shorts') setShow('shorts');
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
      navigate(`${location.pathname}${q}`, { replace: true });
    }, [navigate, location.pathname]);

    // The specific snap an Overview card routed here for (if any).
    const targetSnap = searchParams.get('snap') || null;
    const openSnapComments = searchParams.get('comments') === '1';

    // Tabs are a horizontal scroll rail, so the selected one can start out
    // off-screen — most obviously when a deep link lands on a late tab like
    // Analytics. Bring it into view on change.
    const tabsRef = useRef(null);
    useEffect(() => {
      const active = tabsRef.current?.querySelector('span.active');
      active?.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' });
    }, [show]);

    const [showCreateModal, setShowCreateModal] = useState(false);
    const [newPlaylistName, setNewPlaylistName] = useState('');
    const [newPlaylistAccess, setNewPlaylistAccess] = useState('public');
    const [isCreating, setIsCreating] = useState(false);
    const [isReportOpen, setIsReportOpen] = useState(false);
    const [fabOpen, setFabOpen] = useState(false);
    const [isTipModalOpen, setIsTipModalOpen] = useState(false);

    // Check if viewing own profile and redirect to /profile
    const isOwnProfile = authenticatedUser && authenticatedUser.toLowerCase() === user?.toLowerCase();
    // Stats are own-profile-only, except these admins who can view any profile's stats.
    const STATS_ADMINS = ['tibfox', 'badadib'];
    const canSeeStats = isOwnProfile || STATS_ADMINS.includes(authenticatedUser?.toLowerCase());

    // ── "Don't show this creator" (same suppression as the card ⋮ menu) ──
    const rqClient = useReactQueryClient();
    const [hideLoading, setHideLoading] = useState(false);
    const { data: hiddenData } = useQuery({
      queryKey: ['hidden-creators', authenticatedUser],
      queryFn: () => getHidden(authenticatedUser),
      enabled: !!authenticatedUser,
      staleTime: 5 * 60 * 1000,
    });
    const isCreatorHidden = !!hiddenData?.creators?.some(
      (c) => String(c.creator).toLowerCase() === String(user).toLowerCase()
    );

    // Community-post count for the tab header (like Playlists shows its count).
    const { data: snapCountData } = useQuery({
      queryKey: ['community-snaps-count', user],
      queryFn: () => fetchSnaps(user, 1, 1),
      enabled: !!user && user !== 'unknown',
      staleTime: 60 * 1000,
    });
    const snapCount = snapCountData?.total || 0;

    // Video/shorts counts for their tab headers — SAME query key ProfileStats
    // uses for the "50 videos / 14 shorts" stat line, so this is a cache hit,
    // not a second request.
    const { data: profileCounts } = useQuery({
      queryKey: ['profile-counts', user],
      queryFn: async () => (await axios.get(`${CHECKER_URL}/user/${encodeURIComponent(user)}/counts`)).data,
      enabled: !!user && user !== 'unknown',
      staleTime: 5 * 60 * 1000,
      retry: 1,
    });
    const videoCount = profileCounts?.videos || 0;
    const shortsCount = profileCounts?.shorts || 0;

    // Audio count for its tab header — the /audio endpoint already returns a
    // `total` alongside the page of items; limit=1 keeps this a count-only call.
    const { data: audioCountData } = useQuery({
      queryKey: ['audio-count', user],
      queryFn: async () => (await axios.get(`${CHECKER_URL}/audio?owner=${encodeURIComponent(user)}&limit=1`)).data,
      enabled: !!user && user !== 'unknown',
      staleTime: 5 * 60 * 1000,
      retry: 1,
    });
    const audioCount = audioCountData?.total || 0;

    // 🔐 Supporters-only shelf. Public and unfiltered by entitlement on purpose:
    // it exists to show non-subscribers what they are missing. The tab is hidden
    // entirely when the creator has none, so nobody sees an empty paywall pitch.
    const { data: gatedData } = useQuery({
      queryKey: ['profile-gated', user],
      queryFn: async () =>
        (await axios.get(`${CHECKER_URL}/feeds/creator-gated/${encodeURIComponent(user)}?limit=48`)).data,
      enabled: !!user,
      staleTime: 5 * 60 * 1000,
      retry: 1,
    });
    const gatedVideos = gatedData?.videos || [];
    const hasGated = gatedVideos.length > 0;

    // The Streams tab only exists when there's something to show — a running
    // OpenPods session, or the VOD of a finished one. Counts both.
    const { data: streamCount = 0 } = useQuery({
      queryKey: ['profile-streams-count', user],
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
      enabled: !!user && user !== 'unknown',
      staleTime: 60 * 1000,
    });

    const handleHideToggle = useCallback(async () => {
      if (!authenticatedUser || !user || isOwnProfile) return;
      setHideLoading(true);
      const ok = isCreatorHidden
        ? await unhideCreator(authenticatedUser, user)
        : await hideCreator(authenticatedUser, user);
      setHideLoading(false);
      if (!ok) {
        toast.error('Could not update. Please try again.');
        return;
      }
      // Refresh the toggle itself, then every feed that filters on it.
      await rqClient.invalidateQueries({ queryKey: ['hidden-creators', authenticatedUser] });
      ['discover-grouped', 'trending-grouped', 'newcontent-grouped', 'promoted-grouped',
        'home-grouped', 'follow-feed', 'trending', 'shorts'].forEach((k) =>
        rqClient.invalidateQueries({ queryKey: [k] }));

      toast.success(
        isCreatorHidden
          ? `@${user}'s videos will show in your feeds again`
          : `Hiding @${user}'s videos from your feeds`,
        {
          action: {
            label: 'Undo',
            onClick: async () => {
              if (isCreatorHidden) await hideCreator(authenticatedUser, user);
              else await unhideCreator(authenticatedUser, user);
              rqClient.invalidateQueries({ queryKey: ['hidden-creators', authenticatedUser] });
            },
          },
        }
      );
    }, [authenticatedUser, user, isOwnProfile, isCreatorHidden, rqClient]);

    // Redirect to /profile if viewing own profile
    useEffect(() => {
      if (isOwnProfile) {
        // Carry the WHOLE query through, not just `tab` — the Overview page's
        // community cards also pass `snap`/`comments`, and dropping those landed
        // the owner on a bare Community tab instead of the snap they clicked.
        const qs = searchParams.toString();
        navigate(qs ? `/profile?${qs}` : '/profile', { replace: true });
      }
    }, [isOwnProfile, navigate, searchParams]);

    // Check if account exists on Hive
    const [userExists, setUserExists] = useState(null); // null = loading, true/false = result
    useEffect(() => {
      if (!user || isOwnProfile) return;
      setUserExists(null);
      isAccountValid(user).then(setUserExists);
    }, [user, isOwnProfile]);

    // Hidden (moderated) creator: their whole profile is replaced with a
    // "not available" state. Only for OTHER users — a hidden viewer looking at their
    // own URL is redirected to /profile above, and self-moderation is handled by the
    // app-level gate. Fails open (shows the profile) on any check error.
    const [isHiddenProfile, setIsHiddenProfile] = useState(false);
    useEffect(() => {
      if (!user || isOwnProfile) { setIsHiddenProfile(false); return; }
      let alive = true;
      isModeratedCreatorHidden(user).then((h) => { if (alive) setIsHiddenProfile(h); });
      return () => { alive = false; };
    }, [user, isOwnProfile]);

    // Fetch user's public playlists
    const { data: playlists = [], isLoading: playlistsLoading, error: playlistsError, refetch: refetchPlaylists } = useUserPlaylists(user);

    // Handle create playlist
    const handleCreatePlaylist = async () => {
      if (!newPlaylistName.trim()) {
        toast.error('Please enter a playlist name');
        return;
      }

      setIsCreating(true);
      try {
        await createPlaylist(newPlaylistName.trim(), newPlaylistAccess);
        toast.success('Playlist created! It may take a moment to appear.');
        setShowCreateModal(false);
        setNewPlaylistName('');
        setNewPlaylistAccess('public');
        // Refetch playlists after a short delay to allow blockchain indexing
        setTimeout(() => {
          refetchPlaylists();
          queryClient.invalidateQueries(['userPlaylists', user]);
        }, 3000);
      } catch (error) {
        toast.error('Failed to create playlist: ' + error.message);
      } finally {
        setIsCreating(false);
      }
    };

      // GET_TOTAL_COUNT_OF_FOLLOWING
      // const { username } = useParams();
      useEffect(() => {
        if (user) {
          getFollowersCount(user)
        }
      }, [user])

 const LIMIT = 20;

const fetchVideos = async ({ pageParam = 0 }) => {
  // On your own profile, also return unlisted videos (badged) so they can be re-listed.
  const ownParam = isOwnProfile ? '&include_unlisted=1' : '';
  const url = `${MY_VIDEOS_URL}/api/my-videos?username=${user}&limit=${LIMIT}&offset=${pageParam}&status=published&sort=newest${ownParam}`;

  const res = await axios.get(url);
  return res.data?.data?.videos || [];
};

      
const {
  data,
  fetchNextPage,
  hasNextPage,
  isFetchingNextPage,
  isLoading,
} = useInfiniteQuery({
  queryKey: ["UserProfilePage", user],
  queryFn: fetchVideos,
  getNextPageParam: (lastPage, allPages) => {
    // If the last page has LIMIT items, there might be more
    if (lastPage.length === LIMIT) {
      return allPages.flat().length; // next offset = total items loaded so far
    }
    return undefined; // stop if last page had fewer than LIMIT items
  },
});

            // Shorts feed for this user
            const fetchUserShorts = async ({ pageParam = 1 }) => {
              // On your own profile, include unlisted shorts (badged) so they can be re-listed.
              const data = await fetchUserShortsWithDetails(user, pageParam, 20, isOwnProfile);
              return data;
            };

            const {
              data: shortsData,
              fetchNextPage: fetchNextShortsPage,
              hasNextPage: hasNextShortsPage,
              isFetchingNextPage: isFetchingNextShortsPage,
              isLoading: isShortsLoading,
            } = useInfiniteQuery({
              queryKey: ["UserShorts", user, isOwnProfile],
              queryFn: fetchUserShorts,
              getNextPageParam: (lastPage) => {
                if (lastPage?.page < lastPage?.totalPages) {
                  return lastPage.page + 1;
                }
                return undefined;
              },
              // Always fetch first page so FAB can show "Latest Short"
              enabled: true,
            });

            // Flatten shorts pages and map to Card3 format
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

            // Flatten all pages into a single array
            const videos = useMemo(() => data?.pages.flat() || [], [data?.pages]);

            // Latest video & short for FAB quick-access
            const latestVideo = videos[0];
            const latestShort = shortsVideos[0];

            // Batch fetch content data
            const { getContentForVideo } = useContentBatch(videos);

            // Batch check watch history
            const { isWatched } = useWatchHistory(videos);
            
            // Batch fetch view counts
            const { getViewCount } = useViewCounts(videos);

      // const { loading, error, data } = useQuery(GET_SOCIAL_FEED_BY_CREATOR, {
      //   variables: { id: user },
      // });
      // const videos = data?.socialFeed?.items || [];
      // console.log(videos);
    
    
      const getFollowersCount = async (user)=>{
        try{
          const follower = await getFollowers(user)
        setFollower(follower)
        } catch (err){
          console.error(err)
        }
      }

      // Check follow relationship on mount
      useEffect(() => {
        if (authenticated && authenticatedUser && user && authenticatedUser.toLowerCase() !== user.toLowerCase()) {
          getRelationshipBetweenAccounts(authenticatedUser, user).then((rel) => {
            if (rel) setIsFollowing(rel.follows);
          });
        }
      }, [authenticated, authenticatedUser, user]);

      const handleFollowToggle = async () => {
        // Follow is the point of a profile, so the button shows to signed-out
        // visitors too — it just asks them to sign in (same as AuthorBadge).
        if (!authenticated) {
          toast.error('Please login to follow users');
          return;
        }
        if (followLoading) return;
        setFollowLoading(true);
        try {
          await followWithAioha(user, !isFollowing);
          setIsFollowing(!isFollowing);
          // Refresh follower count
          getFollowersCount(user);
          toast.success(isFollowing ? `Unfollowed @${user}` : `Now following @${user}`);
        } catch (err) {
          console.error('Follow error:', err);
          toast.error('Follow action failed: ' + (err.message || 'Unknown error'));
        } finally {
          setFollowLoading(false);
        }
      };

      const handleWalletNavigate = (user)=>{
        navigate(`/wallet/${user}`)
      }
    
  if (userExists === null && !isOwnProfile) {
    return <div className="profile-page-container"><BarLoader /></div>;
  }

  if (userExists === false) {
    return (
      <div className="profile-page-container">
        <div className="empty-wrap" style={{ padding: '4rem 1rem', textAlign: 'center' }}>
          <h2 style={{ fontSize: '3rem', marginBottom: '0.5rem' }}>404</h2>
          <p style={{ fontSize: '1.2rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
            User <strong>@{user}</strong> does not exist
          </p>
          <button onClick={() => navigate('/')} style={{ padding: '10px 24px', borderRadius: '8px', background: 'var(--accent-primary, #e53935)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: '14px' }}>
            Go Home
          </button>
        </div>
      </div>
    );
  }

  // Hidden (moderated) creator — replace the whole profile with a neutral notice.
  if (isHiddenProfile) {
    return (
      <div className="profile-page-container">
        <div className="empty-wrap" style={{ padding: '4rem 1rem', textAlign: 'center' }}>
          <p style={{ fontSize: '1.2rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
            This profile is not available.
          </p>
          <button onClick={() => navigate('/')} style={{ padding: '10px 24px', borderRadius: '8px', background: 'var(--accent-primary, #e53935)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: '14px' }}>
            Go Home
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="profile-page-container">
      <ProfileHeader
        username={user}
        name={user}
        fetchBio
        showHandle
        meta={<ProfileStats username={user} followers={follower?.follower_count} onFollowersClick={() => setShow("follower")} />}
        nameActions={!isOwnProfile ? (
          <>
            {/* Own classes, not btn-follow: a global
                `[data-theme="dark"] .btn-follow` rule forces the red outline
                with !important, and these are deliberately not red. */}
            <button
              className={`btn ${isFollowing ? 'btn-hero-following' : 'btn-hero-follow'}`}
              onClick={handleFollowToggle}
              disabled={followLoading}
            >
              {followLoading ? 'Loading...' : isFollowing ? 'Following' : 'Follow'}
            </button>
            <button
              className="btn btn-hero-message"
              title={`Message @${user}`}
              onClick={() => {
                if (!authenticated) { toast.error('Please login to send a message'); return; }
                navigate(`/chat?dm=${encodeURIComponent(user)}`);
              }}
            >
              <MdChatBubbleOutline /> Message
            </button>
            {/* Narrow screens only: below 1025px the framed links page beside
                Overview isn't rendered, so this is the way through to it. It
                sits directly under Message (see ProfileLinksButton.scss). */}
            <ProfileLinksButton username={user} />
          </>
        ) : null}
        badges={
          <>
            {/* Hive/PeakD badges take the first line; ours wrap underneath. */}
            <HiveBadges username={user} canArrange={isOwnProfile} />
            <div className="own-badges">
              <LeaderboardBadges username={user} />
              <SocialLinks hiveUsername={user} />
            </div>
          </>
        }
        actions={
          <>
            {/* The follower pill is gone — the count lives in the stat line
                under the bio, which opens this same list when clicked. */}
            {authenticated && !isOwnProfile && (
              <button
                className={`btn ${isCreatorHidden ? 'btn-hidden-creator' : 'btn-secondary'}`}
                onClick={handleHideToggle}
                disabled={hideLoading}
                title={isCreatorHidden
                  ? `Show @${user}'s videos in your feeds again`
                  : `Hide @${user}'s videos from all your feeds`}
              >
                {hideLoading
                  ? 'Loading...'
                  : isCreatorHidden
                    ? <><IoEyeOutline /> Unhide</>
                    : <><IoBanOutline /> Hide</>}
              </button>
            )}
            {/* Podcast / RSS feed for the channel. React 19 hoists the <link>
                into <head>, which is what makes browsers and feed readers
                auto-discover it; the button is for people who already know
                what to do with a feed URL. */}
            <link
              rel="alternate"
              type="application/rss+xml"
              title={`${user} on 3Speak`}
              href={`${window.location.origin}/rss/${user}.xml`}
            />
            <a
              className="btn btn-secondary"
              href={`/rss/${user}.xml`}
              target="_blank"
              rel="noreferrer"
              title={`Podcast feed for @${user} — subscribe in any podcast app or RSS reader`}
            >
              <MdRssFeed />
            </a>
            <button
              className="btn btn-secondary"
              onClick={async () => {
                const profileUrl = `${window.location.origin}/@${user}`;
                const shareData = { title: `${user} on 3Speak`, text: `Follow ${user} on 3Speak`, url: profileUrl };
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
            <button
              className={`btn btn-secondary${isReported('user', user) ? ' reported' : ''}`}
              onClick={() => setIsReportOpen(true)}
              title="Report user"
            >
              <MdFlag />
            </button>
          </>
        }
      />
      <div className="toggle-wrap">
        <div className="wrap" ref={tabsRef}>
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
            Playlists {playlists.length > 0 && `(${playlists.length})`}
          </span>
          {isOwnProfile && (
            <span className={show === "links" ? "active" : ""} onClick={() => selectTab("links")}>Links</span>
          )}
          {canSeeStats && (
            <span className={show === "stats" ? "active" : ""} onClick={() => selectTab("stats")}>Analytics</span>
          )}
          {/* Wallet navigates away rather than switching tabs, but it lives IN
              the tab flow: floated outside it, it took its own line on a phone
              and pushed the last tab onto a third. */}
          <span className="tab-wallet" onClick={()=>{handleWalletNavigate(user)}}>Wallet</span>
        </div>
      </div>
      <div className="container-video">
  {show === "overview" ? (
    <ProfileOverview
      username={user}
      isOwnProfile={isOwnProfile}
      videos={videos}
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
    ) : videos?.length === 0 ? (
      <ProfileEmptyState kind="video" isOwnProfile={isOwnProfile} username={user} />
    ) : (
      <Card3 videos={videos} loading={isFetchingNextPage} getContentForVideo={getContentForVideo} isWatched={isWatched} getViewCount={getViewCount} />
    )
  ) : show === "shorts" ? (
    isShortsLoading ? (
      <BarLoader />
    ) : shortsVideos.length === 0 ? (
      <ProfileEmptyState kind="shorts" isOwnProfile={isOwnProfile} username={user} />
    ) : (
      <Card3 videos={shortsVideos} loading={isFetchingNextShortsPage} linkPrefix="/shorts" linkQuery={`&user=${user}`} getViewCount={getViewCount} shortsGrid />
    )
  ) : show === "audio" ? (
    <UserAudioList user={user} isOwnProfile={isOwnProfile} />
  ) : show === "supporters" ? (
    <Card3 videos={gatedVideos} getViewCount={getViewCount} />
  ) : show === "streams" ? (
    <ProfileStreams user={user} getViewCount={getViewCount} />
  ) : show === "community" ? (
    <CommunitySnaps user={user} canPost={false} targetPermlink={targetSnap} openComments={openSnapComments} />
  ) : show === "links" ? (
    <SpotlightEditor username={user} />
  ) : show === "stats" ? (
    canSeeStats ? <CreatorStats user={user} /> : null
  ) : show === "playlists" ? (
    <>
      {isOwnProfile && (
        <button className="create-playlist-btn" onClick={() => setShowCreateModal(true)}>
          <IoMdAdd /> Create Playlist
        </button>
      )}
      {playlistsLoading ? (
        <BarLoader />
      ) : playlists.length === 0 ? (
        <ProfileEmptyState
          kind="playlists"
          isOwnProfile={isOwnProfile}
          username={user}
          onAction={() => setShowCreateModal(true)}
        />
      ) : (
        <PlaylistCard playlists={playlists} loading={playlistsLoading} error={playlistsError?.message} />
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
              <select
                value={newPlaylistAccess}
                onChange={(e) => setNewPlaylistAccess(e.target.value)}
              >
                <option value="public">Public</option>
                <option value="private">Private</option>
              </select>
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

      {/* Tip Modal — only mount when open */}
      {isTipModalOpen && (
        <TipModal
          recipient={user}
          isOpen={isTipModalOpen}
          onClose={() => setIsTipModalOpen(false)}
        />
      )}

      {/* Mobile FAB — speed-dial for quick actions on other users' profiles */}
      {createPortal(
        <>
          {fabOpen && (
            <div className="profile-fab-backdrop" onClick={() => setFabOpen(false)} />
          )}
          <div className={`profile-fab-speed-dial${fabOpen ? ' open' : ''}`}>
            {fabOpen && (
              <div className="profile-fab-actions">
                {authenticated && isLoggedIn() && (
                  <div className="profile-fab-action">
                    <span className="profile-fab-action-label">
                      {isFollowing ? 'Unfollow' : 'Follow'}
                    </span>
                    <button
                      className={`profile-fab-action-btn${isFollowing ? ' profile-fab-action-btn--active' : ''}`}
                      onClick={() => { handleFollowToggle(); setFabOpen(false); }}
                      disabled={followLoading}
                      aria-label={isFollowing ? 'Unfollow' : 'Follow'}
                    >
                      {isFollowing ? <RiUserUnfollowLine size={20} /> : <RiUserFollowLine size={20} />}
                    </button>
                  </div>
                )}

                {authenticated && isLoggedIn() && (
                  <div className="profile-fab-action">
                    <span className="profile-fab-action-label">Tip</span>
                    <button
                      className="profile-fab-action-btn"
                      onClick={() => { setIsTipModalOpen(true); setFabOpen(false); }}
                      aria-label="Tip creator"
                    >
                      <BiDollar size={20} />
                    </button>
                  </div>
                )}

                {latestVideo && (
                  <div className="profile-fab-action">
                    <span className="profile-fab-action-label">Latest Video</span>
                    <button
                      className="profile-fab-action-btn"
                      onClick={() => {
                        setFabOpen(false);
                        navigate(`/watch?v=${latestVideo.author}/${latestVideo.permlink}`);
                      }}
                      aria-label="Watch latest video"
                    >
                      <MdPlayArrow size={22} />
                    </button>
                  </div>
                )}

                {latestShort && (
                  <div className="profile-fab-action">
                    <span className="profile-fab-action-label">Latest Short</span>
                    <button
                      className="profile-fab-action-btn"
                      onClick={() => {
                        setFabOpen(false);
                        navigate(`/shorts?v=${latestShort.author}/${latestShort.permlink}&user=${user}`);
                      }}
                      aria-label="Watch latest short"
                    >
                      <ShortsIcon className="profile-fab-shorts-icon" outlineWidth={30} />
                    </button>
                  </div>
                )}
              </div>
            )}

            <button
              className="profile-fab-main"
              onClick={() => setFabOpen(prev => !prev)}
              aria-label={fabOpen ? 'Close menu' : 'Open actions'}
            >
              {fabOpen ? <MdClose size={24} /> : <MdAdd size={24} />}
            </button>
          </div>
        </>,
        document.body
      )}
    <ReportModal
      isOpen={isReportOpen}
      onClose={() => setIsReportOpen(false)}
      type="user"
      target={{ author: user }}
    />
    </div>
  )
}

export default UserProfilePage