import React, { useEffect, useRef, useState } from "react";
import { jwtDecode } from "jwt-decode";
import { useNavigate } from "react-router-dom";
import { toastIn } from '../../utils/toast';
import axios from "axios";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../lib/store";
import { Icon } from "../../components/v2/ui";
import mark from "../../assets/image/3S_mark.svg";
import "./Callback.scss";
import {
  LOCAL_STORAGE_ACCESS_TOKEN_KEY,
  LOCAL_STORAGE_USER_ID_KEY,
} from "../../hooks/localStorageKeys";

// Every toast from this module is headed "Sign in"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Sign in');

const AuthCallback = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { initializeAuth } = useAppStore();
  const hasRun = useRef(false); // ✅ persist between renders
  // 19j steps: checking the account, then loading the feed.
  const [verified, setVerified] = useState(false);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setSlow(true), 12000);
    return () => clearTimeout(id);
  }, []);

  useEffect(() => {
    const handleAuth = async () => {
      if (hasRun.current) return; // ✅ prevent multiple runs
      hasRun.current = true;

      const urlParams = new URLSearchParams(window.location.search);
      const accessToken = urlParams.get("access_token");

      if (!accessToken) return;

      try {
        const decoded = jwtDecode(accessToken);
        const userID = decoded?.user_id;
        if (!userID) {
          toast.error(t('auth.callback.invalidToken'));
          return;
        }

        const res = await axios.get(`http://144.48.107.2:3005/gethive/${userID}`);
        const userData = res.data;
        setVerified(true);

        localStorage.setItem(LOCAL_STORAGE_ACCESS_TOKEN_KEY, accessToken);
        localStorage.setItem(LOCAL_STORAGE_USER_ID_KEY, userData);

        initializeAuth();
        toast.success(t('auth.callback.loginSuccess'));
        navigate("/");
      } catch (error) {
        console.error("Authentication failed:", error);
        toast.error(t('auth.callback.authFailed'));
      }
    };

    handleAuth();
  }, [navigate, initializeAuth, t]);

  // 19j: same look as the Butter Auth callback: the mark at the top, then the
  // status line and the steps as cards at the bottom.
  return (
    <div className="signin-cb">
      <div className="signin-cb__box" role="status" aria-live="polite">
        <img className="signin-cb__mark" src={mark} alt="3Speak" />
        <h1 className="signin-cb__title">{t('auth.manteCallback.signingIn')}</h1>
        <ol className="signin-cb__steps">
          <li className={`signin-cb__card${verified ? ' is-done' : ' is-now'}`}>
            <Icon name={verified ? 'check_circle' : 'progress_activity'} size={24} className={verified ? undefined : 'v2-spin'} />
            <span>{t('auth.manteCallback.steps.verified')}</span>
          </li>
          <li className={`signin-cb__card${verified ? ' is-now' : ' is-next'}`}>
            <Icon name={verified ? 'progress_activity' : 'radio_button_unchecked'} size={24} className={verified ? 'v2-spin' : undefined} />
            <span>{t('auth.manteCallback.steps.loading')}</span>
          </li>
        </ol>
        {slow && (
          <p className="signin-cb__slow">
            {t('auth.manteCallback.tooLong')}{' '}
            <button type="button" className="signin-cb__retry" onClick={() => navigate('/')}>{t('common.actions.tryAgain')}</button>
          </p>
        )}
      </div>
    </div>
  );
};

export default AuthCallback;




