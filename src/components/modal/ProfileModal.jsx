import React, { useEffect, useState } from "react";
import { IoClose, IoLocationOutline } from "react-icons/io5";
import { CiCalendarDate } from "react-icons/ci";
import {  getHiveUserProfile, getRelationshipBetweenAccounts } from "../../hive-api/api";
import "./ProfileModal.scss";
import { useNavigate } from "react-router-dom";
import {  toast } from 'sonner'
import { followWithAioha, isLoggedIn } from "../../hive-api/aioha";

function ProfileModal({ username = "kesolink", onClose }) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [isFollowing, setIsFollowing] = useState(false);
  const [fetchingFollow, setFetchingFollow] = useState(true);
  const activeUser = localStorage.getItem("user_id");
  const navigate = useNavigate();

  useEffect(() => {
    const loadProfile = async () => {
      setLoading(true);
      const user = await getHiveUserProfile(username);
      setProfile(user);
      setLoading(false);
    };
    loadProfile();
  }, [username, activeUser]);

  useEffect(() => {
  document.body.style.overflow = "hidden";
  return () => { document.body.style.overflow = "auto"; };
}, []);

 
  // check follow status using real API data
  useEffect(() => {
    const checkFollowing = async () => {
      setFetchingFollow(true);

      if (!activeUser || activeUser === username) {
        setIsFollowing(false);
        setFetchingFollow(false);
        return;
      }

      const relation = await getRelationshipBetweenAccounts(activeUser, username);

      if (relation && typeof relation.follows === "boolean") {
      setIsFollowing(relation.follows);
    }

      setFetchingFollow(false);
    };

    checkFollowing();
  }, [username, activeUser]);

  const handleProfileNavigation = (username) => {
    navigate(`/p/${username}`);
  };


 const handleFollow = async () => {
  if (!isLoggedIn()) {
    toast.error("Please login first");
    return;
  }

  if (!activeUser) {
    toast.error("You must login first");
    return;
  }

  const isFollow = !isFollowing;

  try {
    await followWithAioha(username, isFollow);
    toast.success(isFollow ? "Followed" : "Unfollowed");
    setIsFollowing(isFollow);

    // re-check real follow status after blockchain confirms
    setTimeout(async () => {
      const relation = await getRelationshipBetweenAccounts(activeUser, username);
      setIsFollowing(relation?.follows || false);
    }, 2000);
  } catch (error) {
    console.error("Follow error:", error);
    toast.error(`Failed to ${isFollow ? 'follow' : 'unfollow'}: ${error.message}`);
  }
};



  

  
// .skeleton {
//   animation: shimmer 2s infinite linear;
//   background: linear-gradient(to right, #f0f0f0 4%, #e0e0e0 25%, #f0f0f0 36%);
//   background-size: 1000px 100%;
//   border-radius: 4px;
// }
  return (
    <div className="Profile-modal-overlay">
      <div className="modal-backdrop" onClick={onClose}></div>

      <div className="profile-card-container">
        <button className="btn-close" onClick={onClose}>
          <IoClose className="icon" size={18} />
        </button>

        {loading ? (
          // Skeleton Loader
          <>
            <div className="header-gradient skeleton-shimmer"></div>

            <div className="profile-content">
              <div className=" avatar-wrap">
                <div className=" skeleton avatar skeleton-shimmer"></div>
              </div>

              <div className="user-header">
                <div className="name-wrap">
                  <div className=" skeleton skeleton-shimmer skeleton-username"></div>
                  {/* <div className="skeleton-shimmer skeleton-reputation"></div> */}
                </div>
                <div className=" skeleton  skeleton-shimmer skeleton-button"></div>
              </div>

              <div className="stats-grid">
                {[1, 2, 3].map((i) => (
                  <div className="stat" key={i}>
                    <div className=" skeleton  skeleton-shimmer skeleton-stat-value"></div>
                    {/* <div className="skeleton-shimmer skeleton-stat-label"></div> */}
                  </div>
                ))}
              </div>

              <div className="meta-info">
                {[1, 2].map((i) => (
                  <div className="meta-item" key={i}>
                    <div className="skeleton  skeleton-shimmer skeleton-icon"></div>
                    <div className=" skeleton  skeleton-shimmer skeleton-text"></div>
                  </div>
                ))}
              </div>

              <div className="about">
                <div className=" skeleton  skeleton-shimmer skeleton-about-title"></div>
                <div className=" skeleton  skeleton-shimmer skeleton-about-text"></div>
              </div>
            </div>
          </>
        ) : (
          // Actual Content
          <>
            <div
              className="header-gradient"
              style={{
                backgroundImage: `url(https://images.hive.blog/u/${profile?.name}/cover)`,
                backgroundSize: "cover",
                backgroundPosition: "center",
              }}
            ></div>

            <div className="profile-content">
              <div className="avatar-wrap">
                <div className="avatar">
                  <img
                    src={profile?.metadata?.profile?.profile_image || "/default.png"}
                    alt="Profile"
                  />
                </div>
              </div>

              <div className="user-header">
                <div
                  className="name-wrap"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleProfileNavigation(username);
                  }}
                >
                  <h2 className="username">{profile?.name}</h2>
                  <span>({Math.floor(profile?.reputation || 0)})</span>
                </div>
                <button className="btn-follow" onClick={handleFollow}>{isFollowing ? "Unfollow" : "Follow"}</button>
              </div>

              <div className="stats-grid">
                <div className="stat">
                  <span className="value">{profile?.post_count}</span>
                  <span className="label">Posts</span>
                </div>
                <div className="stat">
                  <span className="value">{profile?.stats?.followers}</span>
                  <span className="label">Followers</span>
                </div>
                <div className="stat">
                  <span className="value">{profile?.stats?.following}</span>
                  <span className="label">Following</span>
                </div>
              </div>

              <div className="meta-info">
                <div className="meta-item">
                  <CiCalendarDate />
                  <span>Joined {profile?.created?.substring(0, 10)}</span>
                </div>
                {profile?.metadata?.profile?.location && (
                  <div className="meta-item">
                    <IoLocationOutline />
                    <span>{profile.metadata.profile.location}</span>
                  </div>
                )}
              </div>

              <div className="about">
                <h3>About</h3>
                <div className="text">
                  {profile?.metadata?.profile?.about || "No bio available"}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default ProfileModal;