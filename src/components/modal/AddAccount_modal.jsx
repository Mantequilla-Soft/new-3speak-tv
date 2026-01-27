import React, { useEffect, useState } from 'react';
import './AddAccount_modal.scss';
import '../../page/Login/KeyChainLogin.scss';
import '../../page/Login/Login.scss';
import axios from "axios";
import logo from '../../assets/image/3S_logo.svg';
import logoDark from '../../assets/image/3S_logodark.png';
import keychainImg from '../../assets/image/keychain.png';
import hiveauthImg from '../../../public/images/hiveauth.jpeg';
import { useLocation, useNavigate } from 'react-router-dom';
import { LOCAL_STORAGE_ACCESS_TOKEN_KEY, LOCAL_STORAGE_USER_ID_KEY } from '../../hooks/localStorageKeys';
import { useAppStore } from '../../lib/store';
import { LuLogOut } from 'react-icons/lu';
import {  toast } from 'sonner'
import 'react-toastify/dist/ReactToastify.css';
import { QRCodeSVG } from 'qrcode.react';
import   {KeyTypes, Providers } from '@aioha/aioha'
import QrCode_modal from '../../components/modal/QrCode_modal';
import aioha from "../../hive-api/aioha";

function AddAccount_modal({ isOpen, close}) {
    const location = useLocation();
    const client = axios.create({});
    const { initializeAuth, switchAccount, clearAccount, theme } = useAppStore();
    const studioEndPoint = "https://studio.3speak.tv";
    const [username, setUsername] = useState('');
    const [accountList, setAccountList] = useState([]);
    const [qrCode, setQrCode] = useState('');
    const [isWaitingHiveAuth, setIsWaitingHiveAuth] = useState(false);
    const [showModal, setShowModal] = useState(false);
    const navigate = useNavigate();
    const [hasKeychain, setHasKeychain] = useState(false);

    const isMobile = window.innerWidth <= 768;
    const isIphone = /iPhone/.test(navigator.userAgent);

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

    
    const decodedMessage = response.data.token;
      localStorage.setItem(LOCAL_STORAGE_ACCESS_TOKEN_KEY, decodedMessage);
      localStorage.setItem(LOCAL_STORAGE_USER_ID_KEY, username);
      initializeAuth();
      // navigate("/");
      const preAuth = (location.state && location.state.from && location.state.from.pathname) || sessionStorage.getItem('preLoginPath') || '/';
      navigate(preAuth);
      close()
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
        
        
              const response = await axios.post(
              'https://studio.3speak.tv/mobile/login',
              data,
              {
                headers: {
                  'Content-Type': 'application/json',
                },
              }
            );
        
    
            const decodedMessage = response.data.token;
              localStorage.setItem(LOCAL_STORAGE_ACCESS_TOKEN_KEY, decodedMessage);
              localStorage.setItem(LOCAL_STORAGE_USER_ID_KEY, username);
              initializeAuth();
              close()
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


  return (
    <div className={`modal ${isOpen ? "open" : ""}`}>
      <div className="overlay" onClick={close}></div>
      <div
        className={`modal-content  ${isOpen ? "open" : ""}`}
        onClick={(e) => e.stopPropagation()} // Prevent click on modal from closing it
      >
        <div className="modal-header ">
          
          <button className="close-btn auth-bg" onClick={close}>
            &times;
          </button>
        </div>
        <div className="modal-body ">
          <div className="login-container">

        <div className="main-login-keywrapper-add">
          {theme === "light" ? <img src={logo} alt="3Speak Logo" /> :
                    <img src={logoDark} alt="3Speak Logo" />}
          <span>Login with your username</span>

          <input
            type="text"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value.toLowerCase())}
            style={{
                  fontSize: isMobile ? (isIphone ? '16px' : '14px') : undefined
                }}
          />

          <div className="wrap-btn">
           {hasKeychain && <div className="wrap keychain-down" onClick={logMe}>
              <img src={keychainImg} alt="keychain" />
              <span>Keychain</span>
            </div>}
            <div className="wrap keychain-down" onClick={handleLoginWithHiveAuth}>
              <img src={hiveauthImg} alt="HiveAuth" />
              <span>HiveAuth</span>
            </div>
          </div>
        </div>
 
    </div>
        { qrCode && showModal && 
        <div style={{ marginTop: '1.5rem', textAlign: 'center' }}>
                          <p>Scan this QR in Hive Keychain:</p>
                          <div onClick={openKeychainApp} style={{ cursor: 'pointer', display: 'inline-block' }}>
                              <QRCodeSVG value={qrCode} size={180} />
                              <p style={{ fontSize: '0.8rem', marginTop: '0.5rem', color: '#007bff' }}>
                                  Click QR to open in Keychain app
                              </p>
                          </div>
                      </div>}
    
          
        </div>
      </div>
    </div>
  )
}

export default AddAccount_modal