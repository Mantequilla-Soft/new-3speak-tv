import React, { useEffect } from 'react'
import { toast } from 'sonner'
import { StepProgress } from './StepProgress';
import { IoIosArrowDropdownCircle } from 'react-icons/io';
import { MdPeopleAlt } from 'react-icons/md';
import Communitie_modal from "../modal/Communitie_modal";
import Beneficiary_modal from '../modal/Beneficiary_modal';
import { Navigate } from 'react-router-dom';
import { useLegacyUpload } from '../../context/LegacyUploadContext';
import { LineSpinner } from 'ldrs/react';
import checker from "../../../public/images/checker.png"
import MarkdownComposer from '../studio/MarkdownComposer';
import { getMinMaxDates } from '../../utils/schedulingHelpers';

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
        uploadVideoProgress,
        uploadStatus,
        isUploadLocked,
        isScheduled, setIsScheduled,
        scheduleDateTime, setScheduleDateTime
        // NOTE: Auto-submit values imported but not used in Details
        // The logic happens in Preview page when user clicks "Post Video"
      } = useLegacyUpload();


  useEffect(() => {
    setStep(3)
  }, [])

    if (isUploadLocked) {
    return <Navigate to="/studio/preview" replace />;
  }


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

    // ============================================
    // Handle Proceed to Preview
    // ============================================
  const process = () => {
    if (!title?.trim()) {
      toast.error("Title is required");
      return;
    }

    if (!description?.trim()) {
      toast.error("Description is required");
      return;
    }

    if (!tagsPreview || tagsPreview.length === 0) {
      toast.error("Please add at least one tag");
      return;
    }


    // ✅ All validations passed
    navigate("/studio/preview");
    setStep(4);
  };


const handleTagChange = (e) => {
  const value = e.target.value.toLowerCase();

  const tags = value
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  const uniqueTags = [...new Set(tags)];

  // 🚫 Exceeded limit
  if (uniqueTags.length > 10) {
    toast.error("You can add a maximum of 10 tags");
    return;
  }

  setTagsInputValue(value);
  setTagsPreview(uniqueTags);
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
          <MarkdownComposer value={description} onChange={setDescription} placeholder="Write your video description here... Supports markdown formatting!" />
          </div>
        </div>

        <div className="input-group">
          <label htmlFor="">Tag</label>
          <input type="text" value={tagsInputValue} onChange={handleTagChange}  />
          
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

        <div className="scheduling-wrap">
          <div className="scheduling-header">
            <label className="schedule-checkbox-label">
              <input
                type="checkbox"
                checked={isScheduled}
                onChange={(e) => {
                  setIsScheduled(e.target.checked);
                  if (!e.target.checked) {
                    setScheduleDateTime('');
                  }
                }}
              />
              <span>📅 Schedule for Later</span>
            </label>
            <small>Schedule this post to be published at a specific date and time</small>
          </div>

          {isScheduled && (
            <div className="schedule-datetime-group">
              <label htmlFor="schedule-datetime">Publish Date & Time</label>
              <input
                type="datetime-local"
                id="schedule-datetime"
                value={scheduleDateTime}
                onChange={(e) => setScheduleDateTime(e.target.value)}
                min={getMinMaxDates().minFormatted}
                max={getMinMaxDates().maxFormatted}
              />
              <small>Must be at least 1 hour in future, maximum 90 days</small>
            </div>
          )}
        </div>

        <div className="submit-btn-wrap">
          {/* Button always shows "Proceed" - no auto-submit logic here */}
          <button 
            onClick={() => {
              process();
            }}
            // disabled={!title || !description || !tagsInputValue}
          >
            Proceed
          </button>
        </div>

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
