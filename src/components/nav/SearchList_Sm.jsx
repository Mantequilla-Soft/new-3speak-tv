import React, { useEffect, useState,useRef } from 'react'
import "./SearchList.scss"
import { Client } from "@hiveio/dhive";
import { useNavigate } from 'react-router-dom';
import { TailChase } from 'ldrs/react'
import 'ldrs/react/TailChase.css'
const HIVE_NODES = [
  'https://api.hive.blog',
  'https://api.openhive.network',
  'https://rpc.ausbit.dev',
  'https://hive-api.arcange.eu',
];

const client = new Client(HIVE_NODES);


function SearchList_Sm({searchTerm, setSearchTerm, handleNav, setIsDropdownOpensm, isDropdownOpensm, searchBoxRefsm}) {
     const navigate = useNavigate();
     const tooltipRef = useRef(null);
      const [searchResults, setSearchResults] = useState({
        users: [],
        tags: [],
        communities: []
      });
      const [isSearching, setIsSearching] = useState(false);
      const [error, setError] = useState(null);
      const debounceTimer = useRef(null);

      useEffect(() => {
          if (searchTerm.trim().length < 2) {
            setSearchResults({ users: [], tags: [], communities: [] });
            return;
          }
      
          if (debounceTimer.current) {
            clearTimeout(debounceTimer.current);
          }
      
          debounceTimer.current = setTimeout(() => {
            searchAllHiveItems(searchTerm);
          }, 300);
      
          return () => {
            if (debounceTimer.current) {
              clearTimeout(debounceTimer.current);
            }
          };
        }, [searchTerm]);

        useEffect(() => {
            const handleClickOutside = (e) => {
              // Check if click is outside both dropdown and search box
              if (tooltipRef.current && 
                  !tooltipRef.current.contains(e.target) && 
                  searchBoxRefsm.current && 
                  !searchBoxRefsm.current.contains(e.target)) {
                setIsDropdownOpensm(false);
                setSearchTerm("");
        
              }
            };
        
            if (isDropdownOpensm) {
              document.addEventListener('mousedown', handleClickOutside);
            }
        
            return () => {
              document.removeEventListener('mousedown', handleClickOutside);
            };
          }, [isDropdownOpensm]);
      
        const searchAllHiveItems = async (term) => {
          setIsSearching(true);
          setError(null);
          
          try {
            // Search users, tags, and communities in parallel
            const [users, tags, communities] = await Promise.all([
              searchHiveUsers(term),
              searchHiveTags(term),
              searchHiveCommunities(term)
            ]);
            
            setSearchResults({
              users: users.filter(u => u.toLowerCase().includes(term.toLowerCase())),
              tags: tags.filter(t => t.toLowerCase().includes(term.toLowerCase())),
              communities: communities.filter(c => 
                c.name.toLowerCase().includes(term.toLowerCase()) || 
                c.title.toLowerCase().includes(term.toLowerCase())
              )
            });
          } catch (err) {
            console.error('Error searching Hive:', err);
            setError('Failed to search. Please try again.');
            setSearchResults({ users: [], tags: [], communities: [] });
          } finally {
            setIsSearching(false);
          }
        };
      
        const searchHiveUsers = async (username) => {
          try {
            return await client.database.call('lookup_accounts', [username, 10]);
          } catch {
            return [];
          }
        };
      
        async function searchHiveTags(query) {
          if (!query || query.length < 2) return []; // Skip empty/short queries
          
          try {
            // First try the bridge API (more comprehensive results)
            const result = await client.call("bridge", "list_all_trending_tags", {
              sort: "name",
              limit: 500,
              query: query.toLowerCase()
            });
      
            
            
            if (result?.length > 0) {
              return result
                .map(t => t.name)
                .filter(tag => tag.toLowerCase().includes(query.toLowerCase()))
                .slice(0, 10);
            }
        
            // Fallback to condenser API if bridge fails
            const fallbackResult = await client.database.call("get_trending_tags", ["", 100]);
            return fallbackResult
              .map(t => t.name)
              .filter(tag => tag.toLowerCase().startsWith(query.toLowerCase()))
              .slice(0, 10);
          } catch (error) {
            console.error("Tag search error:", error);
            return [];
          }
        }
      
        const searchHiveCommunities = async (name) => {
          try {
            const response = await client.call('bridge', 'list_communities', {
              last: '',
              limit: 10,
              query: name,
            });
            return response || [];
          } catch {
            return [];
          }
        };
      
        const hasResults = () => {
          return searchResults.users.length > 0 || 
                 searchResults.tags.length > 0 || 
                 searchResults.communities.length > 0;
        };

        const handleNavigate = (user)=>{
            navigate(`/p/${user}`)
            setSearchTerm("")

          }
          const handleNavigateCommunity = (id)=>{
            navigate(`/community/${id}`)
            setSearchTerm("")
          }




          // console.log(searchResults)



  return (
    <>
    {isDropdownOpensm && isSearching && <div className="search-list-sm center"><TailChase size="10" speed="1.75" color="red" /></div>}
    {isDropdownOpensm &&hasResults() && (<div className='search-list-sm' ref={tooltipRef}>
        <div className="search-results">
          {searchResults.users.length > 0 && (
            <div className="result-section">
              <h3>Users</h3>
              <ul>
                {searchResults.users.slice(0, 3).map((username) => (
                  <li key={`user-${username}`}>
                    <div className='wrap'
                      onClick={()=>{handleNavigate(username); handleNav()}}
                    >
                       <img src={`https://images.hive.blog/u/${username}/avatar`} alt="" /><span>{username}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          
          {/* Tags Results */}
          {searchResults.tags.length > 0 && (
            <div className="result-section">
              <h3>Tags</h3>
              <ul>
                {searchResults.tags.map((tag) => (
                  <li key={`tag-${tag}`}>
                    <div className='wrap'
                      href={`https://hive.blog/trending/${tag}`} 
                      target="_blank" 
                      rel="noopener noreferrer"
                    >
                      #{tag}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          
          {/* Communities Results */}
          {searchResults.communities.length > 0 && (
            <div className="result-section">
              <h3>Communities</h3>
              <ul>
                {searchResults.communities.slice(0, 3).map((community) => (
                  <li key={`community-${community.name}`}>
                    <div className='wrap'

                    onClick={()=>{handleNavigateCommunity(community.name)}}
                    >
                        <img src={`https://images.hive.blog/u/${community.name}/avatar`} alt="" /><span>{community.title}</span>
                      {/* {community.title} (hive-{community.name}) */}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

      </div>)}

      {searchTerm.length > 0 && !hasResults() && !isSearching && !error && (
        <div className="search-list list">No results </div>
      )}
      </>
  )
}

export default SearchList_Sm