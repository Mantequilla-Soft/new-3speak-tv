import React, { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useInfiniteQuery } from "@tanstack/react-query";
import axios from "axios";
import { toast } from "sonner";

import { useAppStore } from "../lib/store";
import { getFollowers } from "../hive-api/api";

import Card3 from "../components/Cards/Card3";
import Follower from "../components/Userprofilepage/Follower";
import BarLoader from "../components/Loader/BarLoader";

import { FaVideo } from "react-icons/fa";
import { IoLogoRss } from "react-icons/io5";
import { IoMdShare } from "react-icons/io";

import { LineSpinner, Quantum } from "ldrs/react";
import "ldrs/react/Quantum.css";

import icon from "../../public/images/stack.png";
import { UPLOAD_TOKEN, UPLOAD_URL } from "../utils/config";
import "./ProfilePage.scss";
import { useLegacyUpload } from "../context/LegacyUploadContext";

function ProfilePage() {

  const  {uploadVideoProgress, uploadStatus, hasBackgroundJob} = useLegacyUpload();
  const { user, authenticated } = useAppStore();
  const navigate = useNavigate();

  const [follower, setFollower] = useState(null);
  const [show, setShow] = useState("video");

  /* ===============================
     IN-PROGRESS UPLOAD STATE
  =============================== */
  const [inProgress, setInProgress] = useState(null);
  const pollingRef = useRef(null);

  /* ===============================
     FETCH IN-PROGRESS UPLOADS
  =============================== */
  const fetchInProgressUploads = async () => {
  if (!user) return;

  try {
    const res = await axios.get(
      `${UPLOAD_URL}/api/upload/in-progress`,
      {
        headers: {
          "X-Hive-Username": user,
        },
      }
    );

    const json = res.data;


    console.log(json)

    if (!json.success) return;

    setInProgress(json.data);

    // stop polling when done
    if (json.data.count === 0 && pollingRef.current) {
      clearInterval(pollingRef.current);
      refetch();
      pollingRef.current = null;
    }
  } catch (err) {
    console.error(
      "In-progress fetch error:",
      err.response?.data || err.message
    );
  }
};


  /* ===============================
     START POLLING ON LOAD
  =============================== */
  useEffect(() => {
    fetchInProgressUploads();

    pollingRef.current = setInterval(() => {
      fetchInProgressUploads();
    }, 5000);

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, [user]);

  /* ===============================
     FOLLOWERS
  =============================== */
  useEffect(() => {
    if (!user) return;
    getFollowers(user)
      .then(setFollower)
      .catch(console.error);
  }, [user]);

  /* ===============================
     VIDEO FEED (INFINITE SCROLL)
  =============================== */
  const fetchVideos = async ({ pageParam = 0 }) => {
    const url =
      pageParam === 0
        ? `https://3speak.tv/apiv2/feeds/@${user}`
        : `https://3speak.tv/apiv2/feeds/@${user}/more?skip=${pageParam}`;

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
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length > 0 ? allPages.flat().length : undefined,
  });

  const videos = data?.pages.flat() || [];

  /* ===============================
     SCROLL HANDLER
  =============================== */
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

  /* ===============================
     NAVIGATION
  =============================== */
  const handleUploadNavigate = () => {
    if (!authenticated) {
      toast.error("Login to upload video");
    } else {
      navigate("/studio");
    }
  };

  return (
    <div className="profile-page-container">
      {/* ================= PROFILE HEADER ================= */}
      <div className="profile-card">
        <div className="profile-header">
          <img
            className="gradient-bg"
            src={`https://images.hive.blog/u/${user}/cover`}
            alt=""
          />
        </div>

        <div className="profile-body">
          <div className="top-section">
            <div className="left-info">
              <div className="avatar">
                <img
                  src={`https://images.hive.blog/u/${user}/avatar`}
                  alt="avatar"
                />
              </div>

              <div className="user-meta">
                <h2>{user}</h2>
                <span className="status-dot">
                  <span className="dot" /> Verified creator
                </span>
              </div>
            </div>

            <div className="button-group">
              <button
                className="btn btn-primary"
                onClick={() => setShow("follower")}
              >
                Followers{" "}
                {follower?.follower_count ?? (
                  <Quantum size="15" speed="1.75" color="red" />
                )}
              </button>

              <button
                className="btn btn-secondary"
                onClick={() =>
                  window.open(`https://3speak.tv/rss/${user}.xml`, "_blank")
                }
              >
                <IoLogoRss />
              </button>

              <button
                className="btn btn-secondary"
                onClick={() =>
                  navigator.share
                    ? navigator.share({
                        title: user,
                        url: `https://3speak.tv/user/${user}`,
                      })
                    : window.open(
                        `https://3speak.tv/user/${user}`,
                        "_blank"
                      )
                }
              >
                <IoMdShare />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ================= TOGGLE ================= */}
      <div className="toggle-wrap">
        <div className="wrap">
          <span onClick={() => setShow("video")}>Videos</span>
          <Link to="/draft">Edit Video</Link>
        </div>

        <div className="wrap-in">
          <span onClick={() => navigate(`/wallet/${user}`)}>Wallet</span>

          {authenticated && (
            <div className="wrap-upload-video" onClick={handleUploadNavigate}>
              <FaVideo />
            </div>
          )}
        </div>
      </div>

      {/* ================= IN-PROGRESS BANNER ================= */}

      {hasBackgroundJob && !uploadStatus && (<div className="progressbar-container">
            <div className="content-wrap">
              <div className="wrap">
                <div className="wrap-top"><h3>Fetching Video </h3> <div>{uploadVideoProgress}%</div></div>
                {uploadVideoProgress > 0 && <div className="progress-bars">
                  <div className="progress-bar-fill" style={{ width: `${uploadVideoProgress}%` }}>
                    {/* {uploadVideoProgress > 0 && <span className="progress-bar-text">{uploadVideoProgress}%</span>} */}
                  </div>
                </div>}
              </div>
              <div className="wrap">
                <div className="wrap-upload"><h3>{!uploadStatus ? "Uploading video" : 'Video uploaded'} </h3> <div>{!uploadStatus ? <LineSpinner size="20" stroke="3" speed="1" color="black" /> : <img src={checker} alt="" />}</div></div>
              </div>
            </div>
          </div>
      )}

    {inProgress?.count > 0 && (
      <div className="active-renders">
        {inProgress.videos.map(video => (
          <div key={video.video_id} className="render-card">
          <div className="left">
            <div className="icon">▶</div>
            <div className="info">
              <h3>{video.title}</h3>
              <p className="sub">🎬 Processing your videos</p>
              <div className="meta">
                <span className="status">{video.status_label}</span>
                <span className="time">{video.elapsed_minutes} min ago</span>
              </div>
            </div>
          </div>

         <div className="wrap-progress">
          <div className="right">
            <div className="percent">{video.progress_percent}%</div>
          </div>
          <div className="progress">
            <div className="bar" style={{ width: `${video.progress_percent}%` }}></div>
          </div>
        </div>
        </div>
      ))}
      </div>
      )}


      


      

      {/* ================= VIDEO LIST ================= */}
      <div className="container-video">
        {isLoading ? (
          <BarLoader />
        ) : videos.length === 0 ? (
          <div className="empty-wrap">
            <img src={icon} alt="empty" />
            <span>No Video Data Available</span>
          </div>
        ) : show === "video" ? (
          <Card3 videos={videos} loading={isFetchingNextPage} />
        ) : (
          <Follower count={follower} />
        )}
      </div>
    </div>
  );
}

export default ProfilePage;