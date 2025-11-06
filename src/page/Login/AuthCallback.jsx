import React, { useEffect, useRef, useState } from "react";
import { jwtDecode } from "jwt-decode";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import axios from "axios";
import { useAppStore } from "../../lib/store";
import { Helix} from 'ldrs/react';
import 'ldrs/react/Helix.css'
import {
  LOCAL_STORAGE_ACCESS_TOKEN_KEY,
  LOCAL_STORAGE_USER_ID_KEY,
} from "../../hooks/localStorageKeys";

const AuthCallback = () => {
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
          toast.error("Invalid token: missing user ID.");
          return;
        }

        const res = await axios.get(`http://144.48.107.2:3005/gethive/${userID}`);
        const userData = res.data;

        localStorage.setItem(LOCAL_STORAGE_ACCESS_TOKEN_KEY, accessToken);
        localStorage.setItem(LOCAL_STORAGE_USER_ID_KEY, userData);

        initializeAuth();
        toast.success("Login successful!");
        navigate("/");
      } catch (error) {
        console.error("Authentication failed:", error);
        toast.error("Authentication failed. Please try again.");
      }
    };

    handleAuth();
  }, [navigate, initializeAuth]);

  return (
    <div
  style={{
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "center",
    height: "87vh",
  }}
>
 <h2 style={{
    marginBottom: "20px",
    color: "red"
  }}>Processing login</h2>
  <Helix size="100" speed="2.5" color="red" />
</div>

  );
};

export default AuthCallback;




