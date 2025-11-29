import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import "./Test.scss";
import { hiveBridgeCall } from "../hive-api/api";

// // Hive Bridge API helper
// const hiveBridgeCall = async (method, params = {}) => {
//   const { data } = await axios.post("https://api.hive.blog", {
//     jsonrpc: "2.0",
//     id: 1,
//     method: "bridge." + method,
//     params,
//   });
//   return data.result;
// };

// Debounce hook
const useDebounce = (value, delay = 300) => {
  const [debounced, setDebounced] = useState(value);
  useMemo(() => {
    const handler = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay, value]);
  return debounced;
};

// Main component
export default function Test({ activeUser, onSelect }) {
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounce(query, 300);

  // Search communities
  const { data: communities = [], isLoading } = useQuery({
    queryKey: ["search-communities", debouncedQuery],
    enabled: debouncedQuery.trim() !== "",
    queryFn: () =>
      hiveBridgeCall("list_communities", {
        last: "",
        limit: 20,
        sort: "rank",
        query: debouncedQuery.trim() || null,
        observer: activeUser?.username || "",
      }),
  });

  const handleSelect = (community) => {
    onSelect?.(community);
  };


  console.log(communities)

  return (
    <div className="hive-community-selector">
      <input
        type="text"
        className="hive-community-input"
        placeholder="Search Hive communities..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {isLoading && <div className="hive-loading">Searching...</div>}

      {!isLoading && debouncedQuery && communities.length === 0 && (
        <div className="hive-no-results">No communities found.</div>
      )}

      <div className="hive-community-list">
        {communities.map((c) => (
          <button
            key={c.name}
            className="hive-community-item"
            onClick={() => handleSelect(c)}
          >
            {c.icon && (
              <img
                src={c.icon}
                alt={c.name}
                className="hive-community-icon"
              />
            )}
            <div className="hive-community-info">
              <div className="hive-community-name">hive-{c.name}</div>
              <div className="hive-community-title">{c.title}</div>
            </div>
            {c.community_type && (
              <span className="hive-community-type">{c.community_type}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
