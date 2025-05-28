import { useQuery } from "@apollo/client";
import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { GET_SOCIAL_FEED_BY_CREATOR } from "../graphql/queries";
import { useAppStore } from "../lib/store";
import "./ProfilePage.scss";
import Cards from "../components/Cards/Cards";
import { getFollowers } from "../hive-api/api";
import { Quantum } from "ldrs/react";
import "ldrs/react/Quantum.css";
import BarLoader from "../components/Loader/BarLoader";
import icon from "../../public/images/stack.png";
import { Leapfrog } from "ldrs/react";
import "ldrs/react/Leapfrog.css";
import { toast, ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { FaVideo } from 'react-icons/fa';

function ProfilePage() {
  const { user, isProcessing, title : processTitle, updateProcessing, authenticated } = useAppStore();
  const [follower, setFollower] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [intervalId, setIntervalId] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    getFollowersCount(user);
    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, []);

  const { loading, error, data, refetch } = useQuery(GET_SOCIAL_FEED_BY_CREATOR, {
    variables: { id: user },
  });
  const videos = data?.socialFeed?.items || [];

  useEffect(() => {
    if (videos.length > 0 && isProcessing) {
      checkProcessingvideo();
    }
  }, [videos, isProcessing]);

  const getFollowersCount = async (user) => {
    try {
      const follower = await getFollowers(user);
      setFollower(follower);
    } catch (err) {
      console.log(err);
    }
  };

  const handleWalletNavigate = (user) => {
    navigate(`/wallet/${user}`);
  };


  const checkProcessingvideo = () => {
  if (isProcessing === null) {
    setProcessing(false);
    if (intervalId) {
      clearInterval(intervalId);
      setIntervalId(null);
    }
    return;
  }

  const available = videos.find((data) => data.permlink === isProcessing);

  if (!available) {
    setProcessing(true);

    if (!intervalId) {
      const id = setInterval(() => {
        refetch().then((res) => {
          const updatedVideos = res.data?.socialFeed?.items || [];
          const found = updatedVideos.find((data) => data.permlink === isProcessing);
          if (found) {
            setProcessing(false);
            updateProcessing(null);
            clearInterval(id);
            setIntervalId(null);
          }
        }).catch((err) => {
          console.error("Refetch error:", err);
        });
      }, 60000); // every 1 minute

      setIntervalId(id);
    }
  } else {
    setProcessing(false);
    updateProcessing(null, "");
    if (intervalId) {
      clearInterval(intervalId);
      setIntervalId(null);
    }
  }
};


  const handleNavigate = () => {
    if (!authenticated) {
      toast.error("Login to upload video");
    } else {
      navigate(`/upload`);
    }
  };

  console.log("Processing video:",isProcessing , processTitle);

  return (
    <div className="profile-page-container">
      <ToastContainer />
      <div className="com-profile-img-wrap">
        <img src={`https://images.hive.blog/u/${user}/cover`} alt="" />
        <div className="wrap">
          <img src={`https://images.hive.blog/u/${user}/avatar`} alt="" />
          <span>{user}</span>
        </div>
      </div>
      <div className="toggle-wrap">
        <div className="wrap">
          <span className="vn">Videos</span>
          <Link to="/draft">Edit Video</Link>
          <span onClick={() => handleWalletNavigate(user)}>Wallet</span>
        </div>

        <div className="wrap-in">
          <span className="followers">
            Followers{" "}
            {follower?.follower_count !== undefined ? (
              follower.follower_count
            ) : (
              <Quantum size="15" speed="1.75" color="red" />
            )}
          </span>

          {authenticated && (
            <div className="wrap-upload-video" onClick={handleNavigate}>
              <FaVideo />
            </div>
          )}
        </div>
      </div>

      <div className="container-video">
        {loading ? (
          <BarLoader />
        ) : videos.length === 0 && !processing ? (
          <div className="empty-wrap">
            <img src={icon} alt="empty" />
            <span>No Video Data Available</span>
          </div>
        ) : (
          <>
            {processing && (
              <div className="processing-card">
                <div className="skeleton video-thumbnail-skeleton" />
                <div className="details">
                  <span className="title">
                    Your video is processing{" "}
                    <Leapfrog size="20" speed="2.5" color="red" />
                  </span>
                  <span className="subtitle">
                    Please wait, it will appear shortly.
                  </span>
                  
                  <div className="wrap">
                    <span>Title: </span>
                    <p>{processTitle}</p>
                  </div>
                </div>
              </div>
            )}
            <Cards
              videos={videos}
              loading={loading}
              error={error}
              className="custom-video-feed"
            />
          </>
        )}
      </div>
    </div>
  );
}

export default ProfilePage;