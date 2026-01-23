import  { useEffect, useState } from "react"
import keychainLogo from "../../../public/images/keychain.png"
import { generatePassword, getPrivateKeys, genCommuninityName, } from "../../hive-api/api";
import { createHiveCommunity, getCommunity,  } from "../../hive-api/api";
import {createHiveCommunityKY} from "../../hive-api/test_api"
import { useAppStore } from '../../lib/store';
// import Loader from "../components/loader/Loader";
import "./CreateCommunity.scss"
import { MdOutlineContentCopy } from "react-icons/md";
import { FaDownload } from "react-icons/fa";
import gif from "../../../public/images/icons8-success.gif"
import {  toast } from 'sonner'

const CreateCommunity = ({ isOpen, close}) => {

  const [communityTitle, setCommunityTitle] = useState("");
  const [aboutCommunity, setAboutCommunity] = useState("");
  const [message, setMessage] = useState("");
  const [step, setStep] = useState(1);
  const [error, setError] = useState(false);
  const [communityName, setCommunityName] = useState("");
  const [communityPassword, setCommunityPassword] = useState("");
  const [communityKeys, setCommunityKeys] = useState({});
  const [isDownloaded, setIsDownloaded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedKey, setSelectedKey] = useState("");
  const [check, setCheck] = useState("")

  const { user } = useAppStore();

  const namePattern = "^hive-[1]\\d{4,6}$";

  const minRows = 2;
  const maxRows = 8;

  const usernamee = communityName === "" ? genCommuninityName() : communityName;

  useEffect(() => {
    setCommunityName(usernamee);
    if (step === 2) {
      checkCommunity();
      handleInfo();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, communityName]);

  const handleInfo = async () => {
    try {
      const password = await generatePassword(32);
      setCommunityPassword(password);
      const keys = getPrivateKeys(communityName, password);
      setCommunityKeys(keys);
    } catch (error) {
      toast.error("Failed to generate community info");
    }
  };

  const handleCommuntiyInfo = () => {
    if (!aboutCommunity || !communityTitle) {
      setError("Please fill in the required fields");
      toast.error("Please fill in the required fields");
      return;
    }
    setStep(2);
  };

  const handleCreateCommuntiyWithKey = async () => {
    if (!aboutCommunity || !communityTitle) {
      setError("Please fill in the required fields");
      toast.error("Please fill in the required fields");
      return;
    }

    setIsLoading(true);
    try {
      const response = await createHiveCommunityKY(user, communityName, communityKeys, selectedKey);
      if (response.success) {
        setError("");
        setStep(4);
        toast.success("Community created successfully!");
      } else {
        setStep(4);
        setError(response.message);
        toast.error(`Failed to create community: ${response.message}`);
      }
    } catch (error) {
      setStep(4);
      setError(error.message || "An error occurred");
      toast.error(`Error: ${error.message || "An error occurred"}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAboutChange = (event) => {
    const textareaLineHeight = 24;
    const previousRows = event.target.rows;
    event.target.rows = minRows;

    const currentRows = Math.floor(event.target.scrollHeight / textareaLineHeight);

    if (currentRows === previousRows) {
      event.target.rows = currentRows;
    }

    if (currentRows >= maxRows) {
      event.target.rows = maxRows;
      event.target.scrollTop = event.target.scrollHeight;
    }

    setAboutCommunity(event.target.value);
  };

  const createCommunityKc = async () => {
    setIsLoading(true);
    if (!isDownloaded) {
      setIsLoading(false);
      toast.error("Please download your keys before proceeding");
      return;
    }

    try {
      const response = await createHiveCommunity(user, communityName, communityKeys);
      if (response.success === true) {
        setError("");
        setStep(4);
        toast.success("Community created successfully!");
        setIsLoading(false);
      }
    } catch (error) {
      if (error.success === false) {
        setStep(4);
        setIsLoading(false);
        setError(error.message);
        toast.error(`Error: ${error.message}`);
      }
    }
  };

  const checkCommunity = async () => {
    setIsLoading(true);
    const communityNameRegex = new RegExp(namePattern);

    if (communityNameRegex.test(communityName)) {
      getCommunity(communityName).then((r) => {
        if (r) {
          // setError("Name not available");
          // setMessage("");
          // toast.error("Community name not available");
          setCheck("Name not available")
        } else {
          setError("");
          setMessage("Available");
          setCheck("Available")
          setIsDownloaded(false);
          // toast.success("Community name is available");
        }
      });
    } else {
      // setError("Name not valid");
      setCheck("Name not available")
      // setMessage("");
      // toast.error("Community name not valid");
    }
    setIsLoading(false);
  };

  const copyToClipboard = (text) => {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand("copy");
    document.body.removeChild(textArea);
    toast.info("Password copied to clipboard");
  };

  const downloadKeys = async () => {
    setIsDownloaded(false);
    const element = document.createElement("a");
    const keysToFile = `
      Please handle your password & private keys with extra caution. 
      Your account will no longer be accessible if you lose your password. 
      We do not keep a copy of it, it is confidential only you have access to it.
  
      We recommend that:
      1. You PRINT this file out and store it securely.
      2. You SHOULD NEVER use your password/owner key unless it's required.
      3. Save all your keys within a password manager, as you will need them frequently.
      4. Don't keep this file within the reach of a third party.
      
      Your Hive Account Information:
          Username: ${communityName}
          Password: ${communityPassword}
          Owner private key: ${communityKeys.owner}
          Active private key: ${communityKeys.active}
          Posting-private key: ${communityKeys.posting}
          Memo private key: ${communityKeys.memo}
  
          What your keys can be used for:
          Owner key: Change Password, Change Keys, Recover Account  
          Active key: Transfer Funds, Power up/down, Voting Witnesses/Proposals  
          Posting key: Post, Comment, Vote, Reblog, Follow, Profile 
          Memo key: Send/View encrypted messages on transfers
      `;

    const file = new Blob([keysToFile.replace(/\n/g, "\r\n")], {
      type: "text/plain",
    });
    element.href = URL.createObjectURL(file);
    element.download = `${communityName}_hive_keys.txt`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
    setIsDownloaded(true);
    toast.success("Keys downloaded successfully. Please store them securely.");
  };
 

  return (
    <div className={`modal ${isOpen ? "open" : ""}`}>
      <div className="overlay" onClick={close}></div>
      <div
        className={`modal-content video-upload-moadal-size create-com ${
          isOpen ? "open" : ""
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          {/* <h2>Create Hive Community</h2> */}
          <button className="close-btn" onClick={close}>
            &times;
          </button>
        </div>
          <div className="create-community-container">
            {/* {isLoading && <div>Loading</div>} */}

            
            {/* {message && step === 2 && (
              <span className="success-message">{message}</span>
            )} */}
            {step === 1 && (
              <div className="first-step-container">
                <h1>Create a community</h1>
                <ul>
                  <li>True Ownership, Endless Possibilities</li>
                  <li>Decentralized, Transparent, Rewarding</li>
                  <li>Powered by Hive Blockchain </li>
                </ul>
                
                <div className="form-wrapper">
                  <input type="text"  value={communityTitle} placeholder="Title"onChange={(e) => setCommunityTitle(e.target.value)}  />
                  <textarea
                    rows={minRows}
                    value={aboutCommunity}
                    onChange={handleAboutChange}
                    placeholder="About"
                    type="text"
                  />
                  <button onClick={() => handleCommuntiyInfo()}>
                    Continue
                  </button>
                </div>
              </div>
            )}
            {step === 2 && (
              < div className="second-step-container">
                <div className="Creator-info">
                  <label>Creator</label>
                  <div className="wrap"> <img src={`https://images.hive.blog/u/${user}/avatar`} alt="" /><span> @{user}</span></div>
                  {/* <span>Creation fee: 3 HIve</span> */}
                </div>
                <div className="fee-info">
                  <label>Creation fee</label>
                  <span>Creation fee: 3 HIve</span>
                </div>
                <div className="form-wrapper">

                    <div className="community-input">
                        <label>Community username</label>
                      <input
                        type="text"
                        value={communityName}
                        onChange={(e) => setCommunityName(e.target.value)}
                      />
                        {check && step === 2 && (<span style={{ color: check === "Available" ? "green" : "red" }}>{check}</span>)}                 </div>
                    {/* <span className="warning">
                      Make sure you copy and save you password securely before
                      you proceed.{" "}
                    </span> */}
                    <div className="password-input">
                    <label>Community password</label>
                      <div className="wrap">
                      <input type="text" value={communityPassword} readOnly />
                      <span><MdOutlineContentCopy onClick={() => copyToClipboard(communityPassword)} /></span>
                      </div>
                      <div className="caution-wrap">
                      <img src="https://img.icons8.com/?size=100&id=dF5jn1JKszyE&format=png&color=000000" alt="" />
                      <span>Copy and download your password securely before proceeding.</span> 
                      </div>
                    </div>
                    <button
                      disabled={error}
                      style={{ cursor: error ? "not-allowed" : "pointer" }}
                      className="download-keys"
                      onClick={downloadKeys}
                    >
                      Download keys <FaDownload />
                    </button>
                    <button
                      style={{
                        cursor: !isDownloaded ? "not-allowed" : "pointer",
                        backgroundColor: !isDownloaded ? "lightblue" : "blue",
                      }}
                      disabled={!isDownloaded}
                      onClick={() => setStep(3)}
                    >
                      Continue
                    </button>
                </div>
              </div>
            )}
            {step === 3 && (
              <div className="three-step-container">
                <div className="step-info">
                  <span className="info">Choose sign method</span>
                </div>
                <div className="form-wrapper">
                    <div className="wrap">
                    <input
                      type="text"
                      placeholder="Enter your Owner or Active Key"
                      value={selectedKey}
                      onChange={(e) => setSelectedKey(e.target.value)}
                    />
                    <span onClick={() => handleCreateCommuntiyWithKey()}>Sign</span>
                    </div>
                    <div className="or-wrap">
                        <div className="or-divider">
                         <span>or</span>
                       </div>
                    </div>
                    <img
                      style={{
                        cursor: !isDownloaded ? "not-allowed" : "pointer",
                      }}
                      disabled={!isDownloaded}
                      className="keychain-img"
                      src={keychainLogo}
                      alt=""
                      onClick={() => {
                        createCommunityKc();
                      }}
                    />
                </div>
              </div>
            )}
            {step === 4 && !error && (
                <div className="community-success">
                  <div className="succes-top">
                    <img src={gif} alt="" />
                    <h2>Congratulations</h2>
                    <h3>
                      You have successfully created community {communityName}
                    </h3>
                  </div>
                  <a className="breakaway" href="https://breakaway.community/docker-setup" target="_blank" rel="noopener noreferrer" >
                    <button>Setup your breakaway platform</button>
                  </a>
                </div>
            )}
            {step === 4 && error && (
                <div className="community-success">
                  <div className="succes-top">
                    <h2>Failed❌</h2>
                    <h3>Failed to create community</h3>
                  </div>
                    <button  className="try-btn"
                      onClick={() => {
                        setStep(1);
                      }}
                    >
                      Try again
                    </button>
                </div>
            )}
          </div>
      </div>
    </div>
  );
}

export default CreateCommunity;