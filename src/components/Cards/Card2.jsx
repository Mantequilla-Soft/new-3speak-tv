import { IoChevronUpCircleOutline } from "react-icons/io5";
import { IoEyeOutline } from "react-icons/io5";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { Link } from "react-router-dom";
import { FaHeart } from "react-icons/fa";
import { FaCircleUser } from "react-icons/fa6";
import PropTypes from "prop-types";
import "./Cards.scss";
import { useAppStore } from '../../lib/store';
import img from "../../assets/image/speak.jpg";
import useViewCounts from "../../hooks/useViewCounts";
import { voteWithAioha, isLoggedIn } from "../../hive-api/aioha";
import { toast } from 'sonner';

dayjs.extend(relativeTime);

function Card2({
    videos = [],
    loading = false,
    error = null,
    defaultThumbnail = "default_thumb.jpg",
    className = "",
  }) {
      const { user } = useAppStore();
      const { getViewCount } = useViewCounts(videos);

      if (loading) return <div>Loading...</div>;
      if (error) return <div>Error: {error}</div>;

      const filteredVideos = videos.filter(
        (video) =>
          video.spkvideo !== null &&
          video.spkvideo !== undefined &&
          !video.spkvideo.thumbnail_url?.includes("https://media.3speak.tv")
      );

      const voters = (numVotes) => (numVotes <= 0 ? 0 : numVotes);

      const formatViewCount = (views) => {
        if (views === null || views === undefined) return null;
        if (views >= 1000000) return `${(views / 1000000).toFixed(1)}M`;
        if (views >= 1000) return `${(views / 1000).toFixed(1)}K`;
        return views.toLocaleString();
      };

      const handleVote = async (username, permlink, weight = 10000) => {
        if (!isLoggedIn()) {
          toast.error("Please login to vote");
          return;
        }

        try {
          await voteWithAioha(username, permlink, weight);
          toast.success("Vote successful!");
        } catch (error) {
          toast.error(`Vote failed: ${error.message}`);
        }
      };




  return (
    <div className={`card-container ${className}`}>
          {filteredVideos.map((video, index) => (
            <Link
            to={`/watch?v=${video?.author?.username}/${video.permlink ?? "unknown"}`}
              className="card"
              key={index}
            >
              <div className="img-wrap">
                <img
                  // src={`https://images.hive.blog/320x0/${
                  //   video.spkvideo?.thumbnail_url ?? ""
                  // }`}
                  src={
                    video.spkvideo?.thumbnail_url === "https://media.3speak.tv/jevmpseu/thumbnails/default.png"
                      ? img
                      : `https://images.hive.blog/320x0/${video.spkvideo?.thumbnail_url ?? ""}`
                  }
                  alt="thumbnail"
                  onError={(e) => (e.currentTarget.src = defaultThumbnail)}
                />
                <div className="wrap">
                  {/* <div className="user-wrap flex-div">
                  <span>${video.stats?.total_hive_reward.toFixed(2) ?? "0.00"}</span>
                  </div> */}
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
              {video?.author?.profile?.images?.avatar ? <img className="profile-img" src={video?.author?.profile?.images?.avatar} alt="" /> : <FaCircleUser size={16} />}
              <h2>{video.author.username}</h2>
              </div>
              {getViewCount(video.author.username, video.permlink) !== null && (
                <div className="view-count">
                  <IoEyeOutline size={14} />
                  <span>{formatViewCount(getViewCount(video.author.username, video.permlink))}</span>
                </div>
              )}
              </div>
              {/* <h3>Vibes</h3> */}
              <div className="bottom-action">
                <div className="wrap-left">
                  <div className="wrap flex-div">
                    <IoChevronUpCircleOutline className="icon" onClick={ (e) =>{ e.preventDefault(); handleVote(video.author.username, video.permlink)}} />
                    <span>${video.stats?.total_hive_reward.toFixed(2) ?? "0.00"}</span>
                  </div>
                  {/* <span>|</span> */}
                  <div className="wrap flex-div">
                    <FaHeart className="icon-heart" />
                    <span>{voters(video.stats?.num_votes)}</span>
                  </div>
                </div>
                <p>{dayjs(video.created_at).fromNow()}</p>
              </div>
            </Link>
          ))}
        </div>
  )
}

// PropType validation
Card2.propTypes = {
  videos: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string,
      title: PropTypes.string,
      permlink: PropTypes.string,
      created_at: PropTypes.string,
      spkvideo: PropTypes.shape({
        thumbnail_url: PropTypes.string,
        duration: PropTypes.number,
      }),
      author: PropTypes.shape({
        username: PropTypes.string,
      }),
      community: PropTypes.shape({
        about: PropTypes.string,
      }),
      stats: PropTypes.shape({
        total_hive_reward: PropTypes.number,
        num_votes: PropTypes.number,
      }),
    })
  ),
  loading: PropTypes.bool,
  error: PropTypes.object,
  defaultThumbnail: PropTypes.string,
  className: PropTypes.string,
};

export default Card2;