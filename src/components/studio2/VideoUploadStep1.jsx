import React, { useRef } from 'react'
import { Upload, Video } from "lucide-react";
import "./VideoUploadStep1.scss"
import {generateVideoThumbnails} from "@rajesh896/video-thumbnails-generator";
import * as tus from "tus-js-client";
import {  toast } from 'sonner'
import Arrow from "./../../../public/images/arrow.png"
import { useUpload } from '../../context/UploadContext';
import { useNavigate } from 'react-router-dom';
function VideoUploadStep1() {
 const  { setVideoDuration, setUploadURL, videoFile,  setVideoFile,setPrevVideoUrl, setPrevVideoFile, setGeneratedThumbnail,setUploadVideoProgress, uploadURLRef, banned } = useUpload()
  const tusEndPoint = "https://uploads.3speak.tv/files/";
  const navigate = useNavigate()


  const videoInputRef = useRef(null);
  const isBanned = banned && banned.canUpload === false;

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

    const fileUrl = URL.createObjectURL(file);
    setPrevVideoUrl(fileUrl)
    console.log("file", file)
    const thumbs = await generateVideoThumbnails(file, 2, "url");
    // console.log("Generated Thumbnails:", thumbs);
    setGeneratedThumbnail(thumbs)

    const duration = await calculateVideoDuration(file);
    setVideoDuration(duration);

    const upload = new tus.Upload(file, {
      endpoint: tusEndPoint,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      metadata: {
        filename: file.name,
        filetype: file.type,
      },
      onError: (error) => {
        console.error("Upload failed:", error);
      },
      onProgress: (bytesUploaded, bytesTotal) => {
        const percentage = Number(((bytesUploaded / bytesTotal) * 100).toFixed(2));
        setUploadVideoProgress(percentage)
      },
      onSuccess: () => {
        const finalURL = upload.url.replace(tusEndPoint, "");
        uploadURLRef.current = finalURL
        setUploadURL(finalURL);
        
        console.log("Upload successful! URL:", finalURL);
      },
    });

    upload.start();
  };
    // console.log(banned.canUpload)
  const uploadVideo = ()=>{

    if (isBanned) {
      toast.error("user have been banned");
      return;
    }
    
    if(!videoFile){
      toast.error("Please select a video file first.")
      return;
    }
    navigate("/studio/thumbnail")
    // setStep(2)
  }


  console.log(banned)
  return (
    <div><div className="upload-step">
      {/* <div className="header">
        <h2 className="title">Upload Your Video</h2>
        <p className="subtitle">Select a video file to get started</p>
      </div> */}

      <div className="content">
        <div className="file-upload">
          <div className="content">
            <div className="icon">
              <Upload className="w-8 h-8" />
            </div>
            
           {!videoFile && <div className="text">
              <h3 className="title">
                Choose a video file
              </h3>
              {/* <p className="description">
                Drag and drop or click to browse
              </p> */}
              <p className="formats">
                Supports: MP4, AVI, MOV, WMV (Max size: 5GB)
              </p>
            </div>}



            {videoFile && 
            <div className='isselected-wrap'>
            <span>Video Selected. Proceed to upload thumbnail</span>
            <img className="arrow-in"  src={Arrow} alt="" />
            </div>
            }

            <input
              type="file"
              accept="video/*"
            ref={videoInputRef}
              onChange={handleFileUpload}
              className="input"
              id="video-upload"
            />
            {!videoFile ? <label
              htmlFor="video-upload"
              className="button"
            //   onClick={handleVideoDivClick}
            >
              Browse Files
            </label>: 
            <label
              onClick={uploadVideo}
              className="button"
            //   onClick={handleVideoDivClick}
            >
              Proceed to Thumbnails
            </label>}

          </div>
        </div>

        {/* {uploadProgress > 0 &&<div className="progress-bar">
            <div className="progress-bar-fill" style={{ width: `${uploadProgress}%` }}>
              {uploadProgress > 0 && <span className="progress-bar-text">{uploadProgress}%</span>}
            </div>
          </div>} */}
      </div>

      {/* <div className="actions">
        <div></div>
        <button
          onClick={uploadVideo}
        //   disabled={uploadProgress !== "100.00"}
          className="button "
        >
          Proceed to Thumbnails
        </button>
      </div> */}
    </div></div>
  )
}

export default VideoUploadStep1