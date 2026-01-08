import React, { useState, useRef, useEffect } from "react";
import "./Preview.scss";
import axios from "axios";
import { Navigate, useNavigate } from "react-router-dom";
import { CheckCircle } from "lucide-react";
import { toast } from 'sonner';
import { UPLOAD_TOKEN, UPLOAD_URL } from "../../utils/config";
import BlogContent from "../playVideo/BlogContent";
import VideoPreview from "../studio/VideoPreview";
import { StepProgress } from "./StepProgress";
import { useLegacyUpload } from "../../context/LegacyUploadContext";
import VideoUploadStatus from "./VideoUploadStatus";
import EditorPreview from "../Editor/EditorPreview";
import { LineSpinner } from "ldrs/react";
import checker from "../../../public/images/checker.png"
import { getSchedulingParams, formatScheduledDateDisplay } from "../../utils/schedulingHelpers";

function Preview() {
  const {
    step,
    title,
    description,
    tagsPreview,
    videoFile,
    uploadId,
    videoDuration,
    prevVideoFile,
    community,
    declineRewards,
    beneficiaries,
    selectedThumbnail,
    thumbnailFile,
    setUploadVideoProgress,
    resetUploadState,
    permlink,
    setPermlink,
    videoId,
    setVideoId,
    uploadStatus,
    uploadVideoProgress,
    // NEW: Auto-submit values
    onSaveClicked,
    userWantsToSubmit,
    setUserWantsToSubmit,
    setIsSubmitting,
    stopAutoCheck,
    isWaitingForUpload,
    user,
    uploading, setUploading,
    completed, setCompleted,
    statusText, setStatusText,
    isScheduled,
    scheduleDateTime,
    statusMessages, setStatusMessages,
    encodingIntervalRef,
    setIsUploadLocked,
    isUploadLocked,
    setHasBackgroundJob
  } = useLegacyUpload();

  const navigate = useNavigate();
  const [showUploadModal, setShowUploadModal] = useState(false);



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

  // ============================================
  // REMOVED: Auto-trigger upload on mount
  // Now only triggers when user clicks "Post Video" button
  // ============================================

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (encodingIntervalRef.current) {
        clearInterval(encodingIntervalRef.current);
      }
    };
  }, []);

  if (!description || !title) {
    return <Navigate to="/studio" replace />;
  }

//   if (isUploadLocked) {
//   return <Navigate to="/studio/preview" replace />;
// }

 // --------------------------------------------------------
// STATUS POLLING FUNCTION (every 5 seconds)
// --------------------------------------------------------
// const startEncodingPolling = (vid) => {
//   setStatusText("Processing video…");
//   addMessage("Waiting for encoding to start…");

//   let lastEncodingProgress = 0; // Track last progress to avoid duplicate messages
//   let hasStartedEncoding = false; // Track if encoding has started

//   encodingIntervalRef.current = setInterval(async () => {
//     try {
//       const statusResp = await axios.get(
//         `${UPLOAD_URL}/api/upload/video/${vid}/status`,
//         {
//           headers: { Authorization: `Bearer ${UPLOAD_TOKEN}` },
//         }
//       );

//       const data = statusResp.data.data.video;

//       console.log(data)

//       // ENCODING
//       if (data.status === "encoding") {
//         const encodingPct = data.encodingProgress || 0;
        
//         // Show message when encoding starts
//         if (!hasStartedEncoding) {
//           addMessage("🎬 Video encoding has started!", "info");
//           hasStartedEncoding = true;
//         }
        
//         // Update progress only if it changed by at least 5% (to avoid spam)
//         if (encodingPct - lastEncodingProgress >= 5) {
//           addMessage(`⚙️ Encoding progress: ${encodingPct}%`, "info");
//           lastEncodingProgress = encodingPct;
//         }
        
//         setStatusText(`Encoding video… (${encodingPct}%)`);
//       }

//       // PUBLISHING
//       if (data.status === "publishing") {
//         if (hasStartedEncoding) {
//           addMessage("✅ Encoding completed (100%)", "success");
//           hasStartedEncoding = false; // Reset for next stage
//         }
//         setStatusText("Publishing to blockchain…");
//         addMessage("📡 Publishing video to blockchain…", "info");

//       }

//       // PUBLISHED
//       if (data.status === "published") {
//         clearInterval(encodingIntervalRef.current);
//         setStatusText("Completed");
//         setCompleted(true);
//         setUploading(false);
//         setIsSubmitting(false); // NEW: Mark as no longer submitting
//         addMessage("🎉 Video successfully published!", "success");
//       }

//       // FAILED
//       if (data.status === "failed") {
//         clearInterval(encodingIntervalRef.current);
//         setUploading(false);
//         setIsSubmitting(false); // NEW: Mark as no longer submitting
//         addMessage("❌ Video processing failed", "error");
//         toast.error("Video processing failed");
//       }
//     } catch (err) {
//       addMessage("⚠️ Polling error: " + err.message, "error");
//       console.error("Polling error:", err);
//     }
//   }, 5000); // Poll every 5 seconds
// };



const startEncodingPolling = (vid) => {
  setStatusText("Processing video…");
  addMessage("Waiting for encoding to start…", "info");

  let lastStatusLabel = null;

  encodingIntervalRef.current = setInterval(async () => {
    try {
      const res = await axios.get(
        `${UPLOAD_URL}/api/upload/in-progress`,
        {
          headers: {
            "X-Hive-Username": user,
          },
        }
      );

      const data = res.data?.data;
      
      console.log("Polling response:", data);

      // Check if no videos are being processed (PUBLISHED state)
      if (!data?.videos || data.videos.length === 0) {
        clearInterval(encodingIntervalRef.current);
        setStatusText("Completed");
        setCompleted(true);
        setUploading(false);
        setIsSubmitting(false);
        addMessage("🎉 Video successfully published!", "success");
        return;
      }

      // Find the exact video
      const video = data.videos.find(v => v.video_id === vid);
      
      if (!video) {
        console.warn("Video not found in progress list");
        return;
      }

      const { status_label } = video;

      // Update status message only when it changes
      if (status_label && status_label !== lastStatusLabel) {
        addMessage(`🎬 ${status_label}`, "info");
        setStatusText(status_label);
        lastStatusLabel = status_label;
      }

    } catch (err) {
      addMessage(`⚠️ Polling error: ${err.message}`, "error");
      console.error("Polling error:", err);
    }
  }, 5000);
};


  // --------------------------------------------------------
  // HANDLE POST VIDEO BUTTON CLICK
  // --------------------------------------------------------
  const handlePostVideo = () => {
    // Check if upload is complete
    if (uploadStatus) {
      // Upload complete - post immediately
      console.log('✅ Upload complete - posting video immediately');
      uploadVideoTo3Speak();
    } else {
      // Upload not complete - start auto-check
      console.log('⏳ Upload not complete - starting auto-check');
      setShowUploadModal(true);
    }
  };

  // // --------------------------------------------------------
  // // AUTO-SUBMIT WHEN UPLOAD COMPLETES (if user clicked early)
  // // --------------------------------------------------------
  // useEffect(() => {
  //   if (uploadStatus && userWantsToSubmit && !uploading && !completed) {
  //     console.log('🚀 Upload complete! Auto-posting video...');
  //     uploadVideoTo3Speak();
  //   }
  // }, [uploadStatus, userWantsToSubmit]);

  // --------------------------------------------------------
  // UPLOAD THUMBNAIL
  // --------------------------------------------------------
  const uploadThumbnail = async (vid) => {
    if (!thumbnailFile) {
      addMessage("No thumbnail to upload", "warning");
      return;
    }

    try {
      setStatusText("Uploading thumbnail…");
      addMessage("Uploading thumbnail…");

      const formDataObj = new FormData();
      formDataObj.append("thumbnail", thumbnailFile);

      await axios.post(
        `${UPLOAD_URL}/api/upload/thumbnail/${vid}`,
        formDataObj,
        {
          headers: {
            Authorization: `Bearer ${UPLOAD_TOKEN}`,
          },
        }
      );

      addMessage("✔ Thumbnail uploaded successfully");
    } catch (err) {
      console.warn("Thumbnail upload failed:", err);
      addMessage("Thumbnail upload failed (non-critical)", "warning");
    }
  };

  // --------------------------------------------------------
  // FINALIZE UPLOAD + THUMBNAIL + POLLING
  // --------------------------------------------------------
  const uploadVideoTo3Speak = async () => {
    if (!title || !description || !tagsPreview) {
      toast.error("Please fill in all fields: Title, Description and Tags!");
      return;
    }

    // NEW: Stop auto-check interval (if running)
    stopAutoCheck();

    // NEW: Mark as submitting
    setIsSubmitting(true);
    setUploading(true);
    setStatusText("Finalizing upload…");
    addMessage("Starting finalization…");
    setHasBackgroundJob(true)

    try {
      // ----------------------------------- 
      // STEP 1 — FINALIZE
      // ----------------------------------- 

      let parsedBeneficiaries = beneficiaries;
    if (typeof beneficiaries === 'string') {
      try {
        parsedBeneficiaries = JSON.parse(beneficiaries);
      } catch (e) {
        parsedBeneficiaries = [];
      }
    }

    // Get scheduling parameters
    const schedulingParams = getSchedulingParams(isScheduled, scheduleDateTime);

    // setIsUploadLocked(true)
      const raw= {
          upload_id: uploadId,
        owner: user,
        title: title,
        description,
        tags: tagsPreview,
        size: videoFile.size,
        duration: videoDuration,
        originalFilename: videoFile.name,
        community,
        declineRewards,
        beneficiaries: parsedBeneficiaries,
        ...schedulingParams
        }
        console.log(raw)
      const res = await axios.post(
        `${UPLOAD_URL}/api/upload/finalize`,
        {
          upload_id: uploadId,
        owner: user,
        title: title,
        description,
        tags: tagsPreview,
        size: videoFile.size,
        duration: videoDuration,
        originalFilename: videoFile.name,
        community,
        declineRewards,
        beneficiaries: parsedBeneficiaries,
        ...schedulingParams
        },
        {
          headers: {
            Authorization: `Bearer ${UPLOAD_TOKEN}`,
            "Content-Type": "application/json",
          },
        }
      );

      const result = res.data;

      if (!result.success) {
        throw new Error(result.error || "Finalize upload failed");
      }

      const vid = result.data.video_id;
      const perm = result.data.permlink;

      setVideoId(vid);
      setPermlink(perm);

      addMessage("✔ Upload finalized successfully");

      // ----------------------------------- 
      // STEP 2 — UPLOAD THUMBNAIL
      // ----------------------------------- 
      await uploadThumbnail(vid);

      // ----------------------------------- 
      // STEP 3 — START POLLING
      // ----------------------------------- 
      startEncodingPolling(vid);
      // setIsUploadLocked(false)
    } catch (err) {
      console.error("Upload error:", err);
      addMessage("❌ Upload failed: " + err.message, "error");
      toast.error("Upload failed: " + err.message);
      setUploading(false);
      setIsSubmitting(false); // NEW: Reset submitting flag
      // setIsUploadLocked(false)
    }
  };

  return (
    <>
      {/* ------------------------- */}
      {/* BUTTON & PREVIEW */}
      {/* ------------------------- */}
      {!uploading && !completed && (
        <div className="studio-main-container">
          <div className="studio-page-header">
            <h1>Upload Video</h1>
            <p>Follow the steps below to upload and publish your video</p>
          </div>

          <StepProgress step={step} />

          <div className="progressbar-container">
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
                  <EditorPreview content={description} />
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
                <button
                  className="edit-btn"
                  onClick={() => navigate('/studio/details')}
                  disabled={isWaitingForUpload}
                >
                  Edit Post
                </button>
                <button
                  onClick={handlePostVideo}
                  disabled={isWaitingForUpload}
                >
                  {isWaitingForUpload 
                    ? `Waiting for upload... ${Math.round(uploadVideoProgress)}%` 
                    : 'Post Video'
                  }
                </button>
                
                {isWaitingForUpload && (
                  <div style={{ 
                    marginTop: '1rem', 
                    textAlign: 'center', 
                    color: '#FF9800',
                    fontSize: '0.9rem'
                  }}>
                    ⏳ Auto-checking upload status every 5 seconds...
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------- */}
      {/* STATUS CONTAINER */}
      {/* ------------------------- */}
      {uploading && (
        <div className="status-container">
          <VideoUploadStatus
            statusMessages={statusMessages}
            statusText={statusText}
            uploadVideoTo3Speak={uploadVideoTo3Speak}
          />
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
            <button
              onClick={() => {
                navigate("/profile");
                setTimeout(() => {
                  resetUploadState();
                }, 50);
              }}
              className="profile-btn"
            >
              Go To My Profile →
            </button>
          </div>
        </div>
       )} 
      {showUploadModal && (

        <div className="upload-warning-modal">
          <div className="modal-card">
            <h3>Video still uploading</h3>
            <p>
              Your video is still uploading.
              You can submit now and it will be posted automatically
              once the upload finishes.
            </p>

            <div className="actions">
              <button className="cancel" onClick={() => setShowUploadModal(false)}>
                Cancel
              </button>

              <button className="primary" onClick={() => {
                onSaveClicked();
                setShowUploadModal(false);
                setHasBackgroundJob(true)
                navigate(`/profile`)
              }}>
                Submit & Auto-Post
              </button>
            </div>
          </div>
        </div>
      )}

    </>
  );
}

export default Preview;