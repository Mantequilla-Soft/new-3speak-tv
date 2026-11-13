import React, { useEffect, useState } from 'react';
import './KeyChainLogin.scss';
import mark from '../../assets/image/3S_mark.svg';
import { useTranslation } from 'react-i18next';
import { Card, ChoiceCard, Chip, Button, Eyebrow, IconButton } from '../../components/v2/ui';
import { useNavigate, useLocation } from 'react-router-dom';
import { FEED_URL } from '../../utils/config';
import { LOCAL_STORAGE_USER_ID_KEY } from '../../hooks/localStorageKeys';
import { useAppStore } from '../../lib/store';
import { toastIn } from '../../utils/toast';
import   {KeyTypes, Providers } from '@aioha/aioha'
import QrCode_modal from '../../components/modal/QrCode_modal';
import aioha from "../../hive-api/aioha";

// Every toast from this module is headed "Sign in"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Sign in');

function KeyChainLogin() {
  const { t } = useTranslation();
  const { initializeAuth, switchAccount, clearAccount, LogOut, user } = useAppStore();

  const [username, setUsername] = useState('');
  const [accountList, setAccountList] = useState([]);
  const [qrCode, setQrCode] = useState('');
  const [showModal, setShowModal] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const [hasKeychain, setHasKeychain] = useState(false);

  useEffect(() => {
    const getAccountlist = JSON.parse(localStorage.getItem("accountsList")) || [];
    setAccountList(getAccountlist);
  }, []);

useEffect(() => {
  let interval; // ✅ declare variable before use

  const checkKeychain = () => {
    if (window.hive_keychain) {
      setHasKeychain(true);
      clearInterval(interval); // safe to use now
    }
  };

  checkKeychain(); // run immediately
  interval = setInterval(checkKeychain, 500); // assign after declaration

  return () => clearInterval(interval);
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

      if (login.error && login.error !== "Already logged in") {
        throw new Error("Login Error: " + login.error);
      }

      if (login.error === "Already logged in") {
        aioha.switchUser(username);
      }

      localStorage.setItem(LOCAL_STORAGE_USER_ID_KEY, username);
      initializeAuth();
      const pre = (location.state && location.state.from && location.state.from.pathname) || sessionStorage.getItem('preLoginPath') || '/';
      navigate(pre);
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
      setQrCode("");
      setShowModal(false);
      return;
    }

    if (login.error && login.error !== "Already logged in") {
      throw new Error("HiveAuth Error: " + login.error);
    }

    if (login.error === "Already logged in") {
      aioha.switchUser(username);
    }

    setShowModal(false);
    localStorage.setItem(LOCAL_STORAGE_USER_ID_KEY, username);
    initializeAuth();
    const pre = (location.state && location.state.from && location.state.from.pathname) || sessionStorage.getItem('preLoginPath') || '/';
    navigate(pre);
    toast.success("Login successful!");

  } catch (err) {
    console.error(err);
    toast.error("Login failed: " + err.message);
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




  

  return (
    <>
      <div className="kcl-page">
        <Card large className="kcl-card">
          <img className="kcl-mark" src={mark} alt="3Speak" />
          <h1 className="kcl-title">{t('common.actions.login')}</h1>

          <label className="kcl-handle">
            <span aria-hidden="true">@</span>
            <input
              type="text"
              placeholder={t('modals.addAccount.usernamePlaceholder')}
              aria-label={t('modals.addAccount.usernamePlaceholder')}
              autoCapitalize="off"
              spellCheck={false}
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase())}
            />
          </label>

          <div className="v2-choices is-grid kcl-wallets">
            {hasKeychain && <ChoiceCard role="button" icon="extension" title="Keychain" onClick={logMe} />}
            <ChoiceCard role="button" icon="qr_code_2" title="HiveAuth" onClick={handleLoginWithHiveAuth} />
          </div>

          <Button
            variant="ghost"
            size={32}
            icon="mail"
            className="kcl-email"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              window.open(`${FEED_URL}`, "_blank", "noopener,noreferrer");
            }}
          >
            Login with email
          </Button>

          {accountList.length > 0 && (
            <div className="kcl-accounts">
              <Eyebrow>{t('auth.loginModal.switchTo')}</Eyebrow>
              <div className="kcl-accounts__list">
                {accountList.map((list, idx) => (
                  <span key={idx} className="kcl-account">
                    <Chip onClick={() => handleSwitchAccount(list.username)}>
                      <img src={`/img/u/${list.username}/avatar/small`} alt="" />
                      <span>{list.username}</span>
                    </Chip>
                    <IconButton
                      icon="close"
                      size={32}
                      variant="ghost"
                      round
                      label={t('auth.loginModal.forgetAccount')}
                      onClick={(e) => handleClearAccount(e, list.username)}
                    />
                  </span>
                ))}
              </div>
            </div>
          )}
        </Card>
      </div>
      { qrCode && showModal && <QrCode_modal qrCode={qrCode} openKeychainApp={openKeychainApp} onClose={() => setShowModal(false)} />}
    </>
  );
}

export default KeyChainLogin;
