import { useState } from "react";
import { MdPlaylistAdd } from "react-icons/md";
import { toastIn } from '../../utils/toast';
import PropTypes from "prop-types";
import { isLoggedIn } from "../../hive-api/aioha";
import AddToPlaylistModal from "../AddToPlaylistModal/AddToPlaylistModal";
import "./AddToPlaylistButton.scss";

// Every toast from this module is headed "Playlist"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Playlist');

function AddToPlaylistButton({ author, permlink, title, size = 20, className = "" }) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  const handleClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isLoggedIn()) {
      toast.error("Please login to add videos to playlists");
      return;
    }
    setIsModalOpen(true);
  };

  return (
    <>
      <button
        className={`add-to-playlist-btn ${className}`}
        onClick={handleClick}
        onMouseDown={(e) => e.stopPropagation()}
        title="Add to playlist"
      >
        <MdPlaylistAdd size={size} />
      </button>

      {isModalOpen && (
        <AddToPlaylistModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          author={author}
          permlink={permlink}
          videoTitle={title}
        />
      )}
    </>
  );
}

AddToPlaylistButton.propTypes = {
  author: PropTypes.string.isRequired,
  permlink: PropTypes.string.isRequired,
  title: PropTypes.string,
  size: PropTypes.number,
  className: PropTypes.string,
};

export default AddToPlaylistButton;
