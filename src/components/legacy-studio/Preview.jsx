import React, { useState } from "react";
import "./Preview.scss";
import axios from "axios";
import * as tus from "tus-js-client";
import { Navigate, useNavigate } from "react-router-dom";
import { TailChase } from "ldrs/react";
import BlogContent from "../playVideo/BlogContent";
import VideoPreview from "../studio/VideoPreview";
import { StepProgress } from "./StepProgress";
import { useLegacyUpload } from "../../context/LegacyUploadContext";
import VideoUploadStatus from "./VideoUploadStatus";
import { CheckCircle } from "lucide-react";
import {  toast } from 'sonner'
import { UPLOAD_TOKEN , UPLOAD_URL} from "../../utils/config";

function Preview() {
  const {
    step,
    title,
    description,
    tagsPreview,
    videoFile,
    videoDuration,
    prevVideoFile,
    community,
    declineRewards,
    beneficiaries,
    selectedThumbnail,
    thumbnailFile,
    setUploadVideoProgress,
    resetUploadState
  } = useLegacyUpload();

  const navigate = useNavigate();

  // -----------------------------
  // STATUS UI STATES
  // -----------------------------
  const [uploading, setUploading] = useState(false);
  const [completed, setCompleted] = useState(false);

  const [statusText, setStatusText] = useState("Preparing…");
  const [progress, setProgress] = useState(0);
  const [statusMessages, setStatusMessages] = useState([]);
  const user = localStorage.getItem("user_id")

  const addMessage = (msg, type = "info") => {
    setStatusMessages((prev) => [
      ...prev,
      {
        time: new Date().toLocaleTimeString(),
        message: msg,
        type,
      },
    ]);
  };

  if (!description || !title) {
    return <Navigate to="/studio" replace />;
  }

  // --------------------------------------------------------
  //  UPLOAD FUNCTION
  // --------------------------------------------------------
  const uploadVideoTo3Speak = async () => {
    if (!videoFile || !selectedThumbnail) {
      toast.error("Video or thumbnail missing");
      return;
    }

    setUploading(true);
    setStatusText("Preparing…");
    addMessage("Preparing upload request…");

    try {
      // -----------------------------------
      // STEP 1 — PREPARE
      // -----------------------------------

        // Force it to be an array
    let finalBeneficiaries = [];
    
    if (Array.isArray(beneficiaries)) {
      finalBeneficiaries = beneficiaries;
    } else if (typeof beneficiaries === 'string') {
      try {
        finalBeneficiaries = JSON.parse(beneficiaries);
        console.log("Parsed from string:", finalBeneficiaries);
      } catch (e) {
        console.error("Failed to parse beneficiaries:", e);
        finalBeneficiaries = [];
      }
    }
    
    // Ensure it's definitely an array
    if (!Array.isArray(finalBeneficiaries)) {
      finalBeneficiaries = [];
    }



      console.log("PAYLOAD SENT:", {
  owner: localStorage.getItem("user_id"),
  title,
  description,
  tags:tagsPreview,
  size: videoFile?.size,
  duration: videoDuration,
  community,
  declineRewards,
  beneficiaries:finalBeneficiaries,
  originalFilename: videoFile.name,
});

      const prepareResp = await axios.post(
        `${UPLOAD_URL}/api/upload/prepare`,
        {
          owner: user,
          title,
          description,
          tags: tagsPreview,
          size: videoFile.size,
          duration: videoDuration,
          originalFilename: videoFile.name,
          community,
          declineRewards,
          beneficiaries: JSON.stringify(finalBeneficiaries),
        },
        {
          headers: {
            Authorization: `Bearer ${UPLOAD_TOKEN}`,
            "Content-Type": "application/json",
          },
        }
      );

      addMessage("Prepare completed ✔");
      const { video_id, permlink } = prepareResp.data.data;

      // -----------------------------------
      // STEP 2 — THUMBNAIL
      // -----------------------------------
      setStatusText("Uploading thumbnail…");
      addMessage("Uploading thumbnail…");

      const formData = new FormData();
      formData.append("thumbnail", thumbnailFile);

      await axios.post(
        `${UPLOAD_URL}/api/upload/thumbnail/${video_id}`,
        formData,
        { headers: { Authorization: `Bearer ${UPLOAD_TOKEN}` } }
      );

      addMessage("Thumbnail uploaded ✔");

      // -----------------------------------
      // STEP 3 — UPLOAD VIDEO (TUS)
      // -----------------------------------
      setStatusText("Uploading video…");

      await new Promise((resolve, reject) => {
        const upload = new tus.Upload(videoFile, {
          endpoint: `${UPLOAD_URL}/files/`,
          retryDelays: [0, 2000, 5000],
          metadata: {
            video_id,
            owner: localStorage.getItem("user_id"),
            filename: videoFile.name,
          },

          onProgress: (bytesUploaded, bytesTotal) => {
            const pct = ((bytesUploaded / bytesTotal) * 100).toFixed(2);
            setProgress(pct);
            setUploadVideoProgress(pct);
          },

          onSuccess: () => {
            addMessage("Video upload finished ✔");
            resolve();
          },

          onError: (err) => {
            addMessage("Upload error: " + err.message, "error");
            reject(err);
          },
        });

        upload.start();
      });

      // -----------------------------------
      // STEP 4 — ENCODING & PUBLISHING
      // -----------------------------------
      setStatusText("Encoding video…");
      addMessage("Waiting for encoding to start…");

      const poll = setInterval(async () => {
        try {
          const statusResp = await axios.get(
            `${UPLOAD_URL}/api/upload/video/${video_id}/status`,
            { headers: { Authorization: `Bearer ${UPLOAD_TOKEN}` } }
          );

          const data = statusResp.data.data.video;

          // ENCODING
          if (data.status === "encoding") {
            setStatusText(`Encoding video… (${data.encodingProgress}%)`);
            setProgress(data.encodingProgress);
          }

          // PUBLISHING
          if (data.status === "publishing") {
            setStatusText("Publishing…");
            addMessage("Publishing video to blockchain…");
          }

          // PUBLISHED
          if (data.status === "published") {
            clearInterval(poll);
            setStatusText("Completed");
            setProgress(100);
            setCompleted(true);
            setUploading(false);
            addMessage("🎉 Video successfully published!", "success");
          }
        } catch (err) {
          addMessage("Polling error: " + err.message, "error");
          clearInterval(poll);
        }
      }, 5000);
    } catch (err) {
      addMessage("Upload failed: " + err.message, "error");
      // setUploading(false);
    }
  };


  return (
    <>
      {/* ------------------------- */}
      {/* BUTTON & PREVIEW */}
      {/* ------------------------- */}


      {!uploading && !completed && (<div className="studio-main-container">
      <div className="studio-page-header">
        <h1>Upload Video</h1>
        <p>Follow the steps below to upload and publish your video</p>
      </div>
      <StepProgress step={step} />
      <div className="studio-page-content">

                <div className="preview-container">
  <div className="preview">
    <h3>Preview</h3>

    {title && (
      <div className="preview-section">
        <label className="preview-label">Title</label>
        <div className="preview-title">{title}</div>
      </div>
    )}

    
      <div className="preview-section">
        <label className="preview-label">Description</label>
        {/* <div
          className="preview-description"
          dangerouslySetInnerHTML={{ __html: sanitizedDescription }}
        /> */}
        <BlogContent description={description} />
      </div>
    

    {prevVideoFile && (
      <div className="preview-section">
        <label className="preview-label">Video Preview</label>
        <div className="preview-video">
          <VideoPreview file={prevVideoFile} />
        </div>
      </div>
    )}

    {selectedThumbnail && (
      <div className="preview-section">
        <label className="preview-label">Thumbnail</label>
        <img
          className="preview-thumbnail"
          src={selectedThumbnail}
          alt="Thumbnail"
        />
      </div>
    )}

    {tagsPreview && (
      <div className="preview-section">
        <label className="preview-label">Tags</label>
        <div className="preview-tags">
          {tagsPreview.map((tag, index) => (
            <span className="tag-item" key={index}>
              {tag}
            </span>
          ))}
        </div>
      </div>
    )}
  </div>

  <div className="submit-btn-wrap">
    <button onClick={() => {
      console.log("description ===>", description);
      uploadVideoTo3Speak();
    }}>
      Post Video
    </button>
  </div>
</div>



        </div>
    </div>)}


      

      {/* ------------------------- */}
      {/* STATUS CONTAINER */}
      {/* ------------------------- */}
      {uploading && (
        <div className="status-container">

          <VideoUploadStatus progress={progress} statusMessages={statusMessages} uploadVideoTo3Speak={uploadVideoTo3Speak} />
        </div>
      )}

      {/* ------------------------- */}
      {/* COMPLETED SECTION */}
      {/* ------------------------- */}
      {completed && (
       <div className="success-container">
        <div className="success-box">
          <div className="success-icon">
            <CheckCircle size={34} strokeWidth={2} />
          </div>
          <h3>Upload Finished!</h3>
          <p>Your video has been published on 3Speak.</p>
          <button onClick={() => { navigate("/profile");  setTimeout(() => {resetUploadState();}, 50);}} className="profile-btn">
            Go To My Profile →
          </button>
        </div>
      </div>
      )}
    </>
  );
}

export default Preview;





