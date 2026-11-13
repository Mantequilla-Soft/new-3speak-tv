import React, { useEffect, useState } from "react";
import DialogShell from "./DialogShell";
import { Button, StatTile } from "../v2/ui";
import { Icon } from "../v2/Icon";
import {  getHiveUserProfile, getRelationshipBetweenAccounts } from "../../hive-api/api";
import "./ProfileModal.scss";
import { useNavigate } from "react-router-dom";
import { toastIn } from '../../utils/toast';
import { followWithAioha, isLoggedIn } from "../../hive-api/aioha";
import { useTranslation } from "react-i18next";

// Every toast from this module is headed "Profile"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Profile');

function ProfileModal({ username = "kesolink", onClose }) {
  const { t } = useTranslation();
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

  // (DialogShell locks the page behind it while it is open.)

 
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
    navigate(`/@${username}`);
  };


 const handleFollow = async () => {
  if (!isLoggedIn()) {
    toast.error(t('common.status.loginRequired'));
    return;
  }

  if (!activeUser) {
    toast.error(t('modals.profile.mustLogin'));
    return;
  }

  const isFollow = !isFollowing;

  try {
    await followWithAioha(username, isFollow);
    toast.success(isFollow ? t('modals.profile.followed') : t('modals.profile.unfollowed'));
    setIsFollowing(isFollow);

    // re-check real follow status after blockchain confirms
    setTimeout(async () => {
      const relation = await getRelationshipBetweenAccounts(activeUser, username);
      setIsFollowing(relation?.follows || false);
    }, 2000);
  } catch (error) {
    console.error("Follow error:", error);
    toast.error(isFollow ? t('modals.profile.followFailed', { error: error.message }) : t('modals.profile.unfollowFailed', { error: error.message }));
  }
};



  

  
  const go = (e) => {
    e.preventDefault();
    e.stopPropagation();
    handleProfileNavigation(username);
  };

  // A creator's card over the feed (design 44b profile fields, read-only): the
  // v2 dialog with the banner, the avatar over its edge, name and reputation,
  // Follow, three stat tiles, joined and location, and the bio.
  return (
    <DialogShell
      onClose={onClose}
      title={`@${username}`}
      width={440}
      zIndex={1100}
      isolate
      overlayClassName="Profile-modal-overlay"
      className="profile-card-container"
      bodyClassName="profile-card-body"
    >
      {loading ? (
        <div className="profile-skeleton" aria-busy="true">
          <div className="header-gradient v2-skeleton" />
          <div className="profile-content">
            <div className="avatar v2-skeleton" />
            <div className="v2-skeleton is-line skeleton-username" />
            <div className="v2-stats">
              {[1, 2, 3].map((i) => <div className="v2-skeleton skeleton-stat" key={i} />)}
            </div>
            <div className="v2-skeleton is-line skeleton-text" />
            <div className="v2-skeleton is-line skeleton-text is-short" />
          </div>
        </div>
      ) : (
        <>
          <div
            className="header-gradient"
            style={profile?.name ? { backgroundImage: `url(https://images.hive.blog/u/${profile.name}/cover)` } : undefined}
          />

          <div className="profile-content">
            <div className="profile-top">
              <button type="button" className="avatar" onClick={go} aria-label={t('modals.profile.avatarAlt')}>
                <img
                  src={profile?.metadata?.profile?.profile_image || "/default.png"}
                  alt={t('modals.profile.avatarAlt')}
                />
              </button>
              {activeUser && activeUser.toLowerCase() !== username?.toLowerCase() && (
                <Button
                  variant={isFollowing ? "secondary" : "primary"}
                  size={36}
                  icon={isFollowing ? "check" : "person_add"}
                  className="btn-follow"
                  onClick={handleFollow}
                  disabled={fetchingFollow}
                >
                  {isFollowing ? t('common.actions.unfollow') : t('common.actions.follow')}
                </Button>
              )}
            </div>

            <button type="button" className="name-wrap" onClick={go}>
              <span className="username">{profile?.metadata?.profile?.name || profile?.name}</span>
              <span className="rep num">{Math.floor(profile?.reputation || 0)}</span>
            </button>

            <div className="v2-stats stats-grid">
              <StatTile label={t('modals.profile.posts')} value={profile?.post_count ?? 0} />
              <StatTile label={t('modals.profile.followers')} value={profile?.stats?.followers ?? 0} />
              <StatTile label={t('common.actions.following')} value={profile?.stats?.following ?? 0} />
            </div>

            <div className="meta-info">
              <span className="meta-item">
                <Icon name="calendar_month" size={16} />
                {t('modals.profile.joined', { date: profile?.created?.substring(0, 10) })}
              </span>
              {profile?.metadata?.profile?.location && (
                <span className="meta-item">
                  <Icon name="location_on" size={16} />
                  {profile.metadata.profile.location}
                </span>
              )}
            </div>

            <div className="about">
              <div className="v2-eyebrow">{t('modals.profile.about')}</div>
              <p className="text">
                {profile?.metadata?.profile?.about || t('modals.profile.noBio')}
              </p>
            </div>
          </div>
        </>
      )}
    </DialogShell>
  );
}

export default ProfileModal;