import React, { useRef, useState } from 'react'
import { Upload, Video } from "lucide-react";
import "./VideoUploadStep1.scss"
import {generateVideoThumbnails} from "@rajesh896/video-thumbnails-generator";
import {  toast } from 'sonner'
import Arrow from "./../../../public/images/arrow.png"
import { useLegacyUpload  } from '../../context/LegacyUploadContext';
import { useNavigate } from 'react-router-dom';
import { TailChase } from 'ldrs/react'
import 'ldrs/react/TailChase.css'
function VideoUploadStep1() {
 const  { setVideoDuration,  videoFile,  setVideoFile, setPrevVideoFile, setGeneratedThumbnail, banned } = useLegacyUpload()
const [loading, setLoading] = useState(false)
  const navigate = useNavigate()


  const videoInputRef = useRef(null);
  const isBanned = banned && banned.canUpload === false;



    const handleVideoSelect = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.type.startsWith("video/")) {
      toast.error("Please select a valid video file");
      return;
    }
   setLoading(true)

    const thumbs = await generateVideoThumbnails(file, 2, "url");
    // console.log("Generated Thumbnails:", thumbs);
    setGeneratedThumbnail(thumbs)

    const videoElement = document.createElement("video");
    videoElement.preload = "metadata";
    videoElement.onloadedmetadata = () => {
      window.URL.revokeObjectURL(videoElement.src);
      setVideoDuration(videoElement.duration);
      setLoading(false)
      setVideoFile(file);
      setPrevVideoFile(file); // for preview
      // setStep(2);
      // navigate("/studio/thumbnail");
    };
    videoElement.src = URL.createObjectURL(file);
  };

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
              // accept="video/*"
              accept="video/mp4, video/x-m4v, video/*, .mkv, .flv, .mov, .avi, .wmv"
            ref={videoInputRef}
              onChange={handleVideoSelect}
              className="input"
              id="video-upload"
            />
            {loading ? (
              <TailChase size="30" speed="1.75" color="red" />
            ) : !videoFile ? (
              <label
                htmlFor="video-upload"
                className="button"
              >
                Browse Files
              </label>
            ) : (
              <label
                onClick={uploadVideo}
                className="button"
              >
                Proceed to Thumbnails
              </label>
            )}


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