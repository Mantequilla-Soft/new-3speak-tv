import axios from "axios";
import { api } from "../../utils/api";
import { API_URL_FROM_WEST } from "../../utils/config";
import {persist} from "zustand/middleware"

import aioha, { isLoggedIn as hasLiveSession } from "../../hive-api/aioha";

import { toastIn } from '../../utils/toast';

// Every toast from this module is headed "Sign in"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Sign in');

const LOCAL_STORAGE_USER_ID_KEY = "user_id";

export const createAuthUserSlice = (set) => ({
  authenticated: false,
  userId: null,
  user: null,
  listAccounts: [],
  allowAccess: null,
  userDetails: null,
  // Set true by initializeAuth when it finds a persisted user_id with no live
  // wallet session (expired HiveSigner token etc.). The UI watches this to
  // prompt a re-login. Kept in the store (not component state) so it survives
  // React StrictMode's mount/unmount/remount in dev.
  sessionExpired: false,



  // Initialize the store on app load
  initializeAuth: () => {
    if (typeof window !== "undefined") {
      const aiohaUser = aioha.getCurrentUser();
      const userId = aiohaUser || window.localStorage.getItem(LOCAL_STORAGE_USER_ID_KEY);

      // A persisted user_id with NO live wallet session means the session
      // expired while the app was closed. This is the classic HiveSigner case:
      // aioha.loadAuth() silently drops the OAuth token once expired, but the
      // stale user_id stays in localStorage. Trusting it here is what makes the
      // app look logged-in while every broadcast fails with "Not logged in"
      // (e.g. after a full video upload). Treat it as logged-out instead so the
      // user is prompted to re-authenticate before doing any work.
      // hasLiveSession() is true for an aioha session OR a ManteAuth/ButrAuth
      // login (cookie-based, no aioha state), so those stay logged in.
      if (userId && !hasLiveSession()) {
        window.localStorage.removeItem(LOCAL_STORAGE_USER_ID_KEY);
        window.localStorage.removeItem("access_token");
        set({ authenticated: false, user: null, sessionExpired: true });
        return;
      }

      if (userId) {
        window.localStorage.setItem(LOCAL_STORAGE_USER_ID_KEY, userId);
        set({ authenticated: true, user: userId });
      } else {
        set({ authenticated: false, user: null });
      }
    }
  },

  // Cleared by the UI once it has shown the "session expired" prompt.
  clearSessionExpired: () => set({ sessionExpired: false }),
  

  switchAccount: (username) => {
    const switched = aioha.switchUser(username)
    if (switched) {
    const newUser = aioha.getCurrentUser();
    console.log('Switched to:', newUser);

  } else {
    console.warn('Switch failed. User may not be authenticated.');
  }
    const account = JSON.parse(localStorage.getItem("accountsList")).find(acc => acc.username === username);
    console.log(account)

    if (account) {
      set({ userId: username, user: username, authenticated: true });
      localStorage.setItem("access_token", account.access_token);
      localStorage.setItem("user_id", account.username);
    }
    toast.success(`Switched to ${username} successfully!`)
  },

  // Set user directly without calling aioha.switchUser (for when aioha already switched)
  setUser: (username) => {
    set({ userId: username, user: username, authenticated: true });
  },

  

  LogOut: async (user) => {
    if (typeof window === "undefined") return

    // Always attempt server-side logout — it clears httpOnly cookies
    // (threespeak_session, threespeak_user, manteauth_pkce).
    // Await it so we don't race a subsequent login attempt.
    try {
      await Promise.all([
        fetch('/api/manteauth/logout', { method: 'POST', credentials: 'include' }),
        // Clear the SIWH wallet session cookie too (wallet logins).
        fetch('/api/auth/wallet/logout', { method: 'POST', credentials: 'include' })
      ])
    } catch { /* ignore network errors, still proceed with local cleanup */ }

    // Local cleanup
    try { aioha.logout() } catch {}
    const accounts = JSON.parse(localStorage.getItem("accountsList") || "[]")
    const updatedAccounts = accounts.filter(acc => acc.username !== user)
    localStorage.setItem("accountsList", JSON.stringify(updatedAccounts))
    window.localStorage.removeItem("user_id")
    window.localStorage.removeItem("access_token")
    window.localStorage.removeItem("manteauth_login")
    window.localStorage.removeItem("manteauth_token") // legacy

    set({
      authenticated: false,
      userId: null,
      user: null,
      allowAccess: null,
      userDetails: null,
      listAccounts: [],
      isProcessing: null,
    })
  },


  //The clearAccount delete the user acces-token from the local storage.
  clearAccount: (user) => {

     aioha.removeOtherLogin(user);
    const accounts = JSON.parse(localStorage.getItem("accountsList") || "[]");
    const updatedAccounts = accounts.filter(acc => acc.username !== user);
    localStorage.setItem("accountsList", JSON.stringify(updatedAccounts));

  },

  // Set accounts from localStorage
  // setAccounts: async () => {
  //   const accounts = localStorage.getItem("accountsList");
  //   if (accounts) {
  //     const toAppendAccounts = JSON.parse(accounts);
  //     set({ listAccounts: toAppendAccounts });
  //     console.log("im from setAccounts now", toAppendAccounts);
  //   }
  // },


  // setActiveUser: async () => {
  //   const accounts = localStorage.getItem("user_id");
  //   if (accounts) {
  //     set({ user: accounts });
  //     // console.log("im from setAccounts now", user);
  //   }
  // },


  // ***********************************Code below are not in use **************************************
  // ***********************************Code below are not in use **************************************

  // Check authentication using a token
  checkAuth: async () => {
    const token = localStorage.getItem("access_token");
    if (token) {
      const data = await api.auth.checkAuthentication(token);
      if (data) {
        console.log("checkAuthentication", data);
        set({ allowAccess: data, authenticated: true });
      }
    } else {
      set({ allowAccess: false, authenticated: false });
    }
  },

  // Get user details using a token
  getUserDetails: async () => {
    const token = localStorage.getItem("access_token");
    if (token) {
      const data = await api.auth.getUserDetails(token);
      if (data) {
        const account = { username: data };
        set({ userDetails: account });
      }
    } else {
      set({ userDetails: null });
    }
  },

  // Login using Hive Keychain
  login_with_hive: async (request) => {
    try {
      const keychain = window.hive_keychain;
      console.log("keychain", keychain);

      const proof_payload = {
        account: request.username,
        ts: request.dateNow,
      };

      keychain.requestSignBuffer(
        request.username,
        JSON.stringify(proof_payload),
        "Posting",
        request.callback,
        null,
        "Login using Hive",
        (response) => {
          console.log("response", response);
        }
      );
    } catch (error) {
      console.log({ error });
    }
  },

  // Login with email and password
  login: async (requestBody) => {
    const data = {
      username: requestBody.email,
      password: requestBody.password,
    };

    const response = await axios.post(
      `${API_URL_FROM_WEST}/v1/auth/login`,
      data,
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    console.log("response", response);
    localStorage.setItem("access_token", response.data.access_token);
    set({ authenticated: true, userId: response.data.user_id });
    return response;
  },

  // Register a new user
  register: async (requestBody) => {
    const body = {
      ...requestBody,
      username: requestBody.email,
    };

    const response = await axios.post(
      `${API_URL_FROM_WEST}/v1/auth/register`,
      body,
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    return response;
  },

  
});
