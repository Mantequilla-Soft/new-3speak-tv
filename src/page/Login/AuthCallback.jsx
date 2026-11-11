import React, { useEffect, useRef } from "react";
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

  // 19j: same look as the Butter Auth callback.
  return (
    <div className="signin-cb">
      <div className="signin-cb__box" role="status" aria-live="polite">
        <img className="signin-cb__mark" src={mark} alt="3Speak" />
        <Icon name="progress_activity" size={28} className="v2-spin signin-cb__spin" />
        <h1 className="signin-cb__title">{t('auth.callback.processing')}</h1>
      </div>
    </div>
  );
};

export default AuthCallback;




