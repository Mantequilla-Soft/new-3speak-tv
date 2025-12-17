import { createContext, useContext, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "../lib/store";

const LegacyUploadContext = createContext();

export function LegacyUploadProvider({ children }) {

    const initialState = {
    title: "",
    description: "",
    tagsInputValue: "",
    tagsPreview: [],
    community: "hive-181335",
    beneficiaries: "[]",
    declineRewards: false,
    rewardPowerup: false,
    communitiesData: [],
    prevVideoUrl: null,
    prevVideoFile: null,
    uploadURL: "",
    videoId: "",
    videoFile: null,
    videoDuration: 0,
    thumbnailFile: null,
    generatedThumbnail: [],
    loading: false,
    BeneficiaryList: 2,
    list: [],
    remaingPercent: 89,
    step: 1,
    selectedIndex: null,
    isOpenAuth: false,
    isOpen: false,
    benficaryOpen: false,
    selectedThumbnail: "",
    uploadVideoProgress: 0,
    uploadThumbnailProgress: 0,
    uploadStatus: false,
    error: "",
  };
  const { updateProcessing, user, authenticated } = useAppStore();
  const studioEndPoint = "https://studio.3speak.tv";
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tagsInputValue, setTagsInputValue] = useState("");
  const [tagsPreview, setTagsPreview] = useState([]);
  const [community, setCommunity] = useState("hive-181335");
  const [beneficiaries, setBeneficiaries] = useState("[]");
  const [declineRewards, SetDeclineRewards] = useState(false);
  const [rewardPowerup, setRewardPowerup] = useState(false);
  const [communitiesData, setCommunitiesData] = useState([]);
  const [prevVideoUrl, setPrevVideoUrl] = useState(null);
  const [prevVideoFile, setPrevVideoFile] = useState(null);
  const [uploadURL, setUploadURL] = useState("");
  const [videoId, setVideoId] = useState("");
  const [videoFile, setVideoFile] = useState(null);
  const [videoDuration, setVideoDuration] = useState(0);
  const username = localStorage.getItem("user_id");
  const accessToken = localStorage.getItem("access_token");
  const [thumbnailFile, setThumbnailFile] = useState(null);
  const [generatedThumbnail, setGeneratedThumbnail] = useState([]);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const [BeneficiaryList, setBeneficiaryList] = useState(2);
  const [list, setList] = useState([]);
  const [remaingPercent, setRemaingPercent] = useState(89);
  const [step, setStep] = useState(1);
  const [isOpenAuth, setIsOpenAuth] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [benficaryOpen, setBeneficiaryOpen] = useState(false);
  const [selectedThumbnail, setSelectedThumbnail] = useState("");
  const [uploadVideoProgress, setUploadVideoProgress] = useState(0);
  const [uploadThumbnailProgress, setUploadThumbnailProgress] = useState(0);
  const [uploadStatus, setUploadStatus] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(null);
  const [error, setError] = useState("");
  const uploadURLRef = useRef("");


   // 🔑 Reset all fields
  const resetUploadState = () => {
    setTitle(initialState.title);
    setDescription(initialState.description);
    setTagsInputValue(initialState.tagsInputValue);
    setTagsPreview(initialState.tagsPreview);
    setCommunity(initialState.community);
    setBeneficiaries(initialState.beneficiaries);
    SetDeclineRewards(initialState.declineRewards);
    setRewardPowerup(initialState.rewardPowerup);
    setCommunitiesData(initialState.communitiesData);
    setPrevVideoUrl(initialState.prevVideoUrl);
    setPrevVideoFile(initialState.prevVideoFile);
    setUploadURL(initialState.uploadURL);
    setVideoId(initialState.videoId);
    setVideoFile(initialState.videoFile);
    setVideoDuration(initialState.videoDuration);
    setThumbnailFile(initialState.thumbnailFile);
    setGeneratedThumbnail(initialState.generatedThumbnail);
    setLoading(initialState.loading);
    setBeneficiaryList(initialState.BeneficiaryList);
    setList(initialState.list);
    setRemaingPercent(initialState.remaingPercent);
    setStep(initialState.step);
    setIsOpenAuth(initialState.isOpenAuth);
    setIsOpen(initialState.isOpen);
    setBeneficiaryOpen(initialState.benficaryOpen);
    setSelectedThumbnail(initialState.selectedThumbnail)
    setUploadVideoProgress(initialState.uploadVideoProgress);
    setUploadThumbnailProgress(initialState.uploadThumbnailProgress);
    setUploadStatus(initialState.uploadStatus);
    setSelectedIndex(initialState.selectedIndex)

    setError(initialState.error);
  };
 

  return <LegacyUploadContext.Provider value={{
        // store
        updateProcessing,
        user,
        authenticated,
        studioEndPoint,
        username,
        accessToken,

        // video info
        title, setTitle,
        description, setDescription,
        tagsInputValue, setTagsInputValue,
        tagsPreview, setTagsPreview,
        community, setCommunity,
        beneficiaries, setBeneficiaries,
        declineRewards, SetDeclineRewards,
        rewardPowerup, setRewardPowerup,
        communitiesData, setCommunitiesData,


        // video files
        prevVideoUrl, setPrevVideoUrl,
        prevVideoFile, setPrevVideoFile,
        uploadURL, setUploadURL,
        videoId, setVideoId,
        videoFile, setVideoFile,
        videoDuration, setVideoDuration,
        thumbnailFile, setThumbnailFile,
        generatedThumbnail, setGeneratedThumbnail,
        selectedThumbnail, setSelectedThumbnail,
        selectedIndex, setSelectedIndex,

        // states
        loading, setLoading,
        navigate,
        BeneficiaryList, setBeneficiaryList,
        list, setList,
        remaingPercent, setRemaingPercent,
        step, setStep,
        isOpenAuth, setIsOpenAuth,
        isOpen, setIsOpen,
        benficaryOpen, setBeneficiaryOpen,
        uploadVideoProgress, setUploadVideoProgress,
        uploadThumbnailProgress, setUploadThumbnailProgress,
        uploadStatus, setUploadStatus,
        error, setError,
        uploadURLRef,
        resetUploadState
       
      }}>
         {children}
       </LegacyUploadContext.Provider>;
}

// export default LegacyUploadContext;
export const useLegacyUpload = () => useContext(LegacyUploadContext);
