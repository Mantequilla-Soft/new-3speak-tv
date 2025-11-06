import React, { useState } from 'react'
import "./Preview.scss"
import axios from 'axios';
import {  toast } from 'sonner'
import { Navigate, useNavigate } from "react-router-dom";
import { useAppStore } from '../../lib/store';
import { TailChase } from 'ldrs/react'
import 'ldrs/react/TailChase.css'
import VideoPreview from '../studio/VideoPreview';
import { useUpload } from '../../context/UploadContext';
import { StepProgress } from './StepProgress';
import BlogContent from '../playVideo/BlogContent';
function Preview() {
 const  { step, title, description, tagsPreview, videoId, prevVideoFile, community,declineRewards, rewardPowerup, beneficiaries, tagsInputValue, thumbnailFile, resetUploadState, setJobId } = useUpload()
  const studioEndPoint = "https://studio.3speak.tv";
  const {updateProcessing, } = useAppStore()
  const [loading, setLoading] = useState(false)
  const username = localStorage.getItem("user_id");
  const accessToken = localStorage.getItem("access_token");
  const client = axios.create({});
  const navigate = useNavigate()

  if (!description || !title || !videoId) {
    return <Navigate to="/studio" replace />;
  }

  

  const handleSubmitDetails = async () => {
    if (!title || !description || !tagsInputValue || !community || !thumbnailFile ) {
      toast.error("Please fill in all fields, upload a thumbnail, and upload a video!");
      return;
    }

    const formattedTags = tagsInputValue.trim().split(/\s+/).join(",");

    const thumbnailIdentifier = thumbnailFile.replace("https://uploads.3speak.tv/files/", "");
    try {
      setLoading(true)
      const response = await client.post(`${studioEndPoint}/mobile/api/update_info`,
        {
          beneficiaries: beneficiaries,
          description: `${description}<br/><sub>Uploaded using 3Speak Mobile App</sub>`,
          videoId: videoId, // Using uploaded video URL as videoId
          title,
          isNsfwContent: false,
          tags:formattedTags,
          thumbnail: thumbnailIdentifier,
          communityID: community.name,
          declineRewards,
          rewardPowerup
        }, {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
      });

      console.log("Details submitted successfully:", response.data);
      updateProcessing(response.data.permlink, response.data.title, username)
      toast.success("Video uploaded & Processing");
      navigate("/profile")
      setTimeout(() => resetUploadState(), 100) // clear after redirect
    } catch (error) {
      console.error("Failed to submit details:", error);
      toast.error("Failed uploading video details.")
      setLoading(false)
    }
  };
    return (



<>
    <div className="studio-main-container">
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
    

    {videoId && (
      <div className="preview-section">
        <label className="preview-label">Video Preview</label>
        <div className="preview-video">
          <VideoPreview file={prevVideoFile} />
        </div>
      </div>
    )}

    {videoId && (
      <div className="preview-section">
        <label className="preview-label">Thumbnail</label>
        <img
          className="preview-thumbnail"
          src={thumbnailFile}
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
      handleSubmitDetails();
    }}>
      {loading ? (
        <span className="wrap-loader">
          Processing <TailChase size="15" speed="1.75" color="white" />
        </span>
      ) : "Post Video"}
    </button>
  </div>
</div>



        </div>
    </div>
          

      </>

  )
}

export default Preview