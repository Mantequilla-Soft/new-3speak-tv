import  { useEffect, useRef, useState } from "react"
import { generatePassword, getPrivateKeys, genCommuninityName, genBadgeName, accountExists, finalizeNewAccount, createHiveCommunityWithKeychain, createHiveCommunityKY } from "../../hive-api/api";
import { uploadThumbnail } from "../../utils/uploadThumbnail";
import { Camera, Loader2, TriangleAlert } from "lucide-react";
import { createHiveCommunity, getCommunity,  } from "../../hive-api/api";
import { Providers, getCurrentProvider } from '../../hive-api/aioha';
import { Link } from "react-router-dom";
import { rememberCreatedBadge, indexNewCommunity } from '../../utils/badgeAwards';
import { useAppStore } from '../../lib/store';
// import Loader from "../components/loader/Loader";
import "./CreateCommunity.scss"
import { MdOutlineContentCopy } from "react-icons/md";
import { FaDownload, FaCheck } from "react-icons/fa";
import { toastIn } from '../../utils/toast';

// Every toast from this module is headed "Community"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Community');


// The wallets that can sign an ACTIVE-key operation. HiveSigner is deliberately
// absent: its OAuth grant covers posting only, so it cannot create an account.
const SIGN_PROVIDERS = [
  { id: Providers.Keychain, label: 'Hive Keychain' },
  { id: Providers.HiveAuth, label: 'HiveAuth' },
  { id: Providers.PeakVault, label: 'Peak Vault' },
  { id: Providers.Ledger, label: 'Ledger' },
];

const CreateCommunity = ({ isOpen, close, kind = 'community'}) => {
  // Everything below is shared. A badge IS a Hive account created the same way,
  // for the same 3 HIVE, with the same generated keys -- only its name follows
  // `badge-<digits>` instead of `hive-1<digits>`, and it is not registered as a
  // community afterwards. Duplicating 400 lines to change a prefix and a noun
  // would have been two flows to keep in step.
  const isBadge = kind === 'badge';
  const noun = isBadge ? 'badge' : 'community';
  const Noun = isBadge ? 'Badge' : 'Community';

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
  // The profile the new account will wear. Collected here because this is the
  // only moment we hold its keys: setting it later would mean digging the
  // generated password back out.
  const [bio, setBio] = useState("");
  const [avatar, setAvatar] = useState("");
  const [banner, setBanner] = useState("");
  const [uploading, setUploading] = useState("");
  const avatarInput = useRef(null);
  const bannerInput = useRef(null);

  const { user } = useAppStore();

  const namePattern = isBadge ? "^badge-\\d{4,6}$" : "^hive-[1]\\d{4,6}$";

  const usernamee = communityName === "" ? (isBadge ? genBadgeName() : genCommuninityName()) : communityName;

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

  // preferStatic: signed by @threespeak server-side, so this works for a
  // delegated login with no local key, exactly as in the profile editor.
  const pickImage = (which) => async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image file");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      toast.error("That image is over 8MB, please pick a smaller one");
      return;
    }
    setUploading(which);
    try {
      const url = await uploadThumbnail(file, user, { preferStatic: true });
      if (which === "avatar") setAvatar(url); else setBanner(url);
    } catch (err) {
      toast.error(err?.message || "Could not upload that image");
    } finally {
      setUploading("");
    }
  };

  // Everything the form collected, written to the account we just made. See
  // finalizeNewAccount: without it the form is decorative.
  const applyProfile = async () => {
    try {
      await finalizeNewAccount(communityName, communityKeys, {
        profile: {
          name: communityTitle,
          about: aboutCommunity,
          ...(avatar ? { profile_image: avatar } : {}),
          ...(banner ? { cover_image: banner } : {}),
        },
        // Only a community has props in hivemind. A badge is a plain account.
        community: isBadge ? null : {
          title: communityTitle,
          about: aboutCommunity,
          ...(bio ? { description: bio } : {}),
        },
      });
    } catch (err) {
      // The account exists and is paid for; only its decoration failed.
      console.error("Could not write the new account's profile:", err);
      toast.error(`Created, but the ${noun} profile could not be saved. You can set it later.`);
    }
  };

  // Name, description and picture are all required. The picture especially:
  // this account is about to exist forever, and a directory full of blank
  // circles is what happens when it is optional at the one moment somebody is
  // actually thinking about how it should look.
  const missingFields = () => {
    const missing = [];
    if (!communityTitle.trim()) missing.push('a name');
    if (!aboutCommunity.trim()) missing.push('a description');
    if (!avatar) missing.push('a picture');
    return missing;
  };

  const handleCommuntiyInfo = () => {
    const missing = missingFields();
    if (missing.length) {
      const list = missing.length === 1
        ? missing[0]
        : `${missing.slice(0, -1).join(', ')} and ${missing[missing.length - 1]}`;
      setError(`Please add ${list}`);
      toast.error(`Please add ${list}`);
      return;
    }
    setError("");
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
        await applyProfile();
        setStep(4);
        toast.success(`${Noun} created successfully!`);
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

  // Which wallet is signed in right now, so the list can say so instead of
  // making them guess which one will actually open.
  const currentProvider = getCurrentProvider();
  // Keychain can sign a one-off transaction through its extension without any
  // app login, so it is offered whenever the extension is present.
  const hasKeychain = typeof window !== 'undefined' && !!window.hive_keychain;
  const canSignWith = (id) => id === currentProvider
    || (id === Providers.Keychain && hasKeychain);

  /**
   * Sign with a chosen wallet. NEVER logs in.
   *
   * This screen's whole job is one signature. An earlier version called
   * aioha.login() for a wallet that was not the current one, which swapped the
   * user's identity mid-flow -- a ButrAuth session became a wallet session, and
   * the app then reported both at once. Signing and signing IN are different
   * things and only the first was asked for.
   *
   * So: the wallet already signed in signs through aioha, Keychain signs
   * directly through its extension whether or not it is signed in, and anything
   * else is offered as unavailable rather than quietly becoming a login.
   */
  const signWithProvider = async (provider) => {
    if (!isDownloaded) {
      toast.error("Please download your keys before proceeding");
      return;
    }
    if (currentProvider === provider) {
      await createCommunityKc();
      return;
    }
    if (provider === Providers.Keychain && hasKeychain) {
      setIsLoading(true);
      try {
        const response = await createHiveCommunityWithKeychain(user, communityName, communityKeys);
        if (response?.success === true) {
          setError("");
          await applyProfile();
          // Note it locally so the award picker can offer it: Hive has no
          // reverse index from a badge to whoever holds authority over it.
          if (isBadge) rememberCreatedBadge(user, communityName);
          else indexNewCommunity(communityName);
          setStep(4);
          toast.success(`${Noun} created successfully!`);
        }
      } catch (err) {
        toast.error(err?.message || "Could not sign with Keychain");
      } finally {
        setIsLoading(false);
      }
      return;
    }
    toast.error(`Sign in with ${provider} first, or paste your key below.`);
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
        await applyProfile();
        if (isBadge) rememberCreatedBadge(user, communityName);
        else indexNewCommunity(communityName);
        setStep(4);
        toast.success(`${Noun} created successfully!`);
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
      const lookup = isBadge ? accountExists(communityName) : getCommunity(communityName);
      lookup.then((r) => {
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
          {/* <h2>{`Create Hive ${Noun}`}</h2> */}
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
              <div className="cc-step">
                <header className="cc-head">
                  <h2>{`Create a ${noun}`}</h2>
                  <p>
                    {isBadge
                      ? 'A badge is a Hive account you award to people. Give it a look and a name now, while you hold its keys.'
                      : 'A community is a Hive account other people can join. Give it a look and a name now, while you hold its keys.'}
                  </p>
                </header>

                {/* Banner first: it is the biggest thing on the finished page,
                    so it reads as the headline choice rather than an
                    afterthought under the text fields. */}
                <button
                  type="button"
                  className="cc-banner"
                  style={banner ? { backgroundImage: `url(${banner})` } : undefined}
                  onClick={() => bannerInput.current?.click()}
                  disabled={!!uploading}
                >
                  <span className="cc-banner-action">
                    {uploading === 'banner' ? <Loader2 size={15} className="cc-spin" /> : <Camera size={15} />}
                    {banner ? 'Change banner' : 'Add a banner'}
                  </span>
                </button>
                <input ref={bannerInput} type="file" accept="image/*" onChange={pickImage('banner')} hidden />

                <div className="cc-avatar-row">
                  <button
                    type="button"
                    className="cc-avatar"
                    onClick={() => avatarInput.current?.click()}
                    disabled={!!uploading}
                    aria-label="Upload a picture"
                  >
                    {avatar ? <img src={avatar} alt="" /> : null}
                    <span className="cc-avatar-badge">
                      {uploading === 'avatar' ? <Loader2 size={14} className="cc-spin" /> : <Camera size={14} />}
                    </span>
                  </button>
                  <div className="cc-avatar-text">
                    <strong>Picture</strong>
                    <span>Square, 400 x 400 px or larger. Up to 8MB.</span>
                  </div>
                  <input ref={avatarInput} type="file" accept="image/*" onChange={pickImage('avatar')} hidden />
                </div>

                <label className="cc-field">
                  <span className="cc-label">Name</span>
                  <input
                    type="text"
                    value={communityTitle}
                    maxLength={32}
                    placeholder={isBadge ? 'Early Supporter' : 'Creators Corner'}
                    onChange={(e) => setCommunityTitle(e.target.value)}
                  />
                </label>

                <label className="cc-field">
                  <span className="cc-label">Description</span>
                  <input
                    type="text"
                    value={aboutCommunity}
                    maxLength={120}
                    placeholder={isBadge ? 'Awarded to people who helped out early' : 'A place to share what you make and talk about it'}
                    onChange={(e) => setAboutCommunity(e.target.value)}
                  />
                  <span className="cc-hint">One line. This is what shows in the directory.</span>
                </label>

                <label className="cc-field">
                  <span className="cc-label">Bio <em>optional</em></span>
                  <textarea
                    rows={4}
                    value={bio}
                    maxLength={1000}
                    placeholder={isBadge
                      ? 'How this badge is earned, and who awards it.'
                      : 'What this community is for, and how people should use it.'}
                    onChange={(e) => setBio(e.target.value)}
                  />
                </label>

                <div className="cc-actions">
                  <button type="button" className="cc-secondary" onClick={close}>Cancel</button>
                  <button
                    type="button"
                    className="cc-primary"
                    onClick={() => handleCommuntiyInfo()}
                    disabled={!!uploading}
                  >
                    Continue
                  </button>
                </div>
              </div>
            )}
            {step === 2 && (
              <div className="cc-step">
                <header className="cc-head">
                  <h2>Save the keys</h2>
                  <p>
                    This password is the only way into the {noun} account. It is shown
                    once and stored nowhere, so download it before you go on.
                  </p>
                </header>

                <div className="cc-meta">
                  <div className="cc-meta-item">
                    <span className="cc-label">Creator</span>
                    <span className="cc-meta-value">
                      <img src={`https://images.hive.blog/u/${user}/avatar/small`} alt="" />
                      @{user}
                    </span>
                  </div>
                  <div className="cc-meta-item">
                    <span className="cc-label">Creation fee</span>
                    <span className="cc-meta-value">3.000 HIVE</span>
                  </div>
                </div>

                <label className="cc-field">
                  <span className="cc-label">{`${Noun} username`}</span>
                  <input
                    type="text"
                    value={communityName}
                    onChange={(e) => setCommunityName(e.target.value)}
                  />
                  {/* A class, not an inline colour: green on #0f0f0f and green on
                      #f9f9f9 are not the same green. */}
                  {check && (
                    <span className={`cc-check${check === 'Available' ? ' is-ok' : ' is-bad'}`}>
                      {check}
                    </span>
                  )}
                </label>

                <div className="cc-field">
                  <span className="cc-label">{`${Noun} password`}</span>
                  <div className="cc-copy-row">
                    <input type="text" value={communityPassword} readOnly />
                    <button
                      type="button"
                      className="cc-copy"
                      onClick={() => copyToClipboard(communityPassword)}
                      aria-label="Copy password"
                      title="Copy password"
                    >
                      <MdOutlineContentCopy size={16} />
                    </button>
                  </div>
                </div>

                {/* Was a remote icons8 PNG, which loaded a black glyph from another
                    origin into a dark panel. An inline icon themes itself. */}
                <div className="cc-warn">
                  <TriangleAlert size={18} aria-hidden="true" />
                  <span>
                    Copy and download this password before continuing. Nobody can
                    recover it for you, not even 3Speak.
                  </span>
                </div>

                <button
                  type="button"
                  className="cc-download"
                  onClick={downloadKeys}
                  disabled={!!error}
                >
                  <FaDownload /> Download keys
                </button>

                <div className="cc-actions">
                  <button type="button" className="cc-secondary" onClick={() => setStep(1)}>
                    Back
                  </button>
                  <button
                    type="button"
                    className="cc-primary"
                    disabled={!isDownloaded}
                    onClick={() => setStep(3)}
                  >
                    Continue
                  </button>
                </div>
              </div>
            )}
            {step === 3 && (
              <div className="cc-step">
                <header className="cc-head">
                  <h2>Sign the creation</h2>
                  <p>
                    Creating the account costs <strong>3.000 HIVE</strong> from @{user} and
                    needs your <strong>active</strong> key. Pick the wallet holding it.
                  </p>
                </header>

                {/* Every wallet aioha can sign an ACTIVE operation with, not just
                    Keychain -- which is all the old screen offered, and was wrong
                    for anyone signed in with something else. HiveSigner is absent
                    on purpose: it authorises posting only, so it can never sign
                    account creation. */}
                <div className="cc-providers">
                  {SIGN_PROVIDERS.map((prov) => (
                    <button
                      type="button"
                      key={prov.id}
                      className={`cc-provider${currentProvider === prov.id ? ' is-current' : ''}`}
                      disabled={isLoading || !isDownloaded || !canSignWith(prov.id)}
                      title={canSignWith(prov.id) ? undefined : `Sign in with ${prov.label} to use it here`}
                      onClick={() => signWithProvider(prov.id)}
                    >
                      <span className="cc-provider-name">{prov.label}</span>
                      {currentProvider === prov.id && (
                        <span className="cc-provider-tag">signed in</span>
                      )}
                      {currentProvider !== prov.id && prov.id === Providers.Keychain && hasKeychain && (
                        <span className="cc-provider-tag">installed</span>
                      )}
                    </button>
                  ))}
                </div>

                <div className="cc-or"><span>or</span></div>

                <label className="cc-field">
                  <span className="cc-label">Paste the active or owner key</span>
                  <div className="cc-copy-row">
                    <input
                      type="password"
                      placeholder="5K…"
                      value={selectedKey}
                      onChange={(e) => setSelectedKey(e.target.value)}
                    />
                    <button
                      type="button"
                      className="cc-primary"
                      disabled={isLoading || !selectedKey.trim()}
                      onClick={() => handleCreateCommuntiyWithKey()}
                    >
                      Sign
                    </button>
                  </div>
                  <span className="cc-hint">
                    Typed here it stays in this browser and is used once, for this
                    transaction. A wallet above is safer.
                  </span>
                </label>

                <div className="cc-actions">
                  <button type="button" className="cc-secondary" onClick={() => setStep(2)}>
                    Back
                  </button>
                </div>
              </div>
            )}
            {step === 4 && !error && (
              <div className="cc-step cc-done">
                <span className="cc-done-icon" aria-hidden="true"><FaCheck /></span>
                {/* `Noun`, not the word "community": this same modal makes badges,
                    and it congratulated people on a community they had not made. */}
                <h2>{`${Noun} created`}</h2>
                <p className="cc-done-name">@{communityName}</p>

                {isBadge ? (
                  <p className="cc-done-text">
                    You hold <strong>posting authority</strong> over this badge, so you can
                    award it to people straight from their profile on 3Speak. No switching
                    accounts, and no keys to dig out.
                  </p>
                ) : (
                  <p className="cc-done-text">
                    You hold <strong>posting authority</strong> over this community, so you
                    can post and moderate in it as yourself, without switching accounts.
                  </p>
                )}

                <p className="cc-done-note">
                  Keep the password you downloaded. It is the only way back in if you ever
                  need the account itself, and nobody can reissue it for you.
                </p>

                <div className="cc-actions">
                  <button type="button" className="cc-secondary" onClick={close}>Close</button>
                  <Link
                    className="cc-primary cc-primary-link"
                    to={isBadge ? `/b/${communityName}` : `/community/${communityName}`}
                    onClick={close}
                  >
                    {isBadge ? 'Open the badge' : 'Open the community'}
                  </Link>
                </div>
              </div>
            )}
            {step === 4 && error && (
              <div className="cc-step cc-done">
                <span className="cc-done-icon is-bad" aria-hidden="true"><TriangleAlert /></span>
                <h2>{`Could not create the ${noun}`}</h2>
                <p className="cc-done-text">
                  Nothing was created and no fee was taken. The keys you downloaded belong
                  to a name that does not exist, so you can discard them.
                </p>
                <div className="cc-actions">
                  <button type="button" className="cc-secondary" onClick={close}>Close</button>
                  <button type="button" className="cc-primary" onClick={() => setStep(1)}>
                    Try again
                  </button>
                </div>
              </div>
            )}
          </div>
      </div>
    </div>
  );
}

export default CreateCommunity;