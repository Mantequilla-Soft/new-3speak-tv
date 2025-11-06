import React, { useEffect, useState } from 'react';
import './KeyChainLogin.scss';
import axios from "axios";
import logo from '../../assets/image/3S_logo.svg';
import keychainImg from '../../assets/image/keychain.png';
import hiveauthImg from '../../../public/images/hiveauth.jpeg';
import { useNavigate } from 'react-router-dom';
import { LOCAL_STORAGE_ACCESS_TOKEN_KEY, LOCAL_STORAGE_USER_ID_KEY } from '../../hooks/localStorageKeys';
import { useAppStore } from '../../lib/store';
import { LuLogOut } from 'react-icons/lu';
import {  toast } from 'sonner'
import { QRCodeSVG } from 'qrcode.react';
import   {KeyTypes, Providers } from '@aioha/aioha'
import QrCode_modal from '../../components/modal/QrCode_modal';
import aioha from "../../hive-api/aioha";

const APP_META = {
  name: "3speak",
  description: "3Speak video platform",
  icon: undefined
};




function KeyChainLogin() {
  const client = axios.create({});

  const { initializeAuth, setActiveUser, switchAccount, clearAccount, LogOut, user } = useAppStore();

  const studioEndPoint = "https://studio.3speak.tv";
  const [username, setUsername] = useState('');
  const [accountList, setAccountList] = useState([]);
  const [qrCode, setQrCode] = useState('');
  const [isWaitingHiveAuth, setIsWaitingHiveAuth] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const navigate = useNavigate();
  const [hasKeychain, setHasKeychain] = useState(false);
  const isMobile = window.innerWidth <= 768;

  useEffect(() => {
    const getAccountlist = JSON.parse(localStorage.getItem("accountsList")) || [];
    setAccountList(getAccountlist);
  }, []);

  useEffect(() => {
  if (window.hive_keychain) {
    setHasKeychain(true);
  }
}, []);

  async function logMe() {
    if (!username) {
      toast.error("Username is required to proceed.");
      return;
    }

    let proof = Math.floor(new Date().getTime() / 1000);

    try {
      const login = await aioha.login(Providers.Keychain, username, {
        msg: `${proof}`,
        keyType: KeyTypes.Posting,
        
      });

      console.log("Login response:", login);
      if (login.error === "HiveAuth authentication request expired") {
        toast.error("HiveAuth authentication request expired");
        setQrCode("")
        setShowModal(false);
      }

      if (login.error && login.error !== "Already logged in") {
        throw new Error("HiveAuth Error: " + login.error);
      }

      let signedResult = login;

      if (login.error === "Already logged in") {
        aioha.switchUser(username);
        signedResult = await aioha.signMessage(`${proof}`, KeyTypes.Posting);
        if (signedResult.error) {
          throw new Error("Signing Error: " + signedResult.error);
        }
      }

      const data = {
        "challenge": login.result,
        "proof": proof,
        "publicKey": login.publicKey,
        "username": login.username,
      }


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
    const decodedMessage = response.data.token;
      localStorage.setItem(LOCAL_STORAGE_ACCESS_TOKEN_KEY, decodedMessage);
      localStorage.setItem(LOCAL_STORAGE_USER_ID_KEY, username);
      initializeAuth();
      navigate("/");
      toast.success("Login successful!");



    } catch (err) {
      console.error(err);
      toast.error("Login failed: " + err.message);
    }
  }

  


const handleLoginWithHiveAuth = async () => {
  if (!username) {
    toast.error("Username is required to proceed.");
    return;
  }

  let proof = Math.floor(new Date().getTime() / 1000);
  try {
        const login = await aioha.login(Providers.HiveAuth, username, {
          msg: `${proof}`,
          keyType: KeyTypes.Posting,
          hiveauth: {
            cbWait: (payload) => {
              setQrCode(payload);
              setShowModal(true);
            },
          },
        });
        console.log("Login response:", login);
        if (login.error === "HiveAuth authentication request expired") {
          toast.error("HiveAuth authentication request expired");
          setQrCode("")
          setShowModal(false);
        }
  
        if (login.error && login.error !== "Already logged in") {
          throw new Error("HiveAuth Error: " + login.error);
        }
  
        
        let signedResult = login;
  
        if (login.error === "Already logged in") {
          aioha.switchUser(username);
          navigate("/");
          signedResult = await aioha.signMessage(`${proof}`, KeyTypes.Posting);
          if (signedResult.error) {
            throw new Error("Signing Error: " + signedResult.error);
          }
        }
  
        const data = {
          "challenge": login.result,
          "proof": proof,
          "publicKey": login.publicKey,
          "username": login.username,
        }

        console.log(data)
  
  
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
      const decodedMessage = response.data.token;
        localStorage.setItem(LOCAL_STORAGE_ACCESS_TOKEN_KEY, decodedMessage);
        localStorage.setItem(LOCAL_STORAGE_USER_ID_KEY, username);
        initializeAuth();
        navigate("/");
        toast.success("Login successful!");
  
      } catch (err) {
        console.error(err);
        toast.error("Login failed: " + (err.response?.data?.error || err.message));
        
      }
};
  
const openKeychainApp = () => {
    if (!qrCode) return;
    window.open(qrCode, '_blank');
  };


const handleSwitchAccount = (user) => {
    switchAccount(user);
    navigate("/");
  };

  const removeAccount = async (user) => {
    try {
      clearAccount(user);
      const result = await aioha.getOtherLogins()
      console.log("Accounts after removal:", result);

      // const result = await aioha.removeOtherLogin(user)
      // const refreshed = JSON.parse(localStorage.getItem("accountsList")) || [];
      // setAccountList(refreshed);
    } catch (err) {
      console.error("Error removing account:", err);
      toast.error("Failed to remove account: " + err.message);
    }
  };


  const handleClearAccount = (e, userSelected)=>{
    e.stopPropagation();
    removeAccount(userSelected);
    if(user === userSelected){
      LogOut()
    }
  }


    const login3SpeakEmail = () => {
  const CLIENT_ID = '28d4e054a65f1fa22ddee25688';
//   const REDIRECT_URI = 'https://3speak-new-version-01.vercel.app/auth/callback';
  const REDIRECT_URI = 'http://localhost:3000/auth/callback';
  
//   const authUrl = `https://auth.3speak.tv/3/login?client_id=28d4e054a65f1fa22ddee25688&redirect_uri=https://3speak-new-version-01.vercel.app`;
    const authUrl = `https://auth.3speak.tv/3/login?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;

  // Redirect user to 3Speak auth
  window.location.href = authUrl;
};


  

  return (
    <>
    <div className="login-container">
      <div className="container-wrapper">
        <div className="main-login-keywrapper">
          <img src={logo} alt="3Speak Logo" />
          <span>Login with your username</span>

          <input
            type="text"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value.toLowerCase())}
          />

          <div className="wrap-btn">
            {hasKeychain &&<div className="wrap keychain-down" onClick={logMe}>
              <img src={keychainImg} alt="keychain" />
              <span>Keychain</span>
            </div>}
            <div className="wrap keychain-down" onClick={handleLoginWithHiveAuth}>
              <img src={hiveauthImg} alt="HiveAuth" />
              <span>HiveAuth</span>
            </div>
            <div className="wrap keychain-down" onClick={login3SpeakEmail}>
              <img src={hiveauthImg} alt="HiveAuth" />
              <span>Email</span>
            </div>

          </div>

          <div className="wrap-signup keychain-space">
            <span>Don't have an account?</span>
            <span className="last">Sign up now!</span>
            {/* <QRCodeSVG value={qrUrl} size={200} /> */}
          </div>

          {accountList.length > 0 && (
            <div className="switch-acct-wrapper">
              <h3>Login As</h3>
              <div className="list-acct-wrap">
                {accountList.map((list, idx) => (
                  <div key={idx} className='wrap' onClick={() => handleSwitchAccount(list.username)}>
                    <img src={`https://images.hive.blog/u/${list.username}/avatar`} alt={list.username} />
                    <span>{list.username}</span>

                    {/* <LuLogOut size={12} onClick={(e) => { e.stopPropagation(); removeAccount(list.username); }} /> */}

                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
        { qrCode && showModal && <QrCode_modal qrCode={qrCode} openKeychainApp={openKeychainApp} />}
    
    </>
  );
}

export default KeyChainLogin;
