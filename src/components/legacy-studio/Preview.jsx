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

  // ✅ ADDED: prevent duplicate background messages
  const pollingStoppedRef = useRef(false);

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

        if (!data?.videos || data.videos.length === 0) {
          clearInterval(encodingIntervalRef.current);
          setStatusText("Completed");
          setCompleted(true);
          setUploading(false);
          setIsSubmitting(false);
          addMessage("🎉 Video successfully published!", "success");
          return;
        }

        const video = data.videos.find(v => v.video_id === vid);

        if (!video) {
          console.warn("Video not found in progress list");
          return;
        }

        const { status_label } = video;

        if (status_label && status_label !== lastStatusLabel) {
          addMessage(`🎬 ${status_label}`, "info");
          setStatusText(status_label);
          lastStatusLabel = status_label;
        }

      } catch (err) {
        // ✅ ADDED: polling failure ≠ upload failure
        if (!pollingStoppedRef.current) {
          pollingStoppedRef.current = true;

          clearInterval(encodingIntervalRef.current);

          addMessage(
            "⚠️ We can no longer track the upload status.",
            "warning"
          );

          addMessage(
            "✅ Your video is still processing and will be published shortly. Please do NOT re-upload.",
            "success"
          );

          addMessage(
            "ℹ️ You can safely leave this page. Processing continues in the background.",
            "info"
          );

          setStatusText("Processing in background");
          setUploading(false);
          setIsSubmitting(false);
          setHasBackgroundJob(true);
        }

        console.warn("Polling stopped due to error:", err);
      }
    }, 5000);
  };

  const handlePostVideo = () => {
    if (uploadStatus) {
      uploadVideoTo3Speak();
    } else {
      setShowUploadModal(true);
    }
  };

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

  const uploadVideoTo3Speak = async () => {
    if (!title || !description || !tagsPreview) {
      toast.error("Please fill in all fields: Title, Description and Tags!");
      return;
    }

    stopAutoCheck();
    setIsSubmitting(true);
    setUploading(true);
    setStatusText("Finalizing upload…");
    addMessage("Starting finalization…");
    setHasBackgroundJob(true);

    try {
      let parsedBeneficiaries = beneficiaries;
      if (typeof beneficiaries === 'string') {
        try {
          parsedBeneficiaries = JSON.parse(beneficiaries);
        } catch (e) {
          parsedBeneficiaries = [];
        }
      }

      const schedulingParams = getSchedulingParams(isScheduled, scheduleDateTime);

      const res = await axios.post(
        `${UPLOAD_URL}/api/upload/finalize`,
        {
          upload_id: uploadId,
          owner: user,
          title,
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

      await uploadThumbnail(vid);
      startEncodingPolling(vid);

    } catch (err) {
      console.error("Upload error:", err);
      addMessage("❌ Upload failed: " + err.message, "error");
      toast.error("Upload failed: " + err.message);
      setUploading(false);
      setIsSubmitting(false);
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