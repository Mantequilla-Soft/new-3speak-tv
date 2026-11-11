import React, { useState, useRef, useEffect } from "react";
import "./Upload_modal.scss";
import axios from "axios";
import * as tus from "tus-js-client";
import { getTusUploadOptions, TUS_THUMBNAIL_CONFIG } from "../../utils/tusConfig";
import DialogShell from "./DialogShell";
import { Button, Progress } from "../v2/ui";
import { Icon } from "../v2/Icon";
import { useTranslation } from 'react-i18next'

function Upload_modal({ setPrevVideoUrl, setPrevVideoFile,  close, isOpen, setVideoId, username, accessToken, thumbnailFile, setThumbnailFile }) {
  const { t } = useTranslation();
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
      setError(t('modals.upload.missingInfo'))
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
        e.response?.data?.message || t('modals.upload.updateFailed');
      setError(errorMessage);
      setLoading(false)
    }
  };

  // Legacy studio upload (video + thumbnail) on the v2 dialog: two dashed
  // drop tiles with cyan progress (system work), the error as an accent line,
  // one primary action.
  return (
    <DialogShell
      open={isOpen}
      onClose={close}
      title={t('modals.upload.title')}
      width={480}
      className="upload-modal"
      footer={(
        <Button variant="primary" className="btn" onClick={updateVideoInfo} loading={loading}>{t('modals.upload.updateInfo')}</Button>
      )}
    >
      {error && <div className="err-upload" role="alert"><Icon name="error" size={16} />{error}</div>}
      <button type="button" className="upload-wrap" onClick={handleVideoDivClick}>
        <Icon name="cloud_upload" size={28} />
        <span className="upload-wrap__title">{t('modals.upload.selectVideo')}</span>
        {uploadProgress > 0 && (
          <span className="upload-wrap__progress">
            <Progress value={uploadProgress} tone="cyan" label={t('modals.upload.selectVideo')} />
            <span className="num">{uploadProgress}%</span>
          </span>
        )}
      </button>
      <input type="file" ref={videoInputRef} style={{ display: "none" }} onChange={handleFileUpload} />

      <button type="button" className="upload-wrap" onClick={handleThumbnailDivClick}>
        {thumbnailPreview ? <img className="thumbnail" src={thumbnailPreview} alt="" /> : <Icon name="image" size={28} />}
        <span className="upload-wrap__title">{t('modals.upload.thumbnail')}</span>
        <span className="upload-wrap__sub">{t('modals.upload.clickThumbnail')}</span>
        {thumbnailProgress > 0 && (
          <span className="upload-wrap__progress">
            <Progress value={thumbnailProgress} tone="cyan" label={t('modals.upload.thumbnail')} />
            <span className="num">{thumbnailProgress}%</span>
          </span>
        )}
      </button>
      <input type="file" accept="image/*" ref={thumbnailInputRef} style={{ display: "none" }} onChange={handleThumbnailUpload} />
    </DialogShell>
  );
}

export default Upload_modal;
