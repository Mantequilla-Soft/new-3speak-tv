import React, { useRef, useState } from 'react'
import { Upload } from "lucide-react";
import "./VideoUploadStep1.scss"
import { generateVideoThumbnails } from "@rajesh896/video-thumbnails-generator";
import { toast } from 'sonner'
import Arrow from "./../../../public/images/arrow.png"
import { useLegacyUpload } from '../../context/LegacyUploadContext';
import { useNavigate } from 'react-router-dom';
import { TailChase } from 'ldrs/react'
import 'ldrs/react/TailChase.css'
import { UPLOAD_TOKEN, UPLOAD_URL } from "../../utils/config";
import * as tus from "tus-js-client";
import { Navigate } from 'react-router-dom';

function VideoUploadStep1() {
  const { 
    setVideoDuration,
    videoFile,
    setVideoFile,
    setPrevVideoFile,
    setGeneratedThumbnail,
    startTusUpload,
    banned,
    setUploadId,
    setError,
    isUploadLocked
  } = useLegacyUpload()

  const [loading, setLoading] = useState(false)
  const user = localStorage.getItem("user_id")
  const navigate = useNavigate()

  

  const videoInputRef = useRef(null);
  const isBanned = banned && banned.canUpload === false;

     if (isUploadLocked) {
      return <Navigate to="/studio/preview" replace />;
    }

  const calculateVideoDuration = (file) => {
    return new Promise((resolve) => {
      const video = document.createElement("video");
      video.preload = "metadata";

      video.onloadedmetadata = () => {
        window.URL.revokeObjectURL(video.src);
        resolve(video.duration);
      };

      video.src = URL.createObjectURL(file);
    });
  };

  const handleVideoSelect = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.type.startsWith("video/")) {
      toast.error("Please select a valid video file");
      return;
    }

    setLoading(true);

    try {
      // 1️⃣ Calculate duration
      const duration = await calculateVideoDuration(file);

      // 2️⃣ Init Upload
      const initResponse = await fetch(`${UPLOAD_URL}/api/upload/init`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${UPLOAD_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          owner: user,
          originalFilename: file.name,
          size: file.size,
          duration: Math.round(duration)
        })
      });

      const result = await initResponse.json();

      if (!result.success) {
        throw new Error(result.error || 'Upload initialization failed');
      }

      const upload_id = result.data.upload_id;
      // const tus_endpoint = result.data.tus_endpoint;

      setUploadId(upload_id);



      // Start upload in provider
       await startTusUpload(file);

      // 4️⃣ Generate Thumbnails
      const thumbs = await generateVideoThumbnails(file, 2, "url");
      setGeneratedThumbnail(thumbs);

      // 5️⃣ Store video for next step
      setVideoFile(file);
      setPrevVideoFile(file);
      setVideoDuration(duration);

    } catch (err) {
      console.error(err);
      setError(err.message);
      toast.error(err.message || "Upload failed.");
    }

    setLoading(false);
  };

  const uploadVideo = () => {
    if (isBanned) {
      toast.error("User is banned from uploading.");
      return;
    }

    if (!videoFile) {
      toast.error("Please select a video file first.");
      return;
    }

    navigate("/studio/thumbnail");
  };

  return (
    <div>
      <div className="upload-step">

        <div className="content">
          <div className="file-upload">
            <div className="content">
              <div 
                className="icon" 
                onClick={() => videoInputRef.current?.click()}
                style={{ cursor: 'pointer' }}
                title="Click to select a video file"
              >
                <Upload className="w-8 h-8" />
              </div>

              {!videoFile && (
                <div className="text">
                  <h3 className="title">Choose a video file</h3>
                  <p className="formats">
                    Supports: MP4, AVI, MOV, WMV (Max size: 5GB)
                  </p>
                </div>
              )}

              {videoFile && (
                <div className='isselected-wrap'>
                  <span>Video Selected. Proceed to upload thumbnail</span>
                  <img className="arrow-in" src={Arrow} alt="" />
                </div>
              )}

              <input
                type="file"
                accept="video/mp4, video/x-m4v, video/*, .mkv, .flv, .mov, .avi, .wmv"
                ref={videoInputRef}
                onChange={handleVideoSelect}
                className="input"
                id="video-upload"
              />

              {loading ? (
                <TailChase size="30" speed="1.75" color="red" />
              ) : !videoFile ? (
                <label htmlFor="video-upload" className="button">
                  Browse Files
                </label>
              ) : (
                <label onClick={uploadVideo} className="button">
                  Proceed to Thumbnails
                </label>
              )}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}

export default VideoUploadStep1;
