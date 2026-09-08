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
import { toastIn } from '../../utils/toast';
import {QRCodeSVG} from 'qrcode.react';
import HAS from 'hive-auth-wrapper'

// Every toast from this module is headed "Sign in"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Sign in');

const APP_META = {
  name: "3speak",
  description: "3Speak video platform",
  icon: undefined
};

function TestingLogin3() {
  const client = axios.create({});
  const { initializeAuth, switchAccount, clearAccount } = useAppStore();
  const studioEndPoint = "https://studio.3speak.tv";
  const [username, setUsername] = useState('');
  const [accountList, setAccountList] = useState([]);
  const [qrUrl, setQrUrl] = useState('');
  const [isWaitingHiveAuth, setIsWaitingHiveAuth] = useState(false);
  // const [decodedMessage, setDecodedMessage] = useState("")
  const navigate = useNavigate();

  useEffect(() => {
    const getAccountlist = JSON.parse(localStorage.getItem("accountsList")) || [];
    setAccountList(getAccountlist);
  }, []);

  async function logMe() {
    if (!username) {
      toast.error("Username is required to proceed.");
      return;
    }

    try {
      const response = await client.get(
        `${studioEndPoint}/mobile/login?username=${username}`,
        {
          withCredentials: false,
          headers: { "Content-Type": "application/json" },
        }
      );

      const memo = response.data.memo;
      if (!window.hive_keychain) {
        toast.error("Hive Keychain extension not found!");
        return;
      }

      window.hive_keychain.requestVerifyKey(
        username,
        memo,
        "Posting",
        (response) => {
          if (response.success) {
            const decodedMessage = response.result.replace("#", "");
            localStorage.setItem(LOCAL_STORAGE_ACCESS_TOKEN_KEY, decodedMessage);
            localStorage.setItem(LOCAL_STORAGE_USER_ID_KEY, username);
            initializeAuth();
            navigate("/");
          } else {
            toast.error("Verification failed: " + response.message);
          }
        }
      );
    } catch (err) {
      console.error(err);
      toast.error("Login failed: " + err.message);
    }
  }

//   const handleLoginWithHiveAuth = async () => {
//   if (!username) {
//     toast.error("Username is required to proceed.");
//     return;
//   }

//   setIsWaitingHiveAuth(true);
//   setQrUrl('');
//   let proof = Math.floor(new Date().getTime() / 1000);

//   try {
//     // const { default: HAS } = await import('hive-auth-wrapper');

//     let res = await client.get(
//           `${studioEndPoint}/mobile/login?username=${username}`,
//           {
//             withCredentials: false,
//             headers: {
//               "Content-Type": "application/json",
//             },
//           }
//         );
//         console.log(res)
//         const memo = res.data.memo;
        

//     // ✅ Set HiveAuth server host here
//     HAS.setOptions({
//       host: "wss://hive-auth.arcange.eu",
//       // auth_key_secret : memo
//     });

//     const auth = { username };
//     const challenge_data = {
//       key_type: "posting",
//       challenge: JSON.stringify({
//         login: username,
//         ts: Date.now(),
//       })
//     };

//     const status = HAS.status()
//     console.log(status)

//     const result = await HAS.authenticate(
//       auth,
//       APP_META,
//       challenge_data,
//       (evt) => {
//         console.log("Auth Event:", evt);
//         if (evt.uuid && evt.key && evt.account) {
//           const auth_payload = {
//                 account: username, 
//                 uuid: evt.uuid,
//                 key: evt.key,
//                 host: "wss://hive-auth.arcange.eu"
//               }
//               const auth_payload_base64 = btoa(JSON.stringify(auth_payload))
//               const HASUrl = "has://auth_req/" + auth_payload_base64
//           setQrUrl(HASUrl);
//         }
//       }
//     );
//     console.log("HiveAuth result:", result);
//     // let decodedData = result.pok.replace("#", "");


//     const data = {
//       challenge: result.data.challenge.challenge,
//       proof: proof,
//       publicKey: result.data.challenge.pubkey,
//       username: username,
//     }

//     console.log(data)

//     const response = await axios.post(
//       'https://studio.3speak.tv/mobile/login',
//       data,
//       {
//         headers: {
//           'Content-Type': 'application/json',
//         },
//       }
//     );


//       console.log('Login Success:', response.data);
//       const decodedMessage = response.data.token;
//               localStorage.setItem(LOCAL_STORAGE_ACCESS_TOKEN_KEY, decodedMessage);
//               localStorage.setItem(LOCAL_STORAGE_USER_ID_KEY, username);
//               initializeAuth();
//               navigate("/");
//               toast.success("Login successful!");

//   } catch (err) {
//   console.error(
//      'Login error details:', 
//      err.message
//     //  err.response?.status, 
//     //  err.response?.data
//   );
//   toast.error("Login failed: " + (err.response?.data?.error || err.message));
// } finally {
//     setIsWaitingHiveAuth(false);
//   }
// };

  const handleLoginWithHiveAuth = async () => {
    if (!username) {
      toast.error("Username is required to proceed.");
      return;
    }

    setIsWaitingHiveAuth(true);
    setQrUrl('');

    try {
      // ✅ Step 1: Get the initial challenge from 3Speak's backend
      const challengeResponse = await axios.get(
        `${studioEndPoint}/mobile/login?username=${username}`,
        {
          withCredentials: false,
          headers: { "Content-Type": "application/json" },
        }
      );
      const memo = challengeResponse.data.memo;

      // ✅ Step 2: Set up HiveAuth
      HAS.setOptions({
        host: "wss://hive-auth.arcange.eu",
      });

      const auth = { username };
      const challenge_data = {
        key_type: "posting",
        challenge: JSON.stringify({
          login: username,
          ts: Date.now(),
        }),
      };

      // ✅ Step 3: Authenticate with HiveAuth
      const result = await HAS.authenticate(
        auth,
        APP_META,
        challenge_data,
        (evt) => {
          if (evt.uuid && evt.key && evt.account) {
            const auth_payload = {
              account: username,
              uuid: evt.uuid,
              key: evt.key,
              host: "wss://hive-auth.arcange.eu",
            };
            const auth_payload_base64 = btoa(JSON.stringify(auth_payload));
            const HASUrl = "has://auth_req/" + auth_payload_base64;
            setQrUrl(HASUrl);
          }
        }
      );

      // ✅ Step 4: Send the challenge back to 3Speak's backend to get the token
      const data = {
        challenge: result.data.challenge.challenge,
        proof: Math.floor(Date.now() / 1000), // Current timestamp
        publicKey: result.data.challenge.pubkey,
        username: username,
      }

      console.log(data)
      const loginResponse = await axios.post(
        `${studioEndPoint}/mobile/login`, data,
        {
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      // ✅ Step 5: Extract the token and store it
      const token = loginResponse.data.token;
      if (!token) {
        throw new Error("No token received from 3Speak backend");
      }

      localStorage.setItem(LOCAL_STORAGE_ACCESS_TOKEN_KEY, token);
      localStorage.setItem(LOCAL_STORAGE_USER_ID_KEY, username);
      initializeAuth();
      navigate("/");
      toast.success("Login successful!");

    } catch (err) {
      console.error("Login error:", err);
      toast.error("Login failed: " + (err.response?.data?.error || err.message));
    } finally {
      setIsWaitingHiveAuth(false);
    }
  };

  const handleSwitchAccount = (user) => {
    switchAccount(user);
    navigate("/");
  };

  const removeAccount = (user) => {
    clearAccount(user);
    const refreshed = JSON.parse(localStorage.getItem("accountsList")) || [];
    setAccountList(refreshed);
  };

  return (
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
            <div className="wrap keychain-down" onClick={logMe}>
              <img src={keychainImg} alt="keychain" />
              <span>Keychain</span>
            </div>
            <div className="wrap keychain-down" onClick={handleLoginWithHiveAuth}>
              <img src={hiveauthImg} alt="HiveAuth" />
              <span>HiveAuth</span>
            </div>
          </div>

          <div className="wrap-signup keychain-space">
            <span>Don't have an account?</span>
            <span className="last">Sign up now!</span>
          </div>

          {accountList.length > 0 && (
            <div className="switch-acct-wrapper">
              <h3>Login As</h3>
              <div className="list-acct-wrap">
                {accountList.map((list, idx) => (
                  <div key={idx} className='wrap' onClick={() => handleSwitchAccount(list.username)}>
                    <img src={`https://images.hive.blog/u/${list.username}/avatar/small`} alt={list.username} />
                    <span>{list.username}</span>
                    <LuLogOut size={12} onClick={(e) => { e.stopPropagation(); removeAccount(list.username); }} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {qrUrl && (
        <div className="qr-section">
          <h4>Scan with HiveAuth Mobile</h4>
          <QRCodeSVG value={qrUrl} size={200} />
          {isWaitingHiveAuth && <p>Waiting for confirmation...</p>}
          <button className="cancel-btn" onClick={() => setIsWaitingHiveAuth(false)}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

export default TestingLogin3;
