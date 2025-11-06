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
import { toast } from "sonner";
import { FaVideo } from "react-icons/fa";
import Follower from "../components/Userprofilepage/Follower";
import axios from "axios";
import { useInfiniteQuery } from "@tanstack/react-query";
import Card3 from "../components/Cards/Card3";

function ProfilePage() {
  const {
    user,
    isProcessing,
    title: processTitle,
    processUser,
    updateProcessing,
    authenticated,
  } = useAppStore();

  const [follower, setFollower] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [intervalId, setIntervalId] = useState(null);
  const [show, setShow] = useState("video");
  const [uploadStatus, setUploadStatus] = useState("");
  const [jobId, setJobId] = useState("");
  const username = localStorage.getItem("user_id");
  const navigate = useNavigate();


  // const isProcessing = "sdojdfnsnof"

  useEffect(() => {
    getFollowersCount(user);
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, []);

  // useEffect(()=>{
  //   getUploadStatus("8f622a56-6e46-4c20-bf87-cec0c45f066c")
  // },[])

  const LIMIT = 100;

  const fetchVideos = async ({ pageParam = 0 }) => {
    let url;
    if (pageParam === 0) {
      url = `https://3speak.tv/apiv2/feeds/@${user}`;
    } else {
      url = `https://3speak.tv/apiv2/feeds/@${user}/more?skip=${pageParam}`;
    }
    const res = await axios.get(url);
    return res.data;
  };

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    refetch,
  } = useInfiniteQuery({
    queryKey: ["ProfilePage", user],
    queryFn: fetchVideos,
    getNextPageParam: (lastPage, allPages) => {
      if (lastPage.length > 0) {
        return allPages.flat().length;
      }
      return undefined;
    },
  });

  useEffect(() => {
    const handleScroll = () => {
      if (
        window.innerHeight + window.scrollY >=
          document.body.offsetHeight - 200 &&
        !isFetchingNextPage &&
        hasNextPage
      ) {
        fetchNextPage();
      }
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, [isFetchingNextPage, hasNextPage, fetchNextPage]);

  const videos = data?.pages.flat() || [];

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

  const getJobId = async () => {
    try {
      const res = await axios.get(
        `http://144.48.107.2:3005/getjobid/${user}/${isProcessing}`
      );
      setJobId(res.data.jobId);
      console.log(res.data)
      // call immediately after getting job ID
      // getUploadStatus(res.data.jobId);
    } catch (err) {
      console.log(err);
    }
  };

  const getUploadStatus = async (id = jobId) => {
    if (!id) return;
    try {
      const res = await axios.get(
        `https://encoder-gateway.infra.3speak.tv/api/v0/gateway/jobstatus/${id}`
      );
      console.log("status response", res.data);
      // setUploadStatus(res.data.job);
    } catch (error) {
      console.log(error.message);
    }
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
    console.log("Matched video:", available);

    if (!available) {
      setProcessing(true);

      if (!intervalId) {
        // getJobId(); // ✅ get the job id first

        const id = setInterval(() => {
          // if (jobId) getUploadStatus(); // ✅ poll status only when jobId is set

          console.log("is calling interval every 5 seconds......")

          refetch()
            .then((res) => {
              const updatedVideos = res.data?.pages?.flat() || [];
              const found = updatedVideos.find(
                (data) => data.permlink === isProcessing
              );
              if (found) {
                setProcessing(false);
                updateProcessing(null);
                clearInterval(id);
                setIntervalId(null);
              }
            })
            .catch((err) => console.error("Refetch error:", err));
        }, 5000);

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
      navigate(`/studio`);
    }
  };

  console.log("Processing video:", isProcessing, processTitle);
  console.log(videos);

  return (
    <div className="profile-page-container">
      <div className="com-profile-img-wrap">
        <img src={`https://images.hive.blog/u/${user}/cover`} alt="" />
        <div className="wrap">
          <img src={`https://images.hive.blog/u/${user}/avatar`} alt="" />
          <span>{user}</span>
        </div>
      </div>

      <div className="toggle-wrap">
        <div className="wrap">
          <span className="vn" onClick={() => setShow("video")}>
            Videos
          </span>
          <Link to="/draft">Edit Video</Link>
          <span onClick={() => handleWalletNavigate(user)}>Wallet</span>
        </div>

        <div className="wrap-in">
          <span className="followers" onClick={() => setShow("follower")}>
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
        {isLoading ? (
          <BarLoader />
        ) : videos.length === 0 && !processing ? (
          <div className="empty-wrap">
            <img src={icon} alt="empty" />
            <span>No Video Data Available</span>
          </div>
        ) : (
          <>
            {processing && user === processUser && (
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

                  {/* <div className="wrap">
                    <span>Upload Status: </span>
                    <p>{uploadStatus?.status || "pending"}</p>
                  </div> */}

                  <div className="wrap">
                    <span>Title: </span>
                    <p>{processTitle}</p>
                  </div>
                  {/* <p>Upload: {uploadStatus?.progress?.upload_pct || 0}%</p> */}
                </div>
              </div>
            )}

            {show === "video" ? (
              <Card3 videos={videos} loading={isFetchingNextPage} />
            ) : (
              <Follower count={follower} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default ProfilePage;
