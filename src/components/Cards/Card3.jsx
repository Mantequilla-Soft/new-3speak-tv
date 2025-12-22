import { IoChevronUpCircleOutline } from "react-icons/io5";
import { IoEyeOutline } from "react-icons/io5";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { Link, useNavigate } from "react-router-dom";
import { FaHeart } from "react-icons/fa";
import PropTypes from "prop-types";
import "./Cards.scss";
import { useAppStore } from "../../lib/store";
import { useEffect, useState } from "react";
import CardVoteTooltip from "../tooltip/CardVoteTooltip";
// import LazyPayout from "../LazyPayout"; // ✅ Add LazyPayout
import img from "../../assets/image/speak.jpg";
import { estimate, getVotePower } from "../../utils/hiveUtils";
import LazyPayout from "../../page/LazyPayout";
import { fixVideoThumbnail } from "../../utils/fixThumbnails";
import ProfileModal from "../modal/ProfileModal";
import useViewCounts from "../../hooks/useViewCounts";

dayjs.extend(relativeTime);

function Card3({ videos = [], loading = false, error = null }) {
  const { user } = useAppStore();
  const navigate = useNavigate();
  const [voteValue, setVoteValue] = useState(0.0);
  const [activeTooltipIndex, setActiveTooltipIndex] = useState(null);
  const [votersNum, setVotersNum] = useState({});
  const [hoverUser, setHoverUser] = useState(null);
  const [hoverTimeout, setHoverTimeout] = useState(null);
  const [hoverPos, setHoverPos] = useState({ x: 0, y: 0 });
  const [modalUser, setModalUser] = useState(null);
  const { getViewCount } = useViewCounts(videos);

  const [selectedPost, setSelectedPost] = useState({
    username: "",
    permlink: "",
  });
  const [voteStatus, setVoteStatus] = useState({})

  const formatViewCount = (views) => {
    if (views === null || views === undefined) return null;
    if (views >= 1000000) return `${(views / 1000000).toFixed(1)}M`;
    if (views >= 1000) return `${(views / 1000).toFixed(1)}K`;
    return views.toLocaleString();
  };

  useEffect(() => {
    const fetchAccountData = async () => {
      try {
        const result = await getVotePower(user);
        if (result) {
          const { account } = result;
          getVotingDefaultValue(account);
        }
      } catch (err) {
        console.error("Error fetching account:", err);
      }
    };

    if (user) fetchAccountData();
  }, [user]);

  const getVotingDefaultValue = async (account) => {
    const percent = 100;
    const data = await estimate(account, percent);
    setVoteValue(data);
  };

  if (loading && videos.length === 0) return <div>Loading...</div>;
  if (error) return <div>Error: {error}</div>;


  const toggleTooltip = (username, permlink, index) => {
    setSelectedPost({ username, permlink });
    setActiveTooltipIndex((prev) => (prev === index ? null : index));
  };


  
 
  return (
    <div className="card-container">
      {videos.map((video, index) => {
        const postKey = `${video.author?.username || video.author || video.owner}/${
          video.permlink
        }`;
        const hasVoted = voteStatus[postKey] === true;

        

        return (
          <Link
            to={`/watch?v=${video.author?.username || video.author || video.owner}/${
              video.permlink
            }`}
            className="card"
            // key={postKey}
            key={`${postKey}-${index}`}
          >
            {/* Thumbnail */}
            <div className="img-wrap">
              <img
                // src={video.images?.thumbnail}
                src={fixVideoThumbnail(video)}
                // src={video.images?.thumbnail || img}
                alt="thumbnail"
                onError={(e) => (e.currentTarget.src = img)}
                loading="lazy"
              />
              <div className="wrap">
                <span className="play">
                  {Math.floor((video.spkvideo?.duration || video.duration) / 60)}:
                  {Math.floor((video.spkvideo?.duration || video.duration) % 60)
                    .toString()
                    .padStart(2, "0")}
                </span>
              </div>
            </div>

            {/* Title */}
            <h2>{video.title}</h2>

            {/* Author */}
            <div className="profile-view-wrap">
              <div className="profile-wrapper">
                <img
                  className="profile-img"
                  src={`https://images.hive.blog/u/${
                    video.author?.username || video.author || video.owner
                  }/avatar`}
                  alt=""
                />
                {/* <h2
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleProfileNavigation(video.author?.username || video.author || video.owner);
                  }}
                >
                  {video.author?.username || video.author || video.owner}
                </h2> */}

                <h2
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setModalUser(video.author?.username || video.author || video.owner);
                  }}
                >
                  {video.author?.username || video.author || video.owner}
                </h2>

              </div>
              {getViewCount(video.author?.username || video.author || video.owner, video.permlink) !== null && (
                <div className="view-count">
                  <IoEyeOutline size={14} />
                  <span>{formatViewCount(getViewCount(video.author?.username || video.author || video.owner, video.permlink))}</span>
                </div>
              )}
            </div>

            {/* Bottom actions */}
            <div className="bottom-action">
              <div className="wrap-left">
                <div className="wrap flex-div">
                  <IoChevronUpCircleOutline
                    className={`icon ${ hasVoted ? "voted" : ""}`}
                    onClick={(e) => {
                      e.preventDefault();
                      toggleTooltip(
                        video.author?.username || video.author || video.owner,
                        video.permlink,
                        index
                      );
                    }}
                  />
                  <span>
                    {/* ⚡ Lazy payout component */}
                    <LazyPayout author={video.author?.username || video.author || video.owner} permlink={video.permlink}  setHasVoted1={(isVoted) =>
                      setVoteStatus((prev) => ({ ...prev, [postKey]: isVoted }))
                    } setVotersNum={(count) =>
                      setVotersNum((prev) => ({ ...prev, [postKey]: count }))
                    } />
                  </span>
                </div>

                <div className="wrap flex-div">
                  <FaHeart className="icon-heart" />
                  <span>{votersNum[postKey] ?? "…"}</span>
                </div>
              </div>
              <p>{dayjs(video.created_at || video.created).fromNow()}</p>
            </div>

            {/* Tooltip */}
            <CardVoteTooltip
              showTooltip={activeTooltipIndex === index}
              setShowTooltip={setActiveTooltipIndex}
              author={selectedPost.username}
              permlink={selectedPost.permlink}
              voteValue={voteValue}
              setVoteValue={setVoteValue}
              setVoteStatus={setVoteStatus}
            />
          </Link>
        );
      })}
      {modalUser && (
        <ProfileModal
          username={modalUser}
          onClose={() => setModalUser(null)}
        />
      )}
    </div>
  );
}

Card3.propTypes = {
  videos: PropTypes.array.isRequired,
  loading: PropTypes.bool,
  error: PropTypes.string,
};

export default Card3;
