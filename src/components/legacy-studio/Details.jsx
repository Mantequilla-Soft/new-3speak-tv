import React, { useEffect,  } from 'react'
import {  toast } from 'sonner'
import { StepProgress } from './StepProgress';
import TextEditor from '../studio/TextEditor';
import { IoIosArrowDropdownCircle } from 'react-icons/io';
import { MdPeopleAlt } from 'react-icons/md';
import Communitie_modal from "../modal/Communitie_modal";
import Beneficiary_modal from '../modal/Beneficiary_modal';
import { Navigate } from 'react-router-dom';
import { useLegacyUpload } from '../../context/LegacyUploadContext';
// import BlogContent from "../playVideo/BlogContent";
import TiptapEditor from '../Editor/TiptapEditor';
// import EditorPreview from '../playVideo/EditorPreview';

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
        navigate,
        BeneficiaryList, setBeneficiaryList,
        list, setList,
        remaingPercent, setRemaingPercent,
        step, setStep,
        isOpen, setIsOpen,
        benficaryOpen, setBeneficiaryOpen,
        selectedThumbnail,
      } = useLegacyUpload();


  useEffect(() => {
    setStep(3)
  }, [])


  if (!selectedThumbnail) {
    return <Navigate to="/studio" replace />;
  }

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



    const process = () => {
        if (!title || !description || !tagsInputValue || !community || !selectedThumbnail) {
            toast.error("Please fill in all fields, Title, Description and tag!");
            return;
        }
        navigate("/studio/preview")
        setStep(4)

    }

  return (
    <>
    <div className="studio-main-container">
      <div className="studio-page-header">
        <h1>Upload Video</h1>
        <p>Follow the steps below to upload and publish your video</p>
      </div>
      <StepProgress step={step} />
      <div className="studio-page-content">
       

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
          {/* <TextEditor description={description} setDescription={setDescription} style={{ height: "80%", }} /> */}
          <TiptapEditor value={description} onChange={setDescription} />
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
        <div className="community-box-wrap">
        <div className="community-wrap" onClick={openCommunityModal}>
            {community ? <span>{community === "hive-181335" ? <div className="wrap"><img src={`https://images.hive.blog/u/hive-181335/avatar`} alt="" /><span></span>Threespeak</div> : <div className="wrap"><img src={`https://images.hive.blog/u/${community.name}/avatar`} alt="" /><span></span>{community.title}</div> }</span> : <span> Select Community </span> }
            <IoIosArrowDropdownCircle size={16} />
          </div>  
          <span>Select Community </span>
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
        <button onClick={()=>{console.log("description===>", description); process() }}>Proceed</button>
        </div>

        </div>
        {/* <EditorPreview content={description} /> */}
        {/* <div className="Preview">
        <h3>Preview</h3>


        <div className="preview-title">
           {title && <span> {title}</span>}
        </div>
        <BlogContent description={description} />
        <div className="preview-tags">
        {tagsPreview &&<span> Tags: {tagsPreview.map((item, index) => (
      <span className="item" key={index} style={{ marginRight: '8px' }}>
        {item}
      </span>
    ))}</span>}
        </div>

        

       
        {selectedThumbnail && (
              <div className="preview-video">
                
                <VideoPreview file={prevVideoFile} />
                </div>)}

      
        {selectedThumbnail && (
          <div className="preview-thumbnail">
            <img
              src={selectedThumbnail}
              alt="Thumbnail"
              style={{ width: "250px", height: "auto", borderRadius: "8px",marginTop: "10px", }}
            />
          </div>
        )}
        

        </div> */}
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