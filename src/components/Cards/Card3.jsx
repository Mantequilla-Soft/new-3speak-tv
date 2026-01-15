import { IoChevronUpCircleOutline } from "react-icons/io5";
import { IoEyeOutline } from "react-icons/io5";
import { IoCalendarOutline } from "react-icons/io5";
import { MdDelete, MdError, MdPhoneIphone } from "react-icons/md";
import { FaCog, FaFileAlt } from "react-icons/fa";
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

function Card3({ videos = [], loading = false, error = null, tooltipVariant = "default" }) {
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
  const [showTooltip, setShowTooltip] = useState(false);


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
  const close = () => setShowTooltip(false);
  window.addEventListener("click", close);
  return () => window.removeEventListener("click", close);
}, []);


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

              {/* Status Badges */}
              {video.status === 'scheduled' && video.publish_type === 'schedule' && (
                <div
                  className="status-badge scheduled"
                  onMouseEnter={() => setShowTooltip(true)}
                  onMouseLeave={() => setShowTooltip(false)}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setShowTooltip((prev) => !prev);
                  }}
                >
                  <IoCalendarOutline size={18} />
                  <span>Scheduled</span>

                  {showTooltip && (
                    <div className="schedule-tooltip">
                      Scheduled for <br />
                      <strong>
                        {dayjs(video.publish_data?.scheduled_at).format(
                          "MMM D, YYYY h:mm A"
                        )}
                      </strong>
                    </div>
                  )}
                </div>

              )}

              {video.publish_type === 'publish_manual' && (
                <div className="status-badge manual" title="Uploaded via mobile app">
                  <MdPhoneIphone size={18} />
                  <span>Mobile</span>
                </div>
              )}

              {video.status === 'encoding' && (
                <div className="status-badge encoding" title="Video is being processed">
                  <FaCog size={16} className="spin-icon" />
                  <span>Processing</span>
                </div>
              )}

              {video.status === 'draft' && (
                <div className="status-badge draft" title="Draft - not published yet">
                  <FaFileAlt size={16} />
                  <span>Draft</span>
                </div>
              )}

              {video.status === 'deleted' && (
                <div className="status-badge deleted" title="This video has been deleted">
                  <MdDelete size={18} />
                  <span>Deleted</span>
                </div>
              )}

              {video.status === 'failed' && (
                <div className="status-badge failed" title="Video processing failed">
                  <MdError size={18} />
                  <span>Failed</span>
                </div>
              )}
            </div>

            {/* Title */}
            <h2>{video.title}</h2>

            {/* Author */}
            <div className="profile-view-wrap">
              <Link
                to={`/p/${video.author?.username || video.author || video.owner}`}
                className="profile-wrapper"
                onClick={(e) => e.stopPropagation()}
              >
                <img
                  className="profile-img"
                  src={`https://images.hive.blog/u/${
                    video.author?.username || video.author || video.owner
                  }/avatar`}
                  alt=""
                />
                <h2
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setModalUser(video.author?.username || video.author || video.owner);
                  }}
                >
                  {video.author?.username || video.author || video.owner}
                </h2>

              </Link>
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
              tooltipVariant={tooltipVariant}
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
