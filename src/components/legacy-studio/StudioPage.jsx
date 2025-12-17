import React, { useEffect, useState} from "react";
import "./StudioPage.scss";
import { StepProgress } from "./StepProgress";
import VideoUploadStep1 from "./VideoUploadStep1";
import Auth_modal from "../modal/Auth_modal";
import axios from "axios";
import { has3SpeakPostAuth } from "../../utils/hiveUtils";
import 'ldrs/react/LineSpinner.css'
import { useLegacyUpload} from "../../context/LegacyUploadContext";

function StudioPage() {

  const [banned, setBanned]= useState(null)

  const {
    user,
    authenticated,
    studioEndPoint,
    setCommunitiesData,
    setPrevVideoUrl,
    setPrevVideoFile,
    uploadURL, setUploadURL,
    setVideoId,
    videoFile, setVideoFile,
    videoDuration, setVideoDuration,
    username,
    accessToken,
    thumbnailFile, setThumbnailFile,
    setGeneratedThumbnail,
    setLoading,
    step, setStep,
    isOpenAuth, setIsOpenAuth,
    uploadVideoProgress, setUploadVideoProgress,
    setUploadStatus,
    setError,
    uploadURLRef,
  } = useLegacyUpload();

  useEffect(()=>{
    setStep(1)
    getBanInfo()
  }, [])


    useEffect(() => {
    const fetchCommunities = async () => {
      try {
        const response = await axios.post("https://api.hive.blog", {
          jsonrpc: "2.0",
          method: "bridge.list_communities",
          params: { last: "", limit: 100 },
          id: 1,
        });
        setCommunitiesData(response.data.result || []);
      } catch (error) {
        console.error("Error fetching communities:", error);
      }
    };

    fetchCommunities();
  }, []);

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
  }, [uploadURL, thumbnailFile]); // Empty dependency to only run once on mount
  
  const toggleUploadModalAuth = ()=>{
    setIsOpenAuth( (prev)=> !prev)
  }

  useEffect(()=>{
    checkPostAuth(user);
  },[])


  const getBanInfo = async ()=>{
    const res = await axios.get(`https://check-api.3speak.tv/check/${username}`)
    console.log(res.data)
    setBanned(res.data.canUpload)
  }

    const  checkPostAuth= async(username)=>{
        if(!authenticated){
          return
        }
        const hasAuth = await has3SpeakPostAuth(username);
        if (!hasAuth) {
          setIsOpenAuth(true);
        }
      }

      const updateVideoInfo = async (thumbnailFile) => {
          console.log("Upload URL:", uploadURL);
          console.log("Video File:", videoFile);
          console.log("Thumbnail File:", thumbnailFile);
          if (!uploadURL || !videoFile || !thumbnailFile) {
              console.error("Missing video and thumbnail data.");
              setError("Video and thumbnail is require.")
              return;
          }
          setError("")
          const oFilename = videoFile.name;
          const fileSize = videoFile.size;
          const thumbnailIdentifier = thumbnailFile.replace("https://uploads.3speak.tv/files/", "");
          console.log(thumbnailIdentifier)
  
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
  
              if(data){
                  console.log("Video info updated successfully:", data);
                  setVideoId(data._id);
                  setUploadStatus(true)
              }
  
              
  
              
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
    <>
    <div className="studio-main-container">
      <div className="studio-page-header">
        <h1>Upload Video</h1>
        <p>Follow the steps below to upload and publish your video</p>
      </div>
      <StepProgress step={step} />
      <div className="studio-page-content">
      <VideoUploadStep1
       setPrevVideoUrl={setPrevVideoUrl}
       setPrevVideoFile={setPrevVideoFile}
       setVideoId={setVideoId}
       videoFile={videoFile}
       setVideoFile={setVideoFile}
       setVideoDuration={setVideoDuration}
       setUploadURL={setUploadURL}
       username={username}
       accessToken={accessToken}
       thumbnailFile={thumbnailFile}
       setThumbnailFile={setThumbnailFile}
       setGeneratedThumbnail={setGeneratedThumbnail}
       setStep={setStep}
       setUploadVideoProgress={setUploadVideoProgress}
       uploadVideoProgress={uploadVideoProgress}
       uploadURLRef={uploadURLRef}
       banned={banned}
       />
      {/* {step === 2 && <VideoUploadStep2 
      videoFile={videoFile}
      videoDuration={videoDuration}
       generatedThumbnail={generatedThumbnail}
       thumbnailFile={thumbnailFile}
       setThumbnailFile={setThumbnailFile}
       uploadURL={uploadURL}
       username={username}
       accessToken={accessToken}
       videoId={videoId}
       setStep={setStep}
       setVideoId={setVideoId}
       setUploadThumbnailProgress={setUploadThumbnailProgress}
       uploadThumbnailProgress={uploadThumbnailProgress}
       setUploadStatus={setUploadStatus}
       uploadVideoProgress={uploadVideoProgress}
       uploadURLRef={uploadURLRef}
       />} */}

       {/* {step === 3 &&<div className="progressbar-container">
        <div className="content-wrap">
          <div className="wrap">
            <div className="wrap-top"><h3>Video encoding</h3> <div>{uploadVideoProgress}%</div></div>
            { uploadVideoProgress > 0 &&<div className="progress-bars">
            <div className="progress-bar-fill" style={{ width: `${uploadVideoProgress}%` }}>
            </div>
          </div>}
          </div>
          <div className="wrap">
            <div className="wrap-top"><h3>Fetching Thumbnail</h3> <div>{uploadThumbnailProgress}%</div></div>
            {uploadThumbnailProgress > 0 &&<div className="progress-bars">
            <div className="progress-bar-fill" style={{ width: `${uploadThumbnailProgress}%` }}>
            </div>
          </div>}
          </div>
          <div className="wrap">
            <div className="wrap-upload"><h3>{!uploadStatus ? "Uploading video" :'Video uploaded'} </h3> <div>{!uploadStatus ? <LineSpinner size="20" stroke="3" speed="1" color="black" /> : <img src={checker} alt="" />}</div></div>
          </div>

          
        </div>
        

       </div>} */}



      {/* {step === 4 && <Preview 
      title={title}
        description={sanitizedDescription}  
        tagsPreview={tagsPreview}
        videoId={videoId}   
        prevVideoFile={prevVideoFile}
        thumbnailFile={thumbnailFile}
        sanitizedDescription={sanitizedDescription}
        setStep={setStep}
        setVideoId={setVideoId}
        setPrevVideoUrl={setPrevVideoUrl}
        tagsInputValue={tagsInputValue}
        community={community}
        beneficiaries={beneficiaries}
        declineRewards={declineRewards}
        rewardPowerup={rewardPowerup}



      />} */}
        </div>
    </div>
          {/* {isOpen && <Communitie_modal isOpen={isOpen} data={communitiesData} close={closeCommunityModal} setCommunity={setCommunity} />} */}
          {/* {benficaryOpen && <Beneficiary_modal
              close={toggleBeneficiaryModal}
              isOpen={benficaryOpen}
              setBeneficiaries={setBeneficiaries}
              setBeneficiaryList={setBeneficiaryList}
              setList={setList}
              list={list}
              setRemaingPercent={setRemaingPercent}
              remaingPercent={remaingPercent}
          />} */}
          {isOpenAuth && <Auth_modal isOpenAuth={isOpenAuth} closeAuth={toggleUploadModalAuth} />}

      </>
  );
}

export default StudioPage;
