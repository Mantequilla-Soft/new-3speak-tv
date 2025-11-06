import React, { useEffect, useState } from 'react'
import { useUpload } from '../../context/UploadContext';
import checker from "../../../public/images/checker.png"
import DOMPurify from 'dompurify';
import {  toast } from 'sonner'
import { StepProgress } from './StepProgress';
import { LineSpinner } from 'ldrs/react';
import TextEditor from '../studio/TextEditor';
import { IoIosArrowDropdownCircle } from 'react-icons/io';
import { MdPeopleAlt } from 'react-icons/md';
import Communitie_modal from "../modal/Communitie_modal";
import Beneficiary_modal from '../modal/Beneficiary_modal';
import axios from 'axios';
import VideoPreview from '../studio/VideoPreview';
import BlogContent from '../playVideo/BlogContent';
import { Navigate } from 'react-router-dom';

function Details() {
    const {
        title, setTitle,
        description, setDescription,
        tagsInputValue, setTagsInputValue,
        tagsPreview, setTagsPreview,
        community, setCommunity, setBeneficiaries,
        SetDeclineRewards,
        setRewardPowerup,
        communitiesData, 
        prevVideoFile, 
        uploadURL, 
        videoId, setVideoId,
        thumbnailFile, 
        videoFile,
        videoDuration,
        username,
        accessToken,
        navigate,
        BeneficiaryList, setBeneficiaryList,
        list, setList,
        remaingPercent, setRemaingPercent,
        step, setStep,
        isOpen, setIsOpen,
        benficaryOpen, setBeneficiaryOpen,
        uploadVideoProgress, 
        uploadThumbnailProgress,
        uploadStatus, setUploadStatus,
        setError,
        studioEndPoint,
        selectedThumbnail,
      } = useUpload();

      const [loading, setLoading] = useState(false)


  if (!selectedThumbnail) {
    return <Navigate to="/studio" replace />;
  }


  useEffect(() => {
    setStep(3)
  }, [])


  useEffect(() => {
    const interval = setInterval(() => {
      console.log("Checking for uploadURL...");

      if (uploadURL && thumbnailFile) {
        console.log("uploadURL is available:", uploadURL);
        updateVideoInfo(thumbnailFile);
        clearInterval(interval); // Stop checking
      }
    }, 5000);

    // Clean up interval on unmount
    return () => clearInterval(interval);
  }, [uploadURL, thumbnailFile]);

    const closeCommunityModal = () => {
        setIsOpen(false);
    };

    const toggleBeneficiaryModal = () => {
        setBeneficiaryOpen((prev) => !prev)
    }
    const openCommunityModal = () => {
        setIsOpen(true);
    };

    const handleSelect = (e) => {
        const value = e.target.value;
        if (value === "powerup") {
            setRewardPowerup(true)
            SetDeclineRewards(false)
        } else if (value === "decline") {
            SetDeclineRewards(true)
            setRewardPowerup(false)
        } else {
            SetDeclineRewards(false)
            setRewardPowerup(false)
        }
    }

    const sanitizedDescription = DOMPurify.sanitize(description);


    const process = () => {
      if(!uploadStatus){
        toast.error("Video is still uploading");
        return;
      }

        if (!title || !description || !tagsInputValue || !community || !thumbnailFile) {
            toast.error("Please fill in all fields, Title, Description and tag!");
            return;
        }
        navigate("/studio/preview")
        setStep(4)

    }


  const updateVideoInfo = async (thumbnailFile) => {
  console.log("=== updateVideoInfo CALLED ===");
  console.log("Upload URL:", uploadURL);
  console.log("Video File:", videoFile);
  console.log("Thumbnail File:", thumbnailFile);
  console.log(username, "username")

  if (!uploadURL || !videoFile || !thumbnailFile) {
    console.error("Missing video and thumbnail data.");
    setError("Video and thumbnail are required.");
    return;
  }

  setError("");
  const oFilename = videoFile.name;
  const fileSize = videoFile.size;

  // ✅ Backend expects HASH only, not full URL
  const thumbnailIdentifier = thumbnailFile.replace(
    "https://uploads.3speak.tv/files/",
    ""
  );

  const payload = {
    filename: uploadURL, // ✅ pass directly, don’t modify
    oFilename,
    size: fileSize,
    duration: Math.round(videoDuration),
    thumbnail: thumbnailIdentifier, // ✅ hash only
    owner: username,
    isReel: false,
  };

  console.log("🚀 Payload being sent:", payload);

  try {
    setLoading(true);

    const { data } = await axios.post(
      `${studioEndPoint}/mobile/api/upload_info`,
      payload,
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    console.log("✅ Video info updated successfully:", data);
    setVideoId(data._id);
    setUploadStatus(true);
    return data;
  } catch (e) {
    console.error("❌ Error updating video info:", e.response?.data || e);
    const errorMessage =
      e.response?.data?.message ||
      "Failed to update video info. Please try again.";
    setError(errorMessage);
    setLoading(false);
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
       <div className="progressbar-container">
        <div className="content-wrap">
          <div className="wrap">
            <div className="wrap-top"><h3>Fetching Video </h3> <div>{uploadVideoProgress}%</div></div>
            { uploadVideoProgress > 0 &&<div className="progress-bars">
            <div className="progress-bar-fill" style={{ width: `${uploadVideoProgress}%` }}>
              {/* {uploadVideoProgress > 0 && <span className="progress-bar-text">{uploadVideoProgress}%</span>} */}
            </div>
          </div>}
          </div>
          <div className="wrap">
            <div className="wrap-top"><h3>Fetching Thumbnail</h3> <div>{uploadThumbnailProgress}%</div></div>
            {uploadThumbnailProgress > 0 &&<div className="progress-bars">
            <div className="progress-bar-fill" style={{ width: `${uploadThumbnailProgress}%` }}>
              {/* {uploadThumbnailProgress > 0 && <span className="progress-bar-text">{uploadThumbnailProgress}%</span>} */}
            </div>
          </div>}
          </div>
          <div className="wrap">
            <div className="wrap-upload"><h3>{!uploadStatus ? "Uploading video" :'Video uploaded'} </h3> <div>{!uploadStatus ? <LineSpinner size="20" stroke="3" speed="1" color="black" /> : <img src={checker} alt="" />}</div></div>
          </div>

          
        </div>
        

       </div>

        <div className="video-detail-wrap">
        <div className="video-items">
        <div className="input-group">
          <label htmlFor="">Title</label>
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="input-group">
          <label htmlFor="">Description</label>
          <div className="wrap-dec">
          {/* <ReactQuill theme="snow" value={description} onChange={setDescription}  style={{ height: "90%", }} /> */}
          <TextEditor description={description} setDescription={setDescription} style={{ height: "80%", }} />
          </div>
        </div>

        <div className="input-group">
          <label htmlFor="">Tag</label>
          <input type="text" value={tagsInputValue} onChange={(e) => {setTagsInputValue(e.target.value.toLowerCase()); setTagsPreview(e.target.value.toLowerCase().trim().split(/\s+/));}}  />
          
          <div className="wrap">
          <span>Separate multiple tags with </span> <span>Space</span>
          </div>
          {/* Show the tags */}
        <div className="preview-tags">
        {tagsPreview &&<span> {tagsPreview.map((item, index) => (
      <span className="item" key={index} style={{ marginRight: '8px' }}>
        {item}
      </span>
    ))}</span>}
        </div>
        </div>

        <div className="community-wrap" onClick={openCommunityModal}>
            {community ? <span>{community === "hive-181335" ? "Select Community" : <div className="wrap"><img src={`https://images.hive.blog/u/${community.name}/avatar`} alt="" /><span></span>{community.title}</div> }</span> : <span> Select Community </span> }
            <IoIosArrowDropdownCircle size={16} />
          </div> 

        <div className="advance-option">
          <div className="beneficiary-wrap mb">
           <div className="wrap">
           <span>Rewards Distribution</span>
           <span>Optional "Hive Reward Pool" distribution method.</span>
           </div>
           <div className="select-wrap">
            <select name="" id="" onChange={handleSelect}>
              <option value="default"> Default 50% 50% </option>
              <option value="powerup">Power up 100%</option>
              <option value="decline">Decline Payout</option>
            </select>
           </div>
          </div>
          <div className="beneficiary-wrap">
           <div className="wrap">
           <span>Beneficiaries</span>
           <span>Other accounts that should get a % of the post rewards.</span>
           </div>
           <div className="bene-btn-wrap" onClick={toggleBeneficiaryModal}>
            {list.length > 0 && <spa>{list.length}</spa>}
            <span> BENEFICIARIES</span>
            <MdPeopleAlt />
           </div>
          </div>
        </div>

        <div className="submit-btn-wrap">
        <button onClick={()=>{console.log("description===>", description); process() }}>Processed</button>
        </div>

        </div>
        <div className="Preview">
        <h3>Preview</h3>

        {/* Show the title */}
        <div className="preview-title">
           {title && <span> {title}</span>}
        </div>

        {/* Show the description */}
        {/* <div className="preview-description">
          {sanitizedDescription &&  <span dangerouslySetInnerHTML={{ __html: sanitizedDescription }}></span>}
        </div> */}

        <BlogContent description={description} />

        {/* Show the tags */}
        <div className="preview-tags">
        {tagsPreview &&<span> Tags: {tagsPreview.map((item, index) => (
      <span className="item" key={index} style={{ marginRight: '8px' }}>
        {item}
      </span>
    ))}</span>}
        </div>

        

        {/* Show the video preview */}
        {videoId && (
              <div className="preview-video">
                {/* <video
                  src={URL.createObjectURL(prevVideoFile)}
                  controls
                  width="100%"
                  style={{ marginTop: "1rem", borderRadius: "10px" }}
                /> */}
                <VideoPreview file={prevVideoFile} />
                </div>)}

        {/* Show the thumbnail image */}
        {videoId && (
          <div className="preview-thumbnail">
            <img
              src={thumbnailFile}
              alt="Thumbnail"
              style={{ width: "250px", height: "auto", borderRadius: "8px",marginTop: "10px", }}
            />
          </div>
        )}
        

        </div>
      </div> 

      
        </div>
    </div>
          {isOpen && <Communitie_modal isOpen={isOpen} data={communitiesData} close={closeCommunityModal} setCommunity={setCommunity} />}
          {benficaryOpen && <Beneficiary_modal
              close={toggleBeneficiaryModal}
              isOpen={benficaryOpen}
              setBeneficiaries={setBeneficiaries}
              setBeneficiaryList={setBeneficiaryList}
              setList={setList}
              list={list}
              setRemaingPercent={setRemaingPercent}
              remaingPercent={remaingPercent}
          />}
          
      </>
  )
}

export default Details