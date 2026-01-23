import React, { useState } from 'react';
// import { QRCode } from 'qrcode.react';
import { QRCodeSVG } from 'qrcode.react';
// import aioha, { Providers, KeyTypes } from 'aio-hive-auth';
import { initAioha, Asset, KeyTypes, Providers } from '@aioha/aioha'
import axios from 'axios';
import { useAppStore } from '../../lib/store';
import {  toast } from 'sonner'
import { LOCAL_STORAGE_ACCESS_TOKEN_KEY, LOCAL_STORAGE_USER_ID_KEY } from '../../hooks/localStorageKeys';
import { useNavigate } from 'react-router-dom';
import QrCode_modal from '../modal/QrCode_modal';
import aioha from "../../hive-api/aioha";





const LoginWithHiveAuth = () => {
  const navigate = useNavigate();
   const { initializeAuth } = useAppStore();
  const [username, setUsername] = useState('');
  const [qrCode, setQrCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [accessToken, setAccessToken] = useState('');
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);

  // const handleLogin = async () => {
  //   if (!username) return alert('Please enter your Hive username');
  //   setLoading(true);
  //   setError('');
  //   let proof = Math.floor(new Date().getTime() / 1000);

  //   try {
  //     const login = await aioha.login(Providers.HiveAuth, username, {
  //       msg: `${proof}`,
  //       keyType: KeyTypes.Posting,
  //       hiveauth: {
  //         cbWait: (payload) => {
  //           setQrCode(payload);
  //           setShowModal(true);
  //         },
  //       },
  //     });
  //     console.log("Login response:", login);
  //     if (login.error === "HiveAuth authentication request expired") {
  //       toast.error("HiveAuth authentication request expired");
  //       setQrCode("")
  //       setShowModal(false);
  //     }

  //     if (login.error && login.error !== "Already logged in") {
  //       throw new Error("HiveAuth Error: " + login.error);
  //     }

      
  //     let signedResult = login;

  //     if (login.error === "Already logged in") {
  //       aioha.switchUser(username);
  //       signedResult = await aioha.signMessage(`${proof}`, KeyTypes.Posting);
  //       if (signedResult.error) {
  //         throw new Error("Signing Error: " + signedResult.error);
  //       }
  //     }

  //     const data = {
  //       "challenge": login.result,
  //       "proof": proof,
  //       "publicKey": login.publicKey,
  //       "username": login.username,
  //     }


  //     const response = await axios.post(
  //     'https://studio.3speak.tv/mobile/login',
  //     data,
  //     {
  //       headers: {
  //         'Content-Type': 'application/json',
  //       },
  //     }
  //   );

  //   console.log('Login Success:', response.data);
  //   const decodedMessage = response.data.token;
  //     localStorage.setItem(LOCAL_STORAGE_ACCESS_TOKEN_KEY, decodedMessage);
  //     localStorage.setItem(LOCAL_STORAGE_USER_ID_KEY, username);
  //     initializeAuth();
  //     navigate("/");
  //     toast.success("Login successful!");

  //   } catch (err) {
  //     console.error(err);
  //     setError(err.message || "Something went wrong.");
      
  //   }

  //   setLoading(false);
  // };


  const handleLogin = async () => {
    if (!username) return alert('Please enter your Hive username');
    setLoading(true);
    setError('');
    let proof = Math.floor(new Date().getTime() / 1000);

    try {
      const login = await aioha.login(Providers.Keychain, username, {
        msg: `${proof}`,
        keyType: KeyTypes.Posting,
        // hiveauth: {
        //   cbWait: (payload) => {
        //     setQrCode(payload);
        //     setShowModal(true);
        //   },
        // },
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
      navigate("/");
      toast.success("Login successful!");

    } catch (err) {
      console.error(err);
      setError(err.message || "Something went wrong.");
      
    }

    setLoading(false);
  };



  

  

  const openKeychainApp = () => {
    if (!qrCode) return;
    window.open(qrCode, '_blank');
  };

const handlelogout = async () => {
  try {
    await aioha.logout(Providers.HiveAuth);
    setQrCode('');
    setAccessToken('');
    setUsername('');
    alert('Logged out successfully');
  } catch (err) {
    console.error('Logout error:', err);
    alert('Failed to log out');
  }
}

  return (
    <>
    <div className="login-box" style={{ padding: '2rem', maxWidth: '400px', margin: 'auto' }}>
      <h2>Login with HiveAuth</h2>
      <input
        type="text"
        placeholder="Enter Hive username"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        style={{ width: '100%', padding: '0.5rem', marginBottom: '1rem' }}
      />

      <button onClick={handleLogin} disabled={loading} style={{ padding: '0.5rem 1rem' }}>
        {loading ? "Connecting..." : "Login with HiveAuth"}
      </button>

      <button onClick={()=>handlelogout("tovia01")}> Lgout</button>

      {qrCode && showModal && (
        <div style={{ marginTop: '1.5rem', textAlign: 'center' }}>
          <p>Scan this QR in Hive Keychain:</p>
          <div onClick={openKeychainApp} style={{ cursor: 'pointer', display: 'inline-block' }}>
            <QRCodeSVG value={qrCode} size={180} />
            <p style={{ fontSize: '0.8rem', marginTop: '0.5rem', color: '#007bff' }}>
              Click QR to open in Keychain app
            </p>
          </div>
        </div>
      )}

      {accessToken && (
        <div style={{ marginTop: '1rem', background: '#e6ffed', padding: '1rem', borderRadius: '5px' }}>
          <strong>Access Token:</strong>
          <pre style={{ overflowX: 'auto' }}>{accessToken}</pre>
        </div>
      )}

      {error && (
        <div style={{ color: 'red', marginTop: '1rem' }}>
          <strong>Error:</strong> {error}
        </div>
      )}
    </div>
    { qrCode && showModal && <QrCode_modal qrCode={qrCode} openKeychainApp={openKeychainApp} />}
    </>
  );
};

export default LoginWithHiveAuth;