import { Route, Routes, useLocation } from "react-router-dom";
import { useRef } from "react";
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
import HomeGrouped from "./page/HomeGrouped";
import UploadVideo from "./page/UploadVideo";
import Login from "./page/Login/Login";
// import KeyChainLogin from './page/Login/KeyChainLogin'
import KeyChainLogin from "./page/Login/KeyChainLogin";
import LoginNew from "./page/Login/LoginNew";
import { useAppStore } from "./lib/store";
import { useEffect } from "react";
import ProfileNav from "./components/nav/ProfileNav";
import StudioPage from "./components/legacy-studio/StudioPage";
// import StudioPage2 from "./components/legacy-studio/StudioPage";
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
import Thumbnail from "./components/legacy-studio/Thumbnail";
import Details from "./components/legacy-studio/Details";
import Preview from "./components/legacy-studio/Preview";
import Test from "./page/Test";
// import Email from "./page/Login/Email"
// import AuthCallback from "./page/Login/AuthCallback";
// import {AUTH_JWT_SECRET} from "../src/utils/config";


import { jwtDecode } from "jwt-decode";
import AuthCallback from "./page/Login/AuthCallback";
import NotFound from "./page/NotFound";
import ProfileModal from "./components/modal/ProfileModal";
import HiveImageUploader from "./page/HiveImageUploader";
import { LegacyUploadProvider } from "./context/LegacyUploadContext";
import { HiveAuthProvider } from "./context/HiveAuthContext";
import { AiohaModal, useAioha } from "@aioha/react-ui";
import { KeyTypes } from "@aioha/aioha";
import '@aioha/react-ui/dist/build.css';
import { LOCAL_STORAGE_ACCESS_TOKEN_KEY, LOCAL_STORAGE_USER_ID_KEY } from "./hooks/localStorageKeys";
import axios from "axios";

function App() {
  const location = useLocation();
  const { initializeAuth, authenticated, LogOut, switchAccount, setUser, user: appUser } = useAppStore();
  const { aioha, user: aiohaUser } = useAioha();
  const [sidebar, setSideBar] = useState(true);
  const [profileNavVisible, setProfileNavVisible] = useState(false);

  const [globalCloseRender, setGlobalCloseRender] = useState(false)
  const [toggle, setToggle] = useState(false);
  const [reloadSwitch, setRelaodSwitch] = useState(false)
  const [loginModalOpen, setLoginModalOpen] = useState(false);
  const [loginProof, setLoginProof] = useState(() => Math.floor(Date.now() / 1000));
  const userWhenModalOpened = useRef(null); // Track user when modal opens
  



  useEffect(() => {
    initializeAuth();
    tokenVaildation()

  }, []);

  // Persist the last visited non-login route so the app can return
  // users to the same page after they sign in.
  useEffect(() => {
    if (!location) return;
    const path = `${location.pathname}${location.search || ''}`;
    // don't overwrite when on login or auth callback routes
    if (path.startsWith('/login') || path.startsWith('/auth/callback') || path.startsWith('/newlogin')) return;
    try {
      sessionStorage.setItem('preLoginPath', path);
    } catch (err) {
      // ignore storage errors
    }
  }, [location]);

  // Watch for aioha user changes and sync with 3Speak
  useEffect(() => {
    const syncAiohaUser = async () => {
      // If aioha user changed and is different from app user
      if (aiohaUser && aiohaUser !== appUser) {
        console.log("Aioha user changed:", aiohaUser, "App user:", appUser);

        // Check if we already have a token for this user (no need to re-authenticate)
        const existingAccounts = JSON.parse(localStorage.getItem("accountsList")) || [];
        const existingAccount = existingAccounts.find(acc => acc.username === aiohaUser);

        if (existingAccount && existingAccount.access_token) {
          // Use existing token - no signing required
          console.log("Using existing token for:", aiohaUser);
          localStorage.setItem(LOCAL_STORAGE_ACCESS_TOKEN_KEY, existingAccount.access_token);
          localStorage.setItem(LOCAL_STORAGE_USER_ID_KEY, aiohaUser);
          setUser(aiohaUser);
          initializeAuth();
          setLoginModalOpen(false);
          toast.success(`Switched to ${aiohaUser}`);
        } else {
          // New account - need to sign and get token from backend
          try {
            const proof = Math.floor(Date.now() / 1000);
            const signResult = await aioha.signMessage(`${proof}`, KeyTypes.Posting);

            if (signResult.error) {
              console.error("Sign error:", signResult.error);
              return;
            }

            const data = {
              challenge: signResult.result,
              proof: proof,
              publicKey: signResult.publicKey,
              username: aiohaUser,
            };

            const response = await axios.post(
              'https://studio.3speak.tv/mobile/login',
              data,
              {
                headers: {
                  'Content-Type': 'application/json',
                },
              }
            );

            console.log('Account switch success:', response.data);
            const token = response.data.token;

            localStorage.setItem(LOCAL_STORAGE_ACCESS_TOKEN_KEY, token);
            localStorage.setItem(LOCAL_STORAGE_USER_ID_KEY, aiohaUser);

            // Save to accountsList for future switches
            const filtered = existingAccounts.filter(acc => acc.username !== aiohaUser);
            const updated = [...filtered, { username: aiohaUser, access_token: token }];
            localStorage.setItem("accountsList", JSON.stringify(updated));

            setUser(aiohaUser);
            initializeAuth();
            setLoginModalOpen(false);
            toast.success(`Switched to ${aiohaUser}`);
          } catch (err) {
            console.error("Account switch error:", err);
            toast.error("Failed to switch account: " + (err.response?.data?.error || err.message));
          }
        }
      } else if (!aiohaUser && appUser) {
        // Aioha logged out - log out of 3Speak too
        console.log("Aioha logged out, logging out of 3Speak");
        LogOut(appUser);
        toast.success("Logged out successfully");
      }
    };

    syncAiohaUser();
  }, [aiohaUser]);



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

  const openLoginModal = () => {
    setLoginProof(Math.floor(Date.now() / 1000)); // Fresh timestamp when modal opens
    userWhenModalOpened.current = aioha.getCurrentUser(); // Save current user when modal opens
    setLoginModalOpen(true);
  }

  const closeLoginModal = async () => {
    setLoginModalOpen(false);

    // Check if aioha user changed while modal was open (e.g., switch user)
    const currentAiohaUser = aioha.getCurrentUser();
    const previousUser = userWhenModalOpened.current;

    // Compare against user when modal was opened (more reliable than appUser due to race conditions)
    if (currentAiohaUser && currentAiohaUser !== previousUser) {
      console.log("User changed while modal was open:", currentAiohaUser, "vs", previousUser);

      // Check if we already have a token for this user (no need to re-authenticate)
      const existingAccounts = JSON.parse(localStorage.getItem("accountsList")) || [];
      const existingAccount = existingAccounts.find(acc => acc.username === currentAiohaUser);

      if (existingAccount && existingAccount.access_token) {
        // Use existing token - no signing required
        console.log("Using existing token for:", currentAiohaUser);
        localStorage.setItem(LOCAL_STORAGE_ACCESS_TOKEN_KEY, existingAccount.access_token);
        localStorage.setItem(LOCAL_STORAGE_USER_ID_KEY, currentAiohaUser);
        setUser(currentAiohaUser);
        initializeAuth();
        toast.success(`Switched to ${currentAiohaUser}`);
      } else {
        // New account - need to sign and get token from backend
        try {
          const proof = Math.floor(Date.now() / 1000);
          const signResult = await aioha.signMessage(`${proof}`, KeyTypes.Posting);

          if (signResult.error) {
            console.error("Sign error:", signResult.error);
            return;
          }

          const data = {
            challenge: signResult.result,
            proof: proof,
            publicKey: signResult.publicKey,
            username: currentAiohaUser,
          };

          const response = await axios.post(
            'https://studio.3speak.tv/mobile/login',
            data,
            {
              headers: {
                'Content-Type': 'application/json',
              },
            }
          );

          console.log('Account switch success:', response.data);
          const token = response.data.token;

          localStorage.setItem(LOCAL_STORAGE_ACCESS_TOKEN_KEY, token);
          localStorage.setItem(LOCAL_STORAGE_USER_ID_KEY, currentAiohaUser);

          // Save to accountsList for future switches
          const filtered = existingAccounts.filter(acc => acc.username !== currentAiohaUser);
          const updated = [...filtered, { username: currentAiohaUser, access_token: token }];
          localStorage.setItem("accountsList", JSON.stringify(updated));

          setUser(currentAiohaUser);
          initializeAuth();
          toast.success(`Switched to ${currentAiohaUser}`);
        } catch (err) {
          console.error("Account switch error:", err);
          toast.error("Failed to switch account: " + (err.response?.data?.error || err.message));
        }
      }
    } else if (!currentAiohaUser && previousUser) {
      // User logged out via modal
      console.log("User logged out via modal");
      LogOut(previousUser);
      toast.success("Logged out successfully");
    }

    // Clear the ref
    userWhenModalOpened.current = null;
  }

  // Handle login callback from AiohaModal
  const handleAiohaLogin = async (loginResult) => {
    console.log("Aioha login result:", loginResult);

    if (!loginResult || loginResult.error) {
      toast.error("Login failed: " + (loginResult?.error || "Unknown error"));
      return;
    }

    try {
      // Send to 3Speak backend for JWT token
      // Use the same proof that was signed in loginOptions.msg
      const data = {
        challenge: loginResult.result,
        proof: loginProof,
        publicKey: loginResult.publicKey,
        username: loginResult.username,
      };

      const response = await axios.post(
        'https://studio.3speak.tv/mobile/login',
        data,
        {
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      console.log('Login Success:', response.data);
      const token = response.data.token;
      localStorage.setItem(LOCAL_STORAGE_ACCESS_TOKEN_KEY, token);
      localStorage.setItem(LOCAL_STORAGE_USER_ID_KEY, loginResult.username);
      initializeAuth();
      setLoginModalOpen(false);
      toast.success("Login successful!");
    } catch (err) {
      console.error("3Speak auth error:", err);
      toast.error("Login failed: " + (err.response?.data?.error || err.message));
    }
  }

  return (
    <HiveAuthProvider>
    <LegacyUploadProvider>
    <div onClick={()=> {setGlobalCloseRender(true)}}>
      <Toaster richColors position="top-right" />
      <Nav setSideBar={setSideBar} toggleProfileNav={toggleProfileNav} globalClose={globalCloseRender} setGlobalClose={setGlobalCloseRender} openLoginModal={openLoginModal} />
      <div>
        <Sidebar sidebar={sidebar} />
        <div className={`container ${sidebar ? "" : "large-container"}`}>
          <ScrollToTop />
          {/* <Toaster richColors position="top-right" /> */}
          <Routes>
            <Route path="/" element={<HomeGrouped />} />
            <Route path="/home-feed" element={<Feed />} />
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
            {/* <Route path="/studio2" element={<StudioPage2 />} /> */}
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
            <Route path="/test" element={<ProfileModal />} />
            <Route path="/image" element={<HiveImageUploader />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </div>
        <ProfileNav isVisible={profileNavVisible} onclose={toggleProfileNav} toggleAddAccount={toggleAddAccount} openLoginModal={openLoginModal} />
        {toggle && <AddAccount_modal close={toggleAddAccount} isOpen={toggle} /> }
        <AiohaModal
          displayed={loginModalOpen}
          onLogin={handleAiohaLogin}
          onClose={closeLoginModal}
          loginTitle="Login to 3Speak"
          loginOptions={{
            msg: `${loginProof}`,
            keyType: KeyTypes.Posting
          }}
        />
      </div>
    </div>

    </LegacyUploadProvider>
    </HiveAuthProvider>
  );
}

export default App;
