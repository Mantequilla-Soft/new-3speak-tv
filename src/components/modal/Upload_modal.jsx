import React, { useState, useRef, useEffect } from "react";
import "./Upload_modal.scss";
import axios from "axios";
import * as tus from "tus-js-client";
import { getTusUploadOptions, TUS_THUMBNAIL_CONFIG } from "../../utils/tusConfig";
import cloud from "../../assets/image/cloud-blue.png";
import gif_icon from "../../assets/image/icons-gif.gif";
import thumbnail from "../../assets/image/thumbnail.png";
import { TailChase } from 'ldrs/react'
import 'ldrs/react/TailChase.css'

function Upload_modal({ setPrevVideoUrl, setPrevVideoFile,  close, isOpen, setVideoId, username, accessToken, thumbnailFile, setThumbnailFile }) {
  const studioEndPoint = "https://studio.3speak.tv";
  const tusEndPoint = "https://uploads.3speak.tv/files/";

  const [uploadURL, setUploadURL] = useState("");
  const [videoFile, setVideoFile] = useState(null);
  const [videoDuration, setVideoDuration] = useState(0);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [thumbnailProgress, setThumbnailProgress] = useState(0); // State for thumbnail progress
  const [thumbnailPreview, setThumbnailPreview] = useState(null);
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  

  const videoInputRef = useRef(null);
  const thumbnailInputRef = useRef(null);

  const handleVideoDivClick = () => {
    videoInputRef.current.click();
  };



  const handleThumbnailDivClick = () => {
    thumbnailInputRef.current.click();
  };

  const calculateVideoDuration = (file) => {
    return new Promise((resolve) => {
      const video = document.createElement("video");
      video.preload = "metadata";

      video.onloadedmetadata = () => {
        window.URL.revokeObjectURL(video.src); // Clean up
        resolve(video.duration); // Duration in seconds
      };

      video.src = URL.createObjectURL(file);
    });
  };

  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    setVideoFile(file);
    setPrevVideoFile(file)

    const url = URL.createObjectURL(file);
    setPrevVideoUrl(url)

    const duration = await calculateVideoDuration(file);
    setVideoDuration(duration);

    const upload = new tus.Upload(file, {
      endpoint: tusEndPoint,
      ...getTusUploadOptions(),
      metadata: {
        filename: file.name,
        filetype: file.type,
      },
      onError: (error) => {
        console.error("Upload failed:", error);
      },
      onProgress: (bytesUploaded, bytesTotal) => {
        const percentage = ((bytesUploaded / bytesTotal) * 100).toFixed(2);
        setUploadProgress(percentage);
      },
      onSuccess: () => {
        const finalURL = upload.url.replace(tusEndPoint, "");
        setUploadURL(finalURL);
      },
    });

    upload.start();
  };

  const handleThumbnailUpload = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const upload = new tus.Upload(file, {
      endpoint: tusEndPoint,
      ...TUS_THUMBNAIL_CONFIG,
      metadata: {
        filename: file.name,
        filetype: file.type,
      },
      onError: (error) => {
        console.error("Thumbnail upload failed:", error);
      },
      onProgress: (bytesUploaded, bytesTotal) => {
        const percentage = ((bytesUploaded / bytesTotal) * 100).toFixed(2);
        setThumbnailProgress(percentage); // Update thumbnail progress
      },
      onSuccess: () => {
        const uploadedUrl = upload.url;

        // Save the uploaded thumbnail URL in state
        setThumbnailPreview(uploadedUrl);
        setThumbnailFile(uploadedUrl);
       
      },
    });

    upload.start();
  };

  const updateVideoInfo = async () => {
    if (!uploadURL || !videoFile || !thumbnailFile) {
      console.error("Missing video or thumbnail information.");
      setError("Missing video or thumbnail information.")
      return;
    }
    setError("")
    const oFilename = videoFile.name;
    const fileSize = videoFile.size;
    const thumbnailIdentifier = thumbnailFile.replace("https://uploads.3speak.tv/files/", "");

    try {
      setLoading(true)
      const { data } = await axios.post(
        `${studioEndPoint}/mobile/api/upload_info`,
        {
          filename: uploadURL,
          oFilename,
          size: fileSize,
          duration: Math.round(videoDuration),
          thumbnail: thumbnailIdentifier,
          owner: username,
          isReel: false,
        },
        {
          withCredentials: false,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      
      setVideoId(data._id);
      close()
      return data;
    } catch (e) {
      console.error("Error updating video info:", e);
      // Extract a meaningful error message
      const errorMessage =
        e.response?.data?.message || "Failed to update video info. Please try again.";
      setError(errorMessage);
      setLoading(false)
    }
  };

  return (
    <div className={`modal ${isOpen ? "open" : ""}`}>
      <div className="overlay" onClick={close}></div>
      <div
        className={`modal-content video-upload-moadal-size ${isOpen ? "open" : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>Upload Video and Thumbnail</h2>
          {error && <span className="err-upload">{error}</span> }
          <button className="close-btn" onClick={close}>
            &times;
          </button>
        </div>
        <div
          className="upload-wrap"
          onClick={handleVideoDivClick}
          style={{
            padding: "10px",
            border: "2px dashed #ccc",
            textAlign: "center",
            cursor: "pointer",
          }}
        >
         <img src={cloud} alt="" />
          <label>Select Video</label>
          <input
            type="file"
            ref={videoInputRef}
            style={{ display: "none" }}
            onChange={handleFileUpload}
          />
          {uploadProgress > 0 &&<div className="progress-bar">
            <div className="progress-bar-fill" style={{ width: `${uploadProgress}%` }}>
              {uploadProgress > 0 && <span className="progress-bar-text">{uploadProgress}%</span>}
            </div>
          </div>}
        </div>

        <div
          className="upload-wrap"
          onClick={handleThumbnailDivClick}
          style={{
            padding: "10px",
            border: "2px dashed #ccc",
            textAlign: "center",
            cursor: "pointer",
          }}
        >
          <img className="thumbnail" src={thumbnail} alt="" />
          <label>Thumbnail</label>
          <div>Click to upload thumbnail</div>
          <input
            type="file"
            accept="image/*"
            ref={thumbnailInputRef}
            style={{ display: "none" }}
            onChange={handleThumbnailUpload}
          />
          {thumbnailProgress > 0 &&<div className="progress-bar">
            <div className="progress-bar-fill" style={{ width: `${thumbnailProgress}%` }}>
              {thumbnailProgress > 0 && <span className="progress-bar-text">{thumbnailProgress}%</span>}
            </div>
          </div>}
        </div>
        <div className="updateVideoInfo-btn-wrap">
          <button className="btn" onClick={updateVideoInfo}>Update Video Info {loading && <TailChase size="15" speed="1.75" color="white" />}</button>
        </div>
      </div>
    </div>
  );
}

export default Upload_modal;
