import  { useEffect, useState } from "react";
import axios from "axios";
// import * as tus from "tus-js-client";
import "./StudioPage.scss"
// import ReactQuill from 'react-quill';
// import 'react-quill/dist/quill.snow.css';
import { SiComma } from "react-icons/si";
import Communitie_modal from "../modal/Communitie_modal";
import Beneficiary_modal from "../modal/Beneficiary_modal"
import { IoIosArrowDropdownCircle } from "react-icons/io";
import Upload_modal from "../modal/Upload_modal";
import cloud from "../../assets/image/upload-cloud.png"
import { MdPeopleAlt } from "react-icons/md";
import DOMPurify from 'dompurify';
import TextEditor from "./TextEditor"
import { toast, ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { useNavigate } from "react-router-dom";
import { TailChase } from 'ldrs/react'
import 'ldrs/react/TailChase.css'
import { useAppStore } from "../../lib/store";
import Arrow from "./../../../public/images/arrow.png"
import VideoPreview from "./VideoPreview"


function StudioPage() {
 const client = axios.create({});
 const {updateProcessing} = useAppStore()
  const studioEndPoint = "https://studio.3speak.tv";
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tagsInputValue, setTagsInputValue] = useState("");
  const [tagsPreview, setTagsPreview] = useState([]);
  const [community, setCommunity] = useState("hive-181335");
  const [thumbnailFile, setThumbnailFile] = useState(null);
  const [beneficiaries, setBeneficiaries] = useState('[]');
  const [videoId, setVideoId] = useState("");
  const [isOpen, setIsOpen] = useState(false)
  const [uploadModalOpen, setUploadModalOpen] = useState(false)
  const [benficaryOpen, setBeneficiaryOpen] = useState(false)
  const accessToken = localStorage.getItem("access_token");
  const username = localStorage.getItem("user_id");
  const [declineRewards, SetDeclineRewards] = useState(false)
  const [rewardPowerup, setRewardPowerup  ] = useState(false)
  const [communitiesData, setCommunitiesData] = useState([]);
  const [prevVideoUrl, setPrevVideoUrl ] = useState(null)
  const [prevVideoFile, setPrevVideoFile ] = useState(null)
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  const [BeneficiaryList, setBeneficiaryList] = useState(2)
  const [list, setList] = useState([]);
  const [remaingPercent, setRemaingPercent] = useState (89)
  
  
  console.log("accesstokrn=====>", accessToken)
// updateProcessing
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
  // console.log(communitiesData)

  const openCommunityModal = () => {
    setIsOpen(true);
  };

  const closeCommunityModal = () => {
    setIsOpen(false);
  };

  const toggleUploadModal = ()=>{
    setUploadModalOpen( (prev)=> !prev)
  }

  const toggleBeneficiaryModal = ()=>{
    setBeneficiaryOpen( (prev)=> !prev)
  }


  const handleSelect = (e)=>{
    const value = e.target.value;
    if(value === "powerup"){
      setRewardPowerup(true)
      SetDeclineRewards(false)
    }else if(value === "decline"){
      SetDeclineRewards(true)
      setRewardPowerup(false)
    }else {
      SetDeclineRewards(false)
      setRewardPowerup(false)
    }
  }

  const handleSubmitDetails = async () => {
    
    console.log(beneficiaries)
    console.log(title)
    console.log(tagsInputValue)
    console.log(community)
    console.log(thumbnailFile)

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
      updateProcessing(response.data.permlink)
      toast.success("Video uploaded successfully!")
      navigate("/")
    } catch (error) {
      console.error("Failed to submit details:", error);
      toast.error("Failed uploading video details.")
      setLoading(false)
    }
  };

  const sanitizedDescription = DOMPurify.sanitize(description);


  return (
    <>
    <div className="studio-container">
      {videoId ? <div className="upload-video remove-pointer">
        <span>Upload complete. You can now proceed with the video details.</span>
        <img className="arrow-in"  src={Arrow} alt="" />
        {/* <img src={cloud} alt="" /> */}
        </div> :
       <div className="upload-video" onClick={toggleUploadModal}>
      <img src={cloud} alt="" />
        <p>
           Click to start the upload.
          <br />
          Max. Filesize is 5GB. Note: Your video will not be encoded if it is above the size limit!
        </p>
      </div>}
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
        <button onClick={()=>{console.log("description===>", description); handleSubmitDetails()}}>{loading  ? <span className="wrap-loader" >Processing <TailChase size="15" speed="1.75" color="white" /></span> : "Submit Details"}</button>
        </div>

        </div>
        <div className="Preview">
        <h3>Preview</h3>

        {/* Show the title */}
        <div className="preview-title">
           {title && <span> {title}</span>}
        </div>

        {/* Show the description */}
        <div className="preview-description">
          {sanitizedDescription &&  <span dangerouslySetInnerHTML={{ __html: sanitizedDescription }}></span>}
        </div>

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
    { isOpen && <Communitie_modal isOpen={isOpen} data={communitiesData} close={closeCommunityModal } setCommunity={setCommunity} />}
{uploadModalOpen && <Upload_modal setPrevVideoUrl={setPrevVideoUrl} setPrevVideoFile={setPrevVideoFile}  setVideoId={setVideoId} accessToken={accessToken} username={username} isOpen={uploadModalOpen} close={toggleUploadModal} setThumbnailFile={setThumbnailFile} thumbnailFile={thumbnailFile} /> }
  {benficaryOpen && <Beneficiary_modal 
  close={toggleBeneficiaryModal} 
  isOpen={benficaryOpen} 
  setBeneficiaries={setBeneficiaries} 
  setBeneficiaryList={setBeneficiaryList} 
  setList={setList} 
  list={list}
  setRemaingPercent={setRemaingPercent}
  remaingPercent={remaingPercent}
  />  }
    </>
  );
}

export default StudioPage;



