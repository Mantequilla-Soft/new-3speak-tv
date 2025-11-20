import PropTypes from "prop-types";
import "./PlayVideo.scss";
import { FaEye } from "react-icons/fa";
import { LuTimer } from "react-icons/lu";
import { BiDislike, BiLike } from "react-icons/bi";
import { GiTwoCoins } from "react-icons/gi";
import { useEffect, useState } from "react";
import { useQuery } from "@apollo/client";
import {
  GET_PROFILE,
  GET_TOTAL_COUNT_OF_FOLLOWING,
  GET_VIDEO,
} from "../../graphql/queries";
// import ReactJWPlayer from "react-jw-player";
import JWPlayer from "@jwplayer/jwplayer-react";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import BlogContent from "./BlogContent";
import CommentSection from "./CommentSection";
import { useAppStore } from '../..//lib/store';
import { MdPeople } from "react-icons/md";
import { estimate, getUersContent, getVotePower } from "../../utils/hiveUtils";
import ToolTip from "../tooltip/ToolTip";
import { ImSpinner9 } from "react-icons/im";
import { useNavigate } from "react-router-dom";
import BarLoader from "../Loader/BarLoader";
import TipModal from "../../components/tip-reward/TipModal"
import {  toast } from 'sonner'
import { TailChase } from 'ldrs/react'
import 'ldrs/react/TailChase.css'
import { getFollowers } from "../../hive-api/api";
import UpvoteTooltip from "../tooltip/UpvoteTooltip";
import axios from "axios";
  import bs58 from "bs58";
  import { Buffer } from "buffer";

const PlayVideo = ({ videoDetails, author, permlink }) => {
  const { user, authenticated } = useAppStore();
  const [commentData, setCommentData] = useState("");
  const [openTooltip, setOpenToolTip] = useState(false);
  const [tooltipVoters, setTooltipVoters] = useState([]);
  const [voted, setVoted] = useState(null)
  const [isTipModalOpen, setIsTipModalOpen] = useState(false);
  const [isVoted, setIsVoted] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [followData, setFollowData] = useState(null);
  const [showTooltip, setShowTooltip] = useState(false);
  const [optimisticVoteCount, setOptimisticVoteCount] = useState();
  const [votingPower, setVotingPower] = useState(100);
  const [accountData, setAccountData] = useState(null);
  const [voteValue, setVoteValue] = useState(0.0);
  const [weight, setWeight] = useState(100);
  const [view, setView] = useState(0)
  const [speakData, setSpeakData]= useState(null)
  const navigate = useNavigate();

  dayjs.extend(relativeTime);


  const formatRelativeTime = (date) => {
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
  };

  // Define getTooltipVoters BEFORE useEffect
const getTooltipVoters = async () => {
  try {
    const data = await getUersContent(author, permlink);
    if (!data) return [];
    console.log(data)

    // setView(data.active_votes.length)

    if (data.active_votes) {
      setOptimisticVoteCount(data.active_votes.length);

      setIsVoted(data.active_votes.some(vote => vote.voter === user));

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
            reward: +reward.toFixed(3), // use `+` to make sure it's number
          };
        });

      setTooltipVoters(topVotes);
    }
  } catch (error) {
    console.error("Error fetching upvotes:", error);
    return [];
  }
};

const calculateVoteValue = async (account, percent) => {
        try{
          const data = await estimate(account, percent)
          setVoteValue(data)
        }catch(err){
          console.log(err)
        }
      };


      const speakWatchData = async ()=>{
        const res = await axios.get(`https://3speak.tv/apiv2/@${author}/${permlink}`)
         console.log("3speak--data----", res.data)
         setSpeakData(res.data)
        //  setVideoUrlSelected(res.data.playUrl)
         setView(res.data.views)
      }

 // Fetch account & VP
    useEffect(() => {
      const fetchAccountData = async () => {
        try {
          const result = await getVotePower(user);
          if (result) {
            const { account } = result;
            setAccountData(account);
            calculateVoteValue(account, weight);
          }
        } catch (err) {
          console.error('Error fetching account:', err);
        }
      };
      fetchAccountData();
      speakWatchData()
    }, [ ]);

  useEffect(() => {
    if (!accountData) return;
    calculateVoteValue(accountData, weight);
  }, [weight, showTooltip ]);



  useEffect(() => {
      getFollowersCount(author);
    }, []);

    const getFollowersCount = async (author) => {
        try {
          const follower = await getFollowers(author);
          setFollowData(follower);
        } catch (err) {
          console.log(err);
        }
      };

  // Call getTooltipVoters in useEffect
  useEffect(() => {
    getTooltipVoters();
  }, [author, permlink]); // Add author and permlink as dependencies

  // const handlePostComment = () => {
  //   if(!authenticated){
  //       toast.error("Login to make comment")
  //       return
  //     }
  //   const parent_permlink = permlink;
  //   const permlinks = `re-${parent_permlink}-${Date.now()}`;
  //   if (window.hive_keychain) {
  //     window.hive_keychain.requestBroadcast(
  //       user,
  //       [
  //         [
  //           "comment",
  //           {
  //             parent_author: author,
  //             parent_permlink,
  //             author: user,
  //             permlink: permlinks,
  //             weight: 10000,
  //             title: "",
  //             body: commentData,
  //             json_metadata: "{\"app\":\"3speak/new-version\"}",
  //             __config: { originalBody: null, comment_options: {} },
  //           },
  //         ],
  //       ],
  //       "Posting",
  //       (response) => {
  //         if (response.success) {
  //           setCommentData("")
  //           toast.success("Comment successful!");
  //         } else {
  //           toast.error(`Comment failed: ${response.message}`);
  //         }
  //       }
  //     );
  //   } else {
  //     alert("Hive Keychain is not installed. Please install the extension.");
  //   }
  // };

  const {
    data: getVideo,
    loading,
  } = useQuery(GET_VIDEO, { variables: { author, permlink }, ssr: true });
  const spkvideo = getVideo?.socialPost.spkvideo;
  console.log("hive ---- data" , spkvideo)
  const [videoUrlSelected, setVideoUrlSelected] = useState(null);

  const getUserProfile = useQuery(GET_PROFILE, {
    variables: { id: videoDetails?.author?.id },
  });

  const profile = getUserProfile.data?.profile;
  const tags = videoDetails?.tags?.slice(0, 7);
  const comunity_name = videoDetails?.community?.title;

useEffect(() => {
  if (spkvideo?.play_url) {
    const url = spkvideo.play_url;

    // If the URL starts with "ipfs://", convert it to a CDN link
    if (url.startsWith("ipfs://")) {
      const ipfsHash = url.replace("ipfs://", "");
      setVideoUrlSelected(`https://ipfs-3speak.b-cdn.net/ipfs/${ipfsHash}`);
    } 
    // Otherwise, use the link directly (e.g., m3u8 link)
    else {
      setVideoUrlSelected(url);
    }
  }
}, [spkvideo]);



  if (loading) {
    return <BarLoader />;
  }

  //Recalculate when weight changes
 



  // const handleVote = async (username, permlink, weight = 10000) => {
  //   if(!authenticated){
  //       toast.error("Login to upvote")
  //       return
  //     }
  //   try{
  //     setIsLoading(true)
  //     const data = await getUersContent(author, permlink);
  //     if (data.active_votes.some(vote => vote.voter === user)){
  //       toast.info("You have already vote this post")
  //       setIsLoading(false)
  //       return
  //     }

  //     if (window.hive_keychain) {
  //     window.hive_keychain.requestBroadcast(
  //       user,
  //       [
  //         [
  //           "vote",
  //           {
  //             voter: user,
  //             author: username,
  //             permlink,
  //             weight, // 10000 = 100%, 5000 = 50%
  //           },
  //         ],
  //       ],
  //       "Posting",
  //       (response) => {
  //         if (response.success) {
  //           toast.success("Vote successful!");
  //           setIsVoted(true);
  //           setIsLoading(false)


  //         } else {
  //           setIsLoading(false)
  //           toast.error(`Vote failed: ${response.message}`);
  //         }
  //       }
  //     );
  //   } else {
  //     setIsLoading(false)
  //     toast.info("Hive Keychain is not installed. Please install the extension.");
  //   }

  //   }catch(err){
  //     console.log("somthing went wrong" , err)
  //   }
    
  // };
  const handleSelectTag = (tag) => {
    console.log(tag)
    navigate(`/t/${tag}`);
  };

  const followUserWithKeychain = (follower, following) => {
  const json = JSON.stringify([
    'follow',
    {
      follower,
      following,
      what: ['blog'], // use [] to unfollow
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
        console.log('Successfully followed user:', response);
        // Optional: show toast
      } else {
        console.error('Failed to follow user:', response.message);
        // Optional: show toast
      }
    }
  );
};

const handleProfileNavigate = (user) => {
      navigate(`/p/${user}`);
     }
     const toggleTooltip = () => {
    setShowTooltip((prev)=> !prev)
  };

  console.log(videoUrlSelected)

  return (
    <>
    <div className="play-video">
      <div className="top-container">
{videoUrlSelected ? (
    // <JWPlayer
    //   // library={`https://cdn.jwplayer.com/libraries/${import.meta.env.VITE_JWPLAYER_LICENSE_ID}.js `} // Updated library
    //   // licenseKey={import.meta.env.VITE_JWPLAYER_LICENSE_KEY} // Verify key validity
    //   playlist={[
    //     {
    //       file: videoUrlSelected,
    //       image: spkvideo?.thumbnail_url,
    //     },
    //   ]}
    //   playbackRateControls={true}
    //   autostart={false}
    //   aspectRatio="16:9"
    //   customProps={{
    //     hlsjsConfig: {
    //       debug: true, // Enable HLS.js debugging
    //       capLevelToPlayerSize: true, // Auto quality adjustment
    //     },
    //   }}
    // />
    <div className="video-iframe-wrapper">
  <iframe
    src={`https://play.3speak.tv/watch?v=${author}/${permlink}&mode=iframe`}
    style={{
      position: "absolute",
      top: 0,
      left: 0,
      width: "100%",
      height: "100%",
      border: "0",
    }}
    frameBorder="0"
    allowFullScreen
  ></iframe>
</div>


  ) : (
    <div className="video-loader">
      <ImSpinner9 className="spinner" />
    </div>
  )}

        <h3>{videoDetails?.title}</h3>
        <div className="tag-wrapper">
          {tags.map((tags, index) => (
            <span key={index} onClick={()=>handleSelectTag(tags)}>{tags}</span>
          ))}
        </div>
        <div className="community-title-wrap">
          <MdPeople />
          <span>{comunity_name}</span>
        </div>
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
              {isLoading ?
                <div className="loader-circle"><TailChase className="loader-circle" size="15" speed="1.5" color="red" /></div> :
              <BiLike className={isVoted ? "icon-red" :"icon"} 
              onClick={() => { toggleTooltip(author, permlink) }} 
              />}
              <div className="amount" onMouseEnter={() => setOpenToolTip(true)} onMouseLeave={() => setOpenToolTip(false)}>{optimisticVoteCount}</div>
              {openTooltip && <ToolTip tooltipVoters={tooltipVoters} />}
            </span>
            

            {/* <span className="wrap">
              <BiDislike className="icon" />
              <span>0</span>
            </span> */}
            <span className="wrap">
              <GiTwoCoins className="icon" />
              <span>${videoDetails?.stats.total_hive_reward.toFixed(2)}</span>
            </span>
            {/* <span>Reply</span> */}
            <button className="tip-btn" onClick={() => setIsTipModalOpen(true)}>Tip</button>
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
              
              // setVotedPosts={setVotedPosts}
            />
          </div>
        </div>
      </div>

      <div className="big-mid-wrap"></div>
      <div className="publisher">
        <img src={profile?.images?.avatar} alt="" />
        <div>
          <p 
          onClick={()=>handleProfileNavigate(videoDetails?.author?.id)}
          >{videoDetails?.author?.id}</p>
          <span>{followData?.follower_count} Followers</span>
        </div>
        {author !== user && <button onClick={()=>followUserWithKeychain(user, author)}>Follow</button>}
      </div>

      <div className="description-wrap">
        <div className="blog-content">
          <BlogContent author={author} permlink={permlink} />
        </div>
      </div>

      {/* <div className="add-comment-wrap">
        <span>Reply:</span>
        <textarea
          className="textarea-box"
          value={commentData}
          onChange={(e) => setCommentData(e.target.value)}
          placeholder="Write your comment here..."
        />
        <div className="btn-wrap">
          <button onClick={handlePostComment}>Comment</button>
        </div>
      </div> */}

      <CommentSection
        videoDetails={videoDetails}
        author={author}
        permlink={permlink}
        setIsVoted={setIsVoted}
      />
    </div>
    {isTipModalOpen && <TipModal
    recipient={author}
    isOpen={isTipModalOpen}
    onClose={() => setIsTipModalOpen(false)}
    // onSendTip={handleSendTip}
     />}
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
    comments: PropTypes.arrayOf(
      PropTypes.shape({
        id: PropTypes.number,
        author: PropTypes.string,
        text: PropTypes.string,
        date: PropTypes.string,
        likes: PropTypes.number,
        dislikes: PropTypes.number,
        reward: PropTypes.number,
      })
    ),
  }),
  author: PropTypes.string.isRequired,
  permlink: PropTypes.string.isRequired,
};

export default PlayVideo;