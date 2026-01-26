import React, { useEffect, useState, useRef } from 'react';
import { getFollowers, getFollowing } from '../../utils/hiveUtils';
import { useAppStore } from '../../lib/store';
import './Follower.scss';
import { Users, User } from 'lucide-react'; // Ensure lucide-react is installed
import { useNavigate } from 'react-router-dom';

function Follower({count}) {
  const [follower, setFollower] = useState([]);
  const [following, setFollowing] = useState([]);
  const [activeTab, setActiveTab] = useState('followers');
  const [isLoading, setIsLoading] = useState(true);
  const { user } = useAppStore();
  const navigate = useNavigate();
  const hasFetchedRef = useRef(false);

  useEffect(() => {
    const fetchData = async () => {
      if (!user || hasFetchedRef.current) return;
      try {
        setIsLoading(true);
        hasFetchedRef.current = true;
        const followersData = await getFollowers(user);
        const followingData = await getFollowing(user);
        setFollower(followersData || []);
        setFollowing(followingData || []);
      } catch (err) {
        console.error('Error fetching followers/following:', err);
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, [user]);

  const handleProfileNavigation = (user) => {
    navigate(`/p/${user}`);
  };

  const getAvatar = (username) =>
    `https://images.hive.blog/u/${username}/avatar`;


  const users = activeTab === 'followers' ? follower : following;

  const UserCard = ({ user, index }) => (
    <div onClick={()=>{handleProfileNavigation(user)}} className="user-card" style={{ animationDelay: `${index * 100}ms` }}>
      <div className="user-content">
        <div className="user-avatar">
          <img
            src={getAvatar(user)}
            alt={user}
            onError={(e) => {
              e.currentTarget.src = `https://ui-avatars.com/api/?name=${user}&background=dc2626&color=ffffff&size=150`;
            }}
          />
        </div>
        <div className="user-info">
          <h3>@{user}</h3>
        </div>
      </div>
    </div>
  );
  

  return (
    <div className="followers-page">
      <div className="">
        <div className="tab-navigation">
          <div className="tab-container">
            <button
              onClick={() => setActiveTab('followers')}
              className={`tab-button ${activeTab === 'followers' ? 'active' : ''}`}
            >
              <Users className="icon" />
              Followers ({count.follower_count})
            </button>
            <button
              onClick={() => setActiveTab('following')}
              className={`tab-button ${activeTab === 'following' ? 'active' : ''}`}
            >
              <User className="icon" />
              Following ({count.following_count})
            </button>
          </div>
          <div className="indicator">
            Showing first 100 {activeTab === 'followers' ? 'followers' : 'people you follow'}
          </div>
        </div>

        {/* Users Grid */}
        <div className="users-section">
          {isLoading ? (
            <div className="loading-overlay">
              <div className="loader">
                <div className="spinner"></div>
              </div>
            </div>
          ) : (
            <div className="users-grid">
              {users.map((username, index) => (
                <UserCard key={`${activeTab}-${username}`} user={username} index={index}  />
              ))}
            </div>
          )}
        </div>

        {/* Stats Footer */}
        <div className="stats-footer" style={{ animationDelay: '600ms' }}>
          <div className="stats-container">
            <div className="stat-item">
              <div className="stat-number">{count.follower_count}</div>
              <div className="stat-label">Total Followers</div>
            </div>
            <div className="stat-divider"></div>
            <div className="stat-item">
              <div className="stat-number">{count.following_count}</div>
              <div className="stat-label">Total Following</div>
            </div>
            <div className="stat-divider"></div>
            <div className="stat-item">
              <div className="stat-number">100</div>
              <div className="stat-label">Showing</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Follower;