import PropTypes from "prop-types";
import "./PlayVideo.scss";
import { FaEye } from "react-icons/fa";
import { LuTimer } from "react-icons/lu";
import { BiLike } from "react-icons/bi";
import { GiTwoCoins } from "react-icons/gi";
import { useEffect, useState, useCallback, useMemo } from "react";
import { useQuery } from "@apollo/client";
import {
  GET_PROFILE,
  GET_VIDEO,
} from "../../graphql/queries";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import BlogContent from "./BlogContent";
import CommentSection from "./CommentSection";
import { useAppStore } from '../../lib/store';
import { MdPeople } from "react-icons/md";
import { estimate, getUersContent, getVotePower } from "../../utils/hiveUtils";
import ToolTip from "../tooltip/ToolTip";
import { ImSpinner9 } from "react-icons/im";
import { useNavigate } from "react-router-dom";
import BarLoader from "../Loader/BarLoader";
import TipModal from "../../components/tip-reward/TipModal";
import { toast } from 'sonner';
import { TailChase } from 'ldrs/react';
import 'ldrs/react/TailChase.css';
import { getFollowers } from "../../hive-api/api";
import UpvoteTooltip from "../tooltip/UpvoteTooltip";
import axios from "axios";
import { FEED_URL } from '../../utils/config';

dayjs.extend(relativeTime);

const PlayVideo = ({ videoDetails, author, permlink }) => {
  const { user, authenticated } = useAppStore();
  const navigate = useNavigate();
  
  // State
  const [hasKeychain, setHasKeychain] = useState(false);
  const [openTooltip, setOpenToolTip] = useState(false);
  const [tooltipVoters, setTooltipVoters] = useState([]);
  const [isTipModalOpen, setIsTipModalOpen] = useState(false);
  const [isVoted, setIsVoted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [followData, setFollowData] = useState(null);
  const [showTooltip, setShowTooltip] = useState(false);
  const [optimisticVoteCount, setOptimisticVoteCount] = useState(0);
  const [accountData, setAccountData] = useState(null);
  const [voteValue, setVoteValue] = useState(0.0);
  const [weight, setWeight] = useState(100);
  const [view, setView] = useState(0);
  const [speakData, setSpeakData] = useState(null);

  // Memoized format function
  const formatRelativeTime = useCallback((date) => {
    const now = dayjs();
    const created = dayjs(date);
    const diffInMinutes = now.diff(created, "minute");
  
    if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
    const diffInHours = now.diff(created, "hour");
    if (diffInHours < 24) return `${diffInHours}h ago`;
    const diffInDays = now.diff(created, "day");
    if (diffInDays < 30) return `${diffInDays}d ago`;
    const diffInMonths = now.diff(created, "month");
    return `${diffInMonths}mo ago`;
  }, []);

  // Queries with proper skip conditions
  const {
    data: getVideo,
    loading: videoLoading,
  } = useQuery(GET_VIDEO, { 
    variables: { author, permlink },
    skip: !author || !permlink,
    ssr: true 
  });

  const getUserProfile = useQuery(GET_PROFILE, {
    variables: { id: videoDetails?.author?.id },
    skip: !videoDetails?.author?.id,
  });

  console.log("Video Data:", getVideo);

  const spkvideo = getVideo?.socialPost?.spkvideo;
  const profile = getUserProfile.data?.profile;
  
  // Memoized values
  const tags = useMemo(() => videoDetails?.tags?.slice(0, 7) || [], [videoDetails?.tags]);
  const comunity_name = useMemo(() => videoDetails?.community?.title, [videoDetails?.community?.title]);
  const community_id = useMemo(() => {
  const raw = videoDetails?.community?._id;
  return raw ? raw.split('/').pop() : null;
}, [videoDetails?.community?._id]);

  console.log("Community ID:", videoDetails);
  // Memoized video URL
  const videoUrlSelected = useMemo(() => {
    if (!spkvideo?.play_url) return null;
    
    const url = spkvideo.play_url;
    if (url.startsWith("ipfs://")) {
      const ipfsHash = url.replace("ipfs://", "");
      return `https://ipfs-3speak.b-cdn.net/ipfs/${ipfsHash}`;
    }
    return url;
  }, [spkvideo?.play_url]);

  // Memoized callbacks to prevent recreating functions
  const calculateVoteValue = useCallback(async (account, percent) => {
    try {
      const data = await estimate(account, percent);
      setVoteValue(data);
    } catch (err) {
      console.error(err);
    }
  }, []);

  const getTooltipVoters = useCallback(async () => {
    try {
      const data = await getUersContent(author, permlink);
      if (!data) return;

      // Batch state updates to prevent multiple re-renders
      const updates = {};

      if (data.active_votes) {
        updates.optimisticVoteCount = data.active_votes.length;
        updates.isVoted = data.active_votes.some(vote => vote.voter === user);

        const totalRshares = data.active_votes.reduce(
          (sum, vote) => sum + parseInt(vote.rshares),
          0
        );

        const totalPayout =
          parseFloat(data.pending_payout_value) > 0
            ? parseFloat(data.pending_payout_value)
            : parseFloat(data.total_payout_value) + parseFloat(data.curator_payout_value);

        const topVotes = data.active_votes
          .sort((a, b) => parseInt(b.rshares) - parseInt(a.rshares))
          .slice(0, 10)
          .map(vote => {
            const reward =
              totalRshares > 0
                ? (parseInt(vote.rshares) / totalRshares) * totalPayout
                : 0;
            return {
              username: vote.voter,
              reward: +reward.toFixed(3),
            };
          });

        updates.tooltipVoters = topVotes;
      }

      // Single state update
      setOptimisticVoteCount(updates.optimisticVoteCount || 0);
      setIsVoted(updates.isVoted || false);
      setTooltipVoters(updates.tooltipVoters || []);
    } catch (error) {
      console.error("Error fetching upvotes:", error);
    }
  }, [author, permlink, user]);

  const speakWatchData = useCallback(async () => {
    try {
      const res = await axios.get(`${FEED_URL}/apiv2/@${author}/${permlink}`);
      setSpeakData(res.data);
      setView(res.data.views);
    } catch (err) {
      console.error("Error fetching speak data:", err);
    }
  }, [author, permlink]);

  const getFollowersCount = useCallback(async (authorName) => {
    try {
      const follower = await getFollowers(authorName);
      setFollowData(follower);
    } catch (err) {
      console.error(err);
    }
  }, []);

  // Effect: Detect Hive Keychain
  useEffect(() => {
    const check = () => setHasKeychain(typeof window !== 'undefined' && !!window.hive_keychain);
    check();
    const id = setInterval(check, 1000);
    const stopId = setTimeout(() => clearInterval(id), 10000);
    return () => {
      clearInterval(id);
      clearTimeout(stopId);
    };
  }, []);

  // Effect: Fetch account data (only once when user changes)
  useEffect(() => {
    if (!user) return;
    
    const fetchAccountData = async () => {
      try {
        const result = await getVotePower(user);
        if (result?.account) {
          setAccountData(result.account);
          await calculateVoteValue(result.account, weight);
        }
      } catch (err) {
        console.error('Error fetching account:', err);
      }
    };
    
    fetchAccountData();
  }, [user, calculateVoteValue, weight]);

  // Effect: Fetch speak data and followers (only when author/permlink changes)
  useEffect(() => {
    if (!author || !permlink) return;
    
    speakWatchData();
    getFollowersCount(author);
  }, [author, permlink, speakWatchData, getFollowersCount]);

  // Effect: Get tooltip voters (only when author/permlink/user changes)
  useEffect(() => {
    if (!author || !permlink) return;
    getTooltipVoters();
  }, [author, permlink, getTooltipVoters]);

  // Effect: Recalculate vote value when weight changes
  useEffect(() => {
    if (!accountData) return;
    calculateVoteValue(accountData, weight);
  }, [weight, accountData, calculateVoteValue]);

  // Memoized handlers
  const handleSelectTag = useCallback((tag) => {
    navigate(`/t/${tag}`);
  }, [navigate]);

  const followUserWithKeychain = useCallback((follower, following) => {
    const json = JSON.stringify([
      'follow',
      {
        follower,
        following,
        what: ['blog'],
      },
    ]);

    window.hive_keychain.requestCustomJson(
      follower,
      'follow',
      'Posting',
      json,
      'Follow User',
      (response) => {
        if (response.success) {
          toast.success("Followed successfully!");
        } else {
          console.error('Failed to follow user:', response.message);
          toast.error("Failed to follow user");
        }
      }
    );
  }, []);

  const handleProfileNavigate = useCallback((userName) => {
    navigate(`/p/${userName}`);
  }, [navigate]);

  const toggleTooltip = useCallback(() => {
    setShowTooltip((prev) => !prev);
  }, []);

  const handleCommunityNavigate = useCallback((community) => {
    navigate(`/community/${community}`);
  }, [navigate]);

  // Loading state
  if (videoLoading) {
    return <BarLoader />;
  }

  return (
    <>
      <div className="play-video">
        <div className="top-container">
          {(author && permlink) ? (
            <div className="video-iframe-wrapper">
              <iframe
                src={`https://play.3speak.tv/watch?v=${author}/${permlink}&layout=desktop&mode=iframe`}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: "100%",
                  border: "0",
                  overflow: "hidden",
                }}
                frameBorder="0"
                scrolling="no"
                allowFullScreen
              />
            </div>
          ) : (
            <div className="video-loader">
              <ImSpinner9 className="spinner" />
            </div>
          )}

          <h3>{videoDetails?.title}</h3>
          
          <div className="tag-wrapper">
            {tags.map((tag, index) => (
              <span key={index} onClick={() => handleSelectTag(tag)}>{tag}</span>
            ))}
          </div>
          
          {community_id && (<div className="community-title-wrap" onClick={() => handleCommunityNavigate(community_id)}>
            <MdPeople />
            <span>{comunity_name}</span>
          </div>)}
          
          <div className="play-video-info">
            <div className="wrap-left">
              <div className="wrap">
                <FaEye />
                <span>{view}</span>
              </div>
              <div className="wrap">
                <LuTimer />
                <span>{formatRelativeTime(videoDetails?.created_at)}</span>
              </div>
            </div>
            
            <div className="wrap-right">
              <span className="wrap">
                {isLoading ? (
                  <div className="loader-circle">
                    <TailChase className="loader-circle" size="15" speed="1.5" color="red" />
                  </div>
                ) : (
                  <BiLike 
                    className={isVoted ? "icon-red" : "icon"} 
                    onClick={toggleTooltip} 
                  />
                )}
                <div 
                  className="amount" 
                  onMouseEnter={() => setOpenToolTip(true)} 
                  onMouseLeave={() => setOpenToolTip(false)}
                >
                  {optimisticVoteCount}
                </div>
                {openTooltip && <ToolTip tooltipVoters={tooltipVoters} />}
              </span>

              <span className="wrap">
                <GiTwoCoins className="icon" />
                <span>${videoDetails?.stats?.total_hive_reward?.toFixed(2) ?? '0.00'}</span>
              </span>
              
              {authenticated && hasKeychain && (
                <button className="tip-btn" onClick={() => setIsTipModalOpen(true)}>
                  Tip
                </button>
              )}
              
              <UpvoteTooltip
                showTooltip={showTooltip}
                setShowTooltip={setShowTooltip}
                author={author}
                permlink={permlink}
                setIsVoted={setIsVoted}
                setOptimisticVoteCount={setOptimisticVoteCount}
                weight={weight}
                setWeight={setWeight}
                voteValue={voteValue}
                setAccountData={setAccountData}
                accountData={accountData}
              />
            </div>
          </div>
        </div>

        <div className="big-mid-wrap"></div>
        
        <div className="publisher">
          <img src={profile?.images?.avatar} alt="" />
          <div>
            <p onClick={() => handleProfileNavigate(videoDetails?.author?.id)}>
              {videoDetails?.author?.id}
            </p>
            <span>{followData?.follower_count} Followers</span>
          </div>
          {author !== user && (
            <button onClick={() => followUserWithKeychain(user, author)}>
              Follow
            </button>
          )}
        </div>

        <div className="description-wrap">
          <div className="blog-content">
            <BlogContent author={author} permlink={permlink} />
          </div>
        </div>

        <CommentSection
          videoDetails={videoDetails}
          author={author}
          permlink={permlink}
          setIsVoted={setIsVoted}
        />
      </div>
      
      {isTipModalOpen && (
        <TipModal
          recipient={author}
          isOpen={isTipModalOpen}
          onClose={() => setIsTipModalOpen(false)}
        />
      )}
    </>
  );
};

PlayVideo.propTypes = {
  videoDetails: PropTypes.shape({
    title: PropTypes.string.isRequired,
    description: PropTypes.string,
    thumbnail_url: PropTypes.string,
    body: PropTypes.string,
    stats: PropTypes.shape({
      num_votes: PropTypes.number,
      total_hive_reward: PropTypes.number,
      num_comments: PropTypes.number,
    }),
    author: PropTypes.shape({
      follower_count: PropTypes.number,
      id: PropTypes.string,
    }),
    community: PropTypes.shape({
      title: PropTypes.string,
      username: PropTypes.string,
    }),
    tags: PropTypes.arrayOf(PropTypes.string),
    created_at: PropTypes.string,
  }),
  author: PropTypes.string.isRequired,
  permlink: PropTypes.string.isRequired,
};

export default PlayVideo;