import { Route, Routes } from "react-router-dom";
import "./App.css";
// import Home from './page/Home'
// import Treanding from './page/Treanding'
import Nav from "./components/nav/Nav";
import { useState } from "react";
import Watch from "./page/Watch";
import Sidebar from "./components/Sidebar/Sidebar";
import Feed from "./components/Feed/Feed";
import FirstUploads from "./page/FirstUploads";
import Trend from "./page/Trend";
import NewVideos from "./page/NewVideos";
import UploadVideo from "./page/UploadVideo";
import Login from "./page/Login/Login";
// import KeyChainLogin from './page/Login/KeyChainLogin'
import KeyChainLogin from "./page/Login/KeyChainLogin";
import LoginNew from "./page/Login/LoginNew";
import { useAppStore } from "./lib/store";
import { useEffect } from "react";
import ProfileNav from "./components/nav/ProfileNav";
import StudioPage from "./components/studio2/StudioPage";
import StudioPage2 from "./components/studio2/StudioPage";
import CommunitiesRender from "./components/Communities/CommunitiesRender";
import CommunityPage from "./components/Communities/CommunityPage";
import TagFeed from "./page/TagFeed";
import LeaderBoard from "./page/LeaderBoard";
import ProfilePage from "./page/ProfilePage";
import Wallet from "./page/Wallet";
import Testing from "./components/Testingfile/Testing";
import UserProfilePage from "./components/Userprofilepage/UserProfilePage";
import DraftStudio from "./components/studio/DraftStudio";
import EditVideo from "./page/EditVideo";
import ScrollToTop from "./components/ScrollToTop";
import AddAccount_modal from "./components/modal/AddAccount_modal";
import TestingLogin3 from "./page/Login/TestingLogin3";
// import TestingLogin from "./page/Login/TestingLogin";
import AboutPage from "./components/LandingPage/AboutPage";
import { toast, Toaster } from 'sonner'
import Thumbnail from "./components/studio2/Thumbnail";
import Details from "./components/studio2/Details";
import Preview from "./components/studio2/Preview";
import Test from "./page/Test";
// import Email from "./page/Login/Email"
// import AuthCallback from "./page/Login/AuthCallback";
// import {AUTH_JWT_SECRET} from "../src/utils/config";


import { jwtDecode } from "jwt-decode";
import AuthCallback from "./page/Login/AuthCallback";
import NotFound from "./page/NotFound";

function App() {
  const { initializeAuth, authenticated, LogOut } = useAppStore();
  const [sidebar, setSideBar] = useState(true);
  const [profileNavVisible, setProfileNavVisible] = useState(false);

  const [globalCloseRender, setGlobalCloseRender] = useState(false)
  const [toggle, setToggle] = useState(false);
  const [reloadSwitch, setRelaodSwitch] = useState(false)
  



  useEffect(() => {
    initializeAuth();
    tokenVaildation()

  }, []);





  const tokenVaildation = ()=>{
    const token = window.localStorage.getItem("access_token")
    if (token && authenticated){
      try {
    const decoded = jwtDecode(token);
    console.log(decoded)

    // exp is in seconds, Date.now() is in ms
    const isExpired = decoded.exp * 1000 < Date.now();
    if (isExpired) {
          // console.warn("Token expired — logging out user");
          toast.error("Secssion expired")
          LogOut(decoded.user_id); // this will already remove the token
          return false;
        }
    return !isExpired;
  } catch (err) {
    console.error("Invalid token:", err);
    return false;
  }
    }

  }

  

  // const closeProfileNav = ()=>{
  //   setProfileNavVisible(!profileNavVisible)
  // }
  const toggleProfileNav = () => {
    setProfileNavVisible((prev) => !prev);
    console.log(profileNavVisible);
  };

  const toggleAddAccount = () => {
    setToggle((prev) => !prev);
  }

  return (
    <div onClick={()=> {setGlobalCloseRender(true)}}>
      <Toaster richColors position="top-right" />
      <Nav setSideBar={setSideBar} toggleProfileNav={toggleProfileNav}  globalClose={globalCloseRender} setGlobalClose={setGlobalCloseRender} />
      <div>
        <Sidebar sidebar={sidebar} />
        <div className={`container ${sidebar ? "" : "large-container"}`}>
          <ScrollToTop />
          {/* <Toaster richColors position="top-right" /> */}
          <Routes>
            <Route path="/" element={<Feed />} />
            <Route path="/watch" element={<Watch />} />
            <Route path="/upload" element={<UploadVideo />} />
            <Route path="/firstupload" element={<FirstUploads />} />
            <Route path="/trend" element={<Trend />} />
            <Route path="/new" element={<NewVideos />} />
            <Route path="/login" element={<KeyChainLogin />} />
             <Route path="/auth/callback" element={<AuthCallback />} />
            {/* <Route path="/email" element={<Email/>} />  */}
            <Route path="/newlogin" element={<LoginNew />} />
            <Route path="/studio" element={<StudioPage />} />
            <Route path="/studio/thumbnail" element={<Thumbnail />} />
            <Route path="/studio/details" element={<Details />} />
            <Route path="/studio/preview" element={<Preview />} />
            <Route path="/studio2" element={<StudioPage2 />} />
            <Route path="/draft" element={<DraftStudio />} />
            <Route path="/editvideo/:d" element={<EditVideo />} />
            <Route path="/communities" element={<CommunitiesRender />} />
            <Route path="/about" element={<AboutPage />} />
            <Route
              path="/community/:communityName"
              element={<CommunityPage />}
            />
            <Route path="/t/:tag" element={<TagFeed />} />
            <Route path="/leaderboard" element={<LeaderBoard />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/p/:user" element={<UserProfilePage />} />
            <Route path="/wallet/:user" element={<Wallet />} />
            <Route path="/test" element={<Test />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </div>
        <ProfileNav isVisible={profileNavVisible} onclose={toggleProfileNav} toggleAddAccount={toggleAddAccount} />
        {toggle && <AddAccount_modal close={toggleAddAccount} isOpen={toggle} /> }
        
      </div>
    </div>
  );
}

export default App;
