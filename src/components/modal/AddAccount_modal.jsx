import React, { useEffect, useState } from 'react';
import './AddAccount_modal.scss';
import axios from "axios";
import { useLocation, useNavigate } from 'react-router-dom';
import { LOCAL_STORAGE_ACCESS_TOKEN_KEY, LOCAL_STORAGE_USER_ID_KEY } from '../../hooks/localStorageKeys';
import { useAppStore } from '../../lib/store';
import { toastIn } from '../../utils/toast';
import { QRCodeSVG } from 'qrcode.react';
import   {KeyTypes, Providers } from '@aioha/aioha'
import aioha from "../../hive-api/aioha";
import { useTranslation } from 'react-i18next';
import { Dialog, ChoiceCard } from '../v2/ui';

// Every toast from this module is headed "Sign in"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Sign in');

function AddAccount_modal({ isOpen, close}) {
    const { t } = useTranslation();
    const location = useLocation();
    const { initializeAuth } = useAppStore();
    const [username, setUsername] = useState('');
    const [qrCode, setQrCode] = useState('');
    const [showModal, setShowModal] = useState(false);
    const navigate = useNavigate();
    const [hasKeychain, setHasKeychain] = useState(false);


    useEffect(() => {
      if (window.hive_keychain) {
        setHasKeychain(true);
      }
    }, []);

    async function logMe() {
    if (!username) {
      toast.error(t('modals.addAccount.usernameRequired'));
      return;
    }

    let proof = Math.floor(new Date().getTime() / 1000);

    try {
      const login = await aioha.login(Providers.Keychain, username, {
        msg: `${proof}`,
        keyType: KeyTypes.Posting,
        
      });

      
      if (login.error === "HiveAuth authentication request expired") {
        toast.error(t('modals.addAccount.hiveAuthExpired'));
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
      toast.success(t('modals.addAccount.loginSuccess'));



    } catch (err) {
      console.error(err);
      toast.error(t('modals.addAccount.loginFailed', { error: err.message }));
    }
  }





      const handleLoginWithHiveAuth = async () => {
        if (!username) {
          toast.error(t('modals.addAccount.usernameRequired'));
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
                toast.error(t('modals.addAccount.hiveAuthExpired'));
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
              toast.success(t('modals.addAccount.loginSuccess'));
        
            } catch (err) {
              console.error(err);
              toast.error(t('modals.addAccount.loginFailed', { error: err.response?.data?.error || err.message }));
              
            }
      };
      const openKeychainApp = () => {
    if (!qrCode) return;
    window.open(qrCode, '_blank');
  };


  // 07e / 23b: "@ handle" field, then the wallet to log in with as choice
  // cards, and HiveAuth's QR in a well while it waits for the phone.
  return (
    <Dialog open={!!isOpen} onClose={close} title={t('modals.addAccount.title')} width={440} className="addacct">
      <label className="addacct-handle">
        <span className="addacct-handle__at" aria-hidden="true">@</span>
        <input
          type="text"
          className="addacct-handle__input"
          placeholder={t('modals.addAccount.usernamePlaceholder')}
          aria-label={t('modals.addAccount.usernamePlaceholder')}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          value={username}
          onChange={(e) => setUsername(e.target.value.toLowerCase())}
        />
      </label>

      <div className="v2-choices is-grid addacct-wallets">
        {hasKeychain && (
          <ChoiceCard role="button" icon="extension" title="Keychain" onClick={logMe} />
        )}
        <ChoiceCard role="button" icon="qr_code_2" title="HiveAuth" onClick={handleLoginWithHiveAuth} />
      </div>

      {qrCode && showModal && (
        <button type="button" className="v2-well addacct-qr" onClick={openKeychainApp}>
          <span className="addacct-qr__code"><QRCodeSVG value={qrCode} size={120} /></span>
          <span className="addacct-qr__text">
            <b>{t('modals.qr.title')}</b>
            <span>{t('modals.qr.scan')} {t('modals.qr.click')}</span>
          </span>
        </button>
      )}
    </Dialog>
  )
}

export default AddAccount_modal
