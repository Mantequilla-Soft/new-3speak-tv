import React, { useEffect, useRef } from "react";
import { getHiveUrl } from '../../utils/hiveNode';
import "../legacy-studio/StudioPage.scss";
import { StepProgress } from "../legacy-studio/StepProgress";
import EmbedVideoUploadStep1 from "./EmbedVideoUploadStep1";
import Auth_modal from "../modal/Auth_modal";
import VerifyAuthModal from "../modal/VerifyAuthModal";
import axios from "axios";
import { has3SpeakPostAuth } from "../../utils/hiveUtils";
import 'ldrs/react/LineSpinner.css'
import { useEmbedUpload } from "../../context/EmbedUploadContext";
import { HIVE_API_URL } from "../../utils/config";
import { useNavigate, useLocation } from "react-router-dom";
import { useState } from "react";
import { generateVideoThumbnails } from "../../utils/videoThumbnails";

function EmbedStudioPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [isVerifying, setIsVerifying] = useState(false);
  const [isOpenAuth, setIsOpenAuth] = useState(false);

  const {
    user,
    setIsChannelTrailer,
    setCommunitiesData,
    step, setStep,
    fromStories, setFromStories,
    completed,
    resetUploadState,
    videoFile,
    setVideoFile,
    setPrevVideoFile,
    setVideoDuration,
    setGeneratedThumbnail,
    setPrefilledFromQuery,
    videoMode, setVideoMode,
    clearVideoSelection,
  } = useEmbedUpload();

  // `?trailer=1` — arrived from the "Upload a channel trailer" button on an own
  // profile with no trailer set. Preselect the checkbox so the upload lands as
  // the trailer without the user having to find it on the details step. Only on
  // entry: resetUpload() clears it, and a later plain upload is unaffected.
  useEffect(() => {
    if (new URLSearchParams(location.search).get('trailer') === '1') {
      setIsChannelTrailer(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  // Detect stories origin from URL param. If a video that was picked in the OTHER
  // mode (e.g. a longform video) is still selected from a previous session, clear it
  // so reopening the studio as a Short doesn't inherit the wrong file.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const from = params.get("from");
    const isShorts = from === "stories" || from === "shorts";
    const enteringMode = isShorts ? "shorts" : "longform";
    if (videoFile && videoMode && videoMode !== enteringMode) {
      clearVideoSelection();
    }
    setFromStories(isShorts);
  }, [location.search]);

  // Prefilled flow: an external uploader (e.g. Hangouts server-side recording)
  // has already pushed a video to the embed service. Skip Step 1 and land the
  // user on the thumbnail step so they can finish title/description/tags.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("prefilled") !== "true") return;
    const permlink = params.get("permlink");
    const owner = params.get("owner");
    const embedUrl = params.get("embedUrl");
    if (!permlink || !embedUrl) return;
    setPrefilledFromQuery({ permlink, owner: owner || "", embedUrl });
    navigate("/embed-studio/thumbnail", { replace: true });
  }, [location.search, setPrefilledFromQuery, navigate]);

  const checkPostAuth = async (username) => {
    if (!username) return;
    const hasAuth = await has3SpeakPostAuth(username);
    if (!hasAuth) {
      setIsOpenAuth(true);
    }
  };

  // Reset all upload state when arriving fresh (previous upload completed)
  useEffect(() => {
    // 🔧 TEMPORARY DEV HACK — remove with the ?devstep handling in
    // EmbedUploadContext. This mount reset is what was overriding the jumped-to
    // step, so it has to opt out too.
    const devStep = new URLSearchParams(window.location.search).get('devstep');
    if (devStep) return;

    if (completed) {
      resetUploadState();
      // resetUploadState() sets fromStories back to false, and this effect is
      // declared AFTER the one that reads ?from= -- so on a mount where the
      // previous upload had completed, the reset ran second and threw the mode
      // away. Opening "Post a short" straight after finishing a video landed on
      // "Share a Video", which read as the uploader ignoring the button.
      //
      // Re-derived from the URL rather than captured before the reset: the URL
      // is the thing that actually says which uploader was asked for, and it
      // cannot be stale by the time this runs.
      const from = new URLSearchParams(window.location.search).get('from');
      setFromStories(from === 'stories' || from === 'shorts');
    } else {
      setStep(1);
    }
  }, []);

  // Pick up file shared from StudioPage (vertical short redirect) or PWA file_handlers
  const sharedFileHandled = useRef(false);
  useEffect(() => {
    if (sharedFileHandled.current) return;

    const processFile = async (file) => {
      if (!file || !file.type.startsWith('video/')) return;
      sharedFileHandled.current = true;

      const video = document.createElement('video');
      video.preload = 'metadata';
      const duration = await new Promise((resolve) => {
        video.onloadedmetadata = () => {
          URL.revokeObjectURL(video.src);
          resolve(video.duration);
        };
        video.src = URL.createObjectURL(file);
      });

      const thumbs = await generateVideoThumbnails(file, 2, 'url');
      setGeneratedThumbnail(thumbs);
      setVideoFile(file);
      setPrevVideoFile(file);
      setVideoDuration(duration);
      setVideoMode(fromStories ? 'shorts' : 'longform');
    };

    // Check for file passed from StudioPage redirect (vertical short)
    if (window.__pwaSharedFile) {
      const file = window.__pwaSharedFile;
      delete window.__pwaSharedFile;
      processFile(file);
      return;
    }

    // OS share sheet (sw.js share target) and the OpenPods recording handoff both
    // park the file in this cache and land here with ?shared=true.
    if (new URLSearchParams(window.location.search).get('shared') === 'true' && typeof caches !== 'undefined') {
      sharedFileHandled.current = true; // before the await: a second mount must not take it too
      (async () => {
        try {
          const cache = await caches.open('share-target-cache');
          const res = await cache.match('/shared-video');
          if (!res) return;
          const blob = await res.blob();
          await cache.delete('/shared-video');
          const name = res.headers.get('X-File-Name') || 'shared-video.mp4';
          await processFile(new File([blob], name, { type: blob.type || res.headers.get('Content-Type') || 'video/mp4' }));
        } catch (err) {
          console.error('Shared video pickup failed:', err);
        }
      })();
      return;
    }

    // Handle PWA file_handlers (editor "Open with" action)
    if ('launchQueue' in window) {
      window.launchQueue.setConsumer(async (launchParams) => {
        if (!launchParams.files?.length) return;
        const handle = launchParams.files[0];
        const file = await handle.getFile();
        processFile(file);
      });
    }
  }, []);

  useEffect(() => {
    const fetchCommunities = async () => {
      try {
        const response = await axios.post(getHiveUrl(), {
          jsonrpc: "2.0",
          method: "bridge.list_communities",
          params: { last: "", limit: 100 },
          id: 1,
        });
        setCommunitiesData(response.data.result || []);
      } catch (error) {
        console.error("Error fetching communities:", error);
      }
    };
    fetchCommunities();
  }, []);

  const handleAuthSuccess = () => {
    setIsOpenAuth(false);
  };

  const toggleUploadModalAuth = async () => {
    setIsOpenAuth(false);
    setIsVerifying(true);
    setTimeout(async () => {
      try {
        const hasAuth = await has3SpeakPostAuth(user);
        setIsVerifying(false);
        if (!hasAuth) {
          navigate('/new');
        }
      } catch (error) {
        console.error('Error checking auth:', error);
        setIsVerifying(false);
        navigate('/new');
      }
    }, 4000);
  };

  return (
    <>
      <div className="studio-main-container">
        <div className="studio-page-header">
          <h1>{fromStories ? "Share a Short" : "Share a Video"}</h1>
        </div>
        <StepProgress step={step} />
        <div className="studio-page-content">
          <EmbedVideoUploadStep1 />
        </div>
      </div>
      <VerifyAuthModal isOpen={isVerifying} />
    </>
  );
}

export default EmbedStudioPage;
