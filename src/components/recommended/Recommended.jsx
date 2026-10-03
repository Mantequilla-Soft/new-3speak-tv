import "./Recommended.scss";
import PropTypes from "prop-types";
import { Link } from "react-router-dom";
import TimeAgo from "../TimeAgo/TimeAgo";
import AuthorBadge from "../AuthorBadge/AuthorBadge";
import ViewCount from "../ViewCount/ViewCount";
import UpvoteCount from "../UpvoteCount/UpvoteCount";
import PayoutAmount from "../PayoutAmount/PayoutAmount";
import { fixVideoThumbnail, fallbackImg } from "../../utils/fixThumbnails";
import AddToPlaylistButton from "../AddToPlaylistButton/AddToPlaylistButton";
import { useTranslation } from "react-i18next";


function Recommended({suggestedVideos}) {
  const { t } = useTranslation();
  const titleTextTruncate = (text, maxLength) =>
    text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;

  return (
    <div className="recommended">
      {suggestedVideos.map((data, index)=>{
        const author = data?.author?.username || data?.author?.id || data?.author || data?.owner;

        return (
          <Link
            to={`/watch?v=${author}/${data.permlink ?? "unknown"}`}
            key={`${author}-${data.permlink}-${index}`}
            className="side-video-link"
          >
            <div className="side-video-list">
              <div className="wrap-img">
                <img
                  src={fixVideoThumbnail(data)}
                  alt={data.title}
                  onError={(e) => (e.currentTarget.src = fallbackImg)}
                />
                {data._promoted && <span className="promoted-badge">{t('feeds.promoted')}</span>}
                <AddToPlaylistButton
                  author={author}
                  permlink={data.permlink}
                  title={data.title}
                  size={18}
                  className="compact"
                />
              </div>
              <div className="vid-info">
                <h4>{titleTextTruncate(data.title, 56)}</h4>

                <AuthorBadge author={author} noLink compact />

                <span className="time-ago"><TimeAgo date={data.created_at} /></span>
                <div className="bottom-info">
                  <ViewCount views={data?.stats?.num_views} author={author} permlink={data.permlink} />
                  <PayoutAmount amount={data?.stats?.total_hive_reward} />
                  <UpvoteCount count={data?.stats?.num_votes} />
                </div>
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

Recommended.propTypes = {
  suggestedVideos: PropTypes.arrayOf(
    PropTypes.shape({
      title: PropTypes.string.isRequired,
      spkvideo: PropTypes.shape({
        thumbnail_url: PropTypes.string
      }),
      author: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.shape({
          id: PropTypes.string,
          username: PropTypes.string
        })
      ]),
      permlink: PropTypes.string.isRequired,
      created_at: PropTypes.string.isRequired,
      stats: PropTypes.shape({
        total_hive_reward: PropTypes.number
      })
    })
  ).isRequired
};

export default Recommended;
