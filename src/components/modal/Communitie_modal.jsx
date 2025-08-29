import React, { useState } from "react";
import "./Communitie_modal.scss";

function CommunitieModal({ isOpen, data, close, setCommunity }) {
  console.log( data , setCommunity)
  const [searchQuery, setSearchQuery] = useState(""); // State for search input
  const [visibleCommunities, setVisibleCommunities] = useState([]);

  // Filter and limit the communities based on search query
  const filterCommunities = () => {
    if (searchQuery.trim() === "") {
      // Show the first 10 communities by default
      return data.slice(0, 10);
    }
    return data.filter((community) =>
      community.title.toLowerCase().includes(searchQuery.toLowerCase())
    );
  };

  // Update visible communities when searchQuery or data changes
  React.useEffect(() => {
    setVisibleCommunities(filterCommunities());
  }, [searchQuery, data]);

  if (!isOpen) {
    return null; // Do not render the modal if it's not open
  }

  console.log("Communities data:", visibleCommunities);

  return (
    <div className={`modal ${isOpen ? "open" : ""}`}>
      <div className="overlay" onClick={close}></div>
      <div
        className={`modal-content  ${isOpen ? "open" : ""}`}
        onClick={(e) => e.stopPropagation()} // Prevent click on modal from closing it
      >
        <div className="modal-header">
          <h2>Select a Community</h2>
          <button className="close-btn" onClick={close}>
            &times;
          </button>
        </div>
        <div className="modal-body">
          <div className="search-container">
            <input
              type="text"
              placeholder="Search Communities"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="search-input"
            />
          </div>
          {visibleCommunities.length > 0 ? (
            <div className="community-list-wrap">
              {visibleCommunities.map((community, index) => (
                <div className="wrap-flow"
                  key={index}
                //   className="community-item"
                  onClick={() => {setCommunity(community); close() }}
                >
                 <img src={`https://images.ecency.com/u/${community.name}/avatar/small`} alt="" />
                 <span>{community.title}</span> 
                </div>
              ))}
            </div>
          ) : (
            <p>No communities found.</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default CommunitieModal;
