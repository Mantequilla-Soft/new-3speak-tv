import React, { useState, useEffect } from "react";
import "./Communitie_modal.scss";
import { useQuery } from "@tanstack/react-query";
import { hiveBridgeCall } from "../../hive-api/api";

// Debounce hook
const useDebounce = (value, delay = 300) => {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handler = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debounced;
};

function CommunitieModal({ isOpen, data, close, setCommunity }) {
  const [searchQuery, setSearchQuery] = useState("");

  const debouncedQuery = useDebounce(searchQuery, 400);

  // React Query: live Hive community search
  const {
    data: hiveResults = [],
    isLoading,
    isFetching,
  } = useQuery({
    queryKey: ["hive-community-search", debouncedQuery],
    enabled: debouncedQuery.trim().length > 0, // Only search when typing
    queryFn: () =>
      hiveBridgeCall("list_communities", {
        last: "",
        limit: 20,
        sort: "rank",
        query: debouncedQuery.trim(),
      }),
  });

  // Determine what to show in the UI
  const visibleCommunities =
    debouncedQuery.trim().length === 0
      ? data.slice(0, 10) // default
      : hiveResults; // search results

  if (!isOpen) return null;

  console.log(visibleCommunities)

  return (
    <div className={`modal ${isOpen ? "open" : ""}`}>
      <div className="overlay" onClick={close}></div>

      <div className={`modal-content ${isOpen ? "open" : ""}`} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Select a Community</h2>
          <button className="close-btn" onClick={close}>×</button>
        </div>

        <div className="modal-body">

          {/* SEARCH INPUT */}
          <div className="search-container">
            <input
              type="text"
              placeholder="Search Communities"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="search-input"
            />
          </div>

          {/* LOADING */}
          {(isLoading || isFetching) && searchQuery.trim() !== "" && (
            <div className="loading-message">Searching...</div>
          )}

          {/* LIST */}
          <div className="community-list-wrap">
            {visibleCommunities.length > 0 ? (
              visibleCommunities.map((community, index) => (
                <div
                  key={index}
                  className="wrap-flow"
                  onClick={() => {
                    setCommunity(community);
                    close();
                  }}
                >
                  <img
                    src={`https://images.ecency.com/u/${community.name}/avatar/small`}
                    alt=""
                  />
                  <span>{community.title}</span>
                </div>
              ))
            ) : (
              !isLoading &&
              searchQuery.trim() !== "" && <p>No communities found.</p>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}

export default CommunitieModal;
