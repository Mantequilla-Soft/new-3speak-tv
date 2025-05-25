import { IoChevronUpCircleOutline } from "react-icons/io5";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { Link, useNavigate } from "react-router-dom";
import { FaHeart } from "react-icons/fa";
import PropTypes from "prop-types";
import "./Cards.scss";
import { useAppStore } from "../../lib/store";
import { toast } from "react-toastify";
import { getUersContent } from "../../utils/hiveUtils";
import { useState } from "react";
import UpvoteTooltip from "../tooltip/UpvoteTooltip";
import img from "../../assets/image/deleted.jpg";
import CardVoteTooltip from "../tooltip/CardVoteTooltip";

dayjs.extend(relativeTime);

function Cards({
  videos = [],
  loading = false,
  error = null,
  defaultThumbnail = "default_thumb.jpg",
  className = "",
  truncateLength = 65,
}) {
  const { user, authenticated } = useAppStore();
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  const [activeTooltipIndex, setActiveTooltipIndex] = useState(null);
  const [selectedPost, setSelectedPost] = useState({ username: "", permlink: "" });
  const [votedPosts, setVotedPosts] = useState([]);
  const [cardStyle, setCardStyle] = useState(true);

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error}</div>;

  const filteredVideos = videos.filter(
    (video) =>
      video.spkvideo !== null &&
      video.spkvideo !== undefined &&
      !video.spkvideo.thumbnail_url?.includes("https://media.3speak.tv")
  );

  const voters = (numVotes) => (numVotes <= 0 ? 0 : numVotes);

  const toggleTooltip = (username, permlink, index) => {
    setSelectedPost({ username, permlink });
    setActiveTooltipIndex((prev) => (prev === index ? null : index));
  };

  const handleProfileNavigation = (user) => {
    navigate(`/p/${user}`);
  };

  return (
    <div className={`card-container ${className}`}>
      {filteredVideos.map((video, index) => {
        const postKey = `${video.author.username}/${video.permlink}`;
        const hasVoted = votedPosts.includes(postKey);

        return (
          <Link
            to={`/watch?v=${video.author.username}/${video.permlink}`}
            className="card"
            key={index}
          >
            <div className="img-wrap">
              <img
                src={
                  video.spkvideo?.thumbnail_url === "https://media.3speak.tv/jevmpseu/thumbnails/default.png"
                    ? img
                    : `https://images.hive.blog/320x0/${video.spkvideo?.thumbnail_url ?? ""}`
                }
                alt="thumbnail"
                onError={(e) => (e.currentTarget.src = defaultThumbnail)}
              />
              <div className="wrap">
                <span className="play">
                  {Math.floor(video.spkvideo?.duration / 60)}:
                  {Math.floor(video.spkvideo?.duration % 60)
                    .toString()
                    .padStart(2, "0")}
                </span>
              </div>
            </div>

            <h2>{video.title}</h2>

            <div className="profile-view-wrap">
              <div className="profile-wrapper">
                <img
                  className="profile-img"
                  src={`https://images.hive.blog/u/${video.author.username}/avatar`}
                  alt=""
                />
                <h2
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation(); //  prevent click from bubbling to parent Link
                    handleProfileNavigation(video.author.username);
                  }}
                >
                  {video.author.username}
                </h2>
              </div>
            </div>

            <div className="bottom-action">
              <div className="wrap-left">
                <div className="wrap flex-div">
                  <IoChevronUpCircleOutline
                    className={`icon ${hasVoted ? "voted" : ""}`}
                    onClick={(e) => {
                      e.preventDefault();
                      toggleTooltip(video.author.username, video.permlink, index);
                    }}
                  />
                  <span>${video.stats?.total_hive_reward.toFixed(2) ?? "0.00"}</span>
                </div>

                <div className="wrap flex-div">
                  <FaHeart className="icon-heart" />
                  <span>{voters(video.stats?.num_votes)}</span>
                </div>
              </div>
              <p>{dayjs(video.created_at).fromNow()}</p>
            </div>

            <CardVoteTooltip
              showTooltip={activeTooltipIndex === index}
              setShowTooltip={setActiveTooltipIndex}
              author={selectedPost.username}
              permlink={selectedPost.permlink}
              setVotedPosts={setVotedPosts}
              cardStyle={cardStyle}
            />
          </Link>
        );
      })}
    </div>
  );
}

export default Cards;
