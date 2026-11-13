import  { useEffect, useRef, useState } from "react"
import { generatePassword, getPrivateKeys, genCommuninityName, genBadgeName, accountExists, finalizeNewAccount, createHiveCommunityWithKeychain, createHiveCommunityKY } from "../../hive-api/api";
import { uploadThumbnail } from "../../utils/uploadThumbnail";
import { createHiveCommunity, getCommunity,  } from "../../hive-api/api";
import { Providers, getCurrentProvider } from '../../hive-api/aioha';
import { Link } from "react-router-dom";
import { rememberCreatedBadge, indexNewCommunity } from '../../utils/badgeAwards';
import { useAppStore } from '../../lib/store';
// import Loader from "../components/loader/Loader";
import "./CreateCommunity.scss"
import DialogShell from "./DialogShell";
import { Button, Segmented } from "../v2/ui";
import { Icon } from "../v2/Icon";
import { toastIn } from '../../utils/toast';
import { useTranslation, Trans } from 'react-i18next';
import { getLanguage } from '../../i18n';

// Every toast from this module is headed "Community"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Community');


// The wallets that can sign an ACTIVE-key operation. HiveSigner is deliberately
// absent: its OAuth grant covers posting only, so it cannot create an account.
const SIGN_PROVIDERS = [
  { id: Providers.Keychain, label: 'Hive Keychain', icon: 'extension' },
  { id: Providers.HiveAuth, label: 'HiveAuth', icon: 'qr_code_2' },
  { id: Providers.PeakVault, label: 'Peak Vault', icon: 'key' },
  { id: Providers.Ledger, label: 'Ledger', icon: 'usb' },
];

const CreateCommunity = ({ isOpen, close, kind: initialKind = 'community'}) => {
  // Everything below is shared. A badge IS a Hive account created the same way,
  // for the same 3 HIVE, with the same generated keys -- only its name follows
  // `badge-<digits>` instead of `hive-1<digits>`, and it is not registered as a
  // community afterwards. Duplicating 400 lines to change a prefix and a noun
  // would have been two flows to keep in step.
  const { t } = useTranslation();
  // 40c: the first step can switch between the two (same flow, other noun).
  const [kind, setKind] = useState(initialKind);
  const isBadge = kind === 'badge';

  const [communityTitle, setCommunityTitle] = useState("");
  const [aboutCommunity, setAboutCommunity] = useState("");
  const [, setMessage] = useState("");
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

  // Switching the kind on step 1 draws a fresh name with the other prefix.
  const switchKind = (next) => {
    if (next === kind) return;
    setKind(next);
    setCommunityName(next === 'badge' ? genBadgeName() : genCommuninityName());
  };

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
    } catch {
      toast.error(t('communities.create.errors.generateInfo'));
    }
  };

  // preferStatic: signed by @threespeak server-side, so this works for a
  // delegated login with no local key, exactly as in the profile editor.
  const pickImage = (which) => async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error(t('communities.create.errors.notImage'));
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      toast.error(t('communities.create.errors.imageTooBig'));
      return;
    }
    setUploading(which);
    try {
      const url = await uploadThumbnail(file, user, { preferStatic: true });
      if (which === "avatar") setAvatar(url); else setBanner(url);
    } catch (err) {
      toast.error(err?.message || t('communities.create.errors.uploadFailed'));
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
      toast.error(isBadge ? t('communities.create.badge.profileSaveFailed') : t('communities.create.community.profileSaveFailed'));
    }
  };

  // Name, description and picture are all required. The picture especially:
  // this account is about to exist forever, and a directory full of blank
  // circles is what happens when it is optional at the one moment somebody is
  // actually thinking about how it should look.
  const missingFields = () => {
    const missing = [];
    if (!communityTitle.trim()) missing.push(t('communities.create.missing.name'));
    if (!aboutCommunity.trim()) missing.push(t('communities.create.missing.description'));
    if (!avatar) missing.push(t('communities.create.missing.picture'));
    return missing;
  };

  const handleCommuntiyInfo = () => {
    const missing = missingFields();
    if (missing.length) {
      const list = new Intl.ListFormat(getLanguage(), { type: 'conjunction' }).format(missing);
      setError(t('communities.create.errors.pleaseAdd', { list }));
      toast.error(t('communities.create.errors.pleaseAdd', { list }));
      return;
    }
    setError("");
    setStep(2);
  };

  const handleCreateCommuntiyWithKey = async () => {
    if (!aboutCommunity || !communityTitle) {
      setError(t('communities.create.errors.requiredFields'));
      toast.error(t('communities.create.errors.requiredFields'));
      return;
    }

    setIsLoading(true);
    try {
      const response = await createHiveCommunityKY(user, communityName, communityKeys, selectedKey);
      if (response.success) {
        setError("");
        await applyProfile();
        setStep(4);
        toast.success(isBadge ? t('communities.create.badge.createdSuccess') : t('communities.create.community.createdSuccess'));
      } else {
        setStep(4);
        setError(response.message);
        toast.error(t('communities.create.errors.createFailed', { error: response.message }));
      }
    } catch (error) {
      setStep(4);
      setError(error.message || t('communities.create.errors.generic'));
      toast.error(t('communities.create.errors.withMessage', { error: error.message || t('communities.create.errors.generic') }));
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
      toast.error(t('communities.create.errors.downloadFirst'));
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
          toast.success(isBadge ? t('communities.create.badge.createdSuccess') : t('communities.create.community.createdSuccess'));
        }
      } catch (err) {
        toast.error(err?.message || t('communities.create.errors.keychainFailed'));
      } finally {
        setIsLoading(false);
      }
      return;
    }
    toast.error(t('communities.create.errors.signInFirst', { provider }));
  };

  const createCommunityKc = async () => {
    setIsLoading(true);
    if (!isDownloaded) {
      setIsLoading(false);
      toast.error(t('communities.create.errors.downloadFirst'));
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
        toast.success(isBadge ? t('communities.create.badge.createdSuccess') : t('communities.create.community.createdSuccess'));
        setIsLoading(false);
      }
    } catch (error) {
      if (error.success === false) {
        setStep(4);
        setIsLoading(false);
        setError(error.message);
        toast.error(t('communities.create.errors.withMessage', { error: error.message }));
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
    toast.info(t('communities.create.passwordCopied'));
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
    toast.success(t('communities.create.keysDownloaded'));
  };
 
  const createTitle = isBadge ? t('communities.create.badge.title') : t('communities.create.community.title');
  const headerTitle = step === 2 ? t('communities.create.saveKeysTitle') : step === 3 ? t('communities.create.signTitle') : createTitle;

  const spin = <Icon name="progress_activity" size={16} className="v2-spin" />;
  const failed = step === 4 && !!error;

  // The 17g sheet foot: an optional note line over one full-width main action
  // (cyan: community), with Back beside it on the middle steps.
  const footer = step === 1 ? (
    <>
      <div className="dlg-note">{t('communities.create.feeNote')}</div>
      <Button variant="cyan" size={56} block next className="dlg-main cc-primary" onClick={() => handleCommuntiyInfo()} disabled={!!uploading}>
        {t('common.actions.continue')}
      </Button>
    </>
  ) : step === 2 ? (
    <div className="dlg-row">
      <Button variant="secondary" size={56} className="cc-secondary" onClick={() => setStep(1)}>{t('common.actions.back')}</Button>
      <Button variant="cyan" size={56} next className="dlg-main cc-primary" disabled={!isDownloaded} onClick={() => setStep(3)}>
        {t('common.actions.continue')}
      </Button>
    </div>
  ) : step === 3 ? (
    <Button variant="secondary" size={56} block className="cc-secondary" onClick={() => setStep(2)}>{t('common.actions.back')}</Button>
  ) : failed ? (
    <Button variant="cyan" size={56} block next className="dlg-main cc-primary" onClick={() => setStep(1)}>{t('common.actions.tryAgain')}</Button>
  ) : (
    <Button
      as={Link}
      variant="cyan"
      size={56}
      block
      next
      className="dlg-main cc-primary cc-primary-link"
      to={isBadge ? `/b/${communityName}` : `/community/${communityName}`}
      onClick={close}
    >
      {isBadge ? t('communities.create.badge.open') : t('communities.create.community.open')}
    </Button>
  );

  // Design 17g / 40c: the 17 sheet (docked right on desktop, a bottom sheet on
  // phones) with a cyan bar and a step bar. The look (kind, banner, picture,
  // name), save the keys, sign with the active key and the 3 HIVE fee, then
  // done (success card) or failed (accent wash).
  return (
    <DialogShell
      open={isOpen}
      onClose={close}
      busy={isLoading}
      title={headerTitle}
      side
      tone="cyan"
      steps={4}
      step={step - 1}
      width={480}
      zIndex={1100}
      className="create-com"
      bodyClassName="create-community-container"
      footer={footer}
    >
            {step === 1 && (
              <div className="cc-step">
                <Segmented
                  className="cc-kind"
                  label={createTitle}
                  options={[
                    { value: 'community', label: t('communities.page.fallbackTitle') },
                    { value: 'badge', label: t('badges.page.fallbackTitle') },
                  ]}
                  value={kind}
                  onChange={switchKind}
                />
                <p className="cc-head">
                  {isBadge ? t('communities.create.badge.intro') : t('communities.create.community.intro')}
                </p>

                {/* The preview card (17g): the banner, the picture riding over
                    its lower edge, and the name as the directory will show it.
                    Both images upload on tap. */}
                <div className="cc-cover">
                  <button
                    type="button"
                    className={`cc-banner${banner ? ' has-image' : ''}`}
                    style={banner ? { backgroundImage: `url(${banner})` } : undefined}
                    onClick={() => bannerInput.current?.click()}
                    disabled={!!uploading}
                  >
                    <span className="cc-banner-action">
                      {uploading === 'banner' ? spin : <Icon name="add_a_photo" size={16} />}
                      {banner ? t('communities.create.changeBanner') : t('communities.create.addBanner')}
                    </span>
                  </button>
                  <input ref={bannerInput} type="file" accept="image/*" onChange={pickImage('banner')} hidden />

                  <div className="cc-avatar-row">
                    <button
                      type="button"
                      className={`cc-avatar${avatar ? ' has-image' : ''}`}
                      onClick={() => avatarInput.current?.click()}
                      disabled={!!uploading}
                      aria-label={t('communities.create.uploadPicture')}
                      title={t('communities.create.pictureHint')}
                    >
                      {avatar ? <img src={avatar} alt="" /> : <Icon name="add_a_photo" size={20} />}
                      {uploading === 'avatar' && <span className="cc-avatar-badge">{spin}</span>}
                    </button>
                    <div className="cc-avatar-text">
                      <strong className={communityTitle.trim() ? undefined : 'is-empty'}>
                        {communityTitle.trim() || (isBadge ? t('communities.create.badge.namePlaceholder') : t('communities.create.community.namePlaceholder'))}
                      </strong>
                      <span>{avatar ? t('communities.create.picture') : t('communities.create.pictureHint')}</span>
                    </div>
                    <input ref={avatarInput} type="file" accept="image/*" onChange={pickImage('avatar')} hidden />
                  </div>
                </div>

                <label className="v2-field cc-field">
                  <span className="v2-eyebrow cc-label">{t('communities.create.name')}</span>
                  <input
                    className="v2-input cc-name"
                    type="text"
                    value={communityTitle}
                    maxLength={32}
                    placeholder={isBadge ? t('communities.create.badge.namePlaceholder') : t('communities.create.community.namePlaceholder')}
                    onChange={(e) => setCommunityTitle(e.target.value)}
                  />
                </label>

                <label className="v2-field cc-field">
                  <span className="v2-eyebrow cc-label">{t('communities.create.description')}</span>
                  <input
                    className="v2-input"
                    type="text"
                    value={aboutCommunity}
                    maxLength={120}
                    placeholder={isBadge ? t('communities.create.badge.descriptionPlaceholder') : t('communities.create.community.descriptionPlaceholder')}
                    onChange={(e) => setAboutCommunity(e.target.value)}
                  />
                  <span className="v2-field__hint cc-hint">{t('communities.create.descriptionHint')}</span>
                </label>

                <label className="v2-field cc-field">
                  <span className="v2-eyebrow cc-label"><Trans i18nKey="communities.create.bioLabel" components={{ em: <em /> }} /></span>
                  <textarea
                    className="v2-input is-area"
                    rows={4}
                    value={bio}
                    maxLength={1000}
                    placeholder={isBadge ? t('communities.create.badge.bioPlaceholder') : t('communities.create.community.bioPlaceholder')}
                    onChange={(e) => setBio(e.target.value)}
                  />
                </label>
              </div>
            )}
            {step === 2 && (
              <div className="cc-step">
                <p className="cc-head">
                  {isBadge ? t('communities.create.badge.saveKeysText') : t('communities.create.community.saveKeysText')}
                </p>

                <label className="v2-field cc-field">
                  <span className="v2-eyebrow cc-label">{isBadge ? t('communities.create.badge.username') : t('communities.create.community.username')}</span>
                  <input
                    className="v2-input cc-mono"
                    type="text"
                    value={communityName}
                    onChange={(e) => setCommunityName(e.target.value)}
                  />
                  {check && (
                    <span className={`cc-check${check === 'Available' ? ' is-ok' : ' is-bad'}`}>
                      <Icon name={check === 'Available' ? 'check' : 'error'} size={14} />
                      {check === 'Available' ? t('communities.create.available') : t('communities.create.notAvailable')}
                    </span>
                  )}
                </label>

                {/* 40c: the password in a mono well, then Copy | Download. */}
                <div className="v2-field cc-field">
                  <span className="v2-eyebrow cc-label">{isBadge ? t('communities.create.badge.password') : t('communities.create.community.password')}</span>
                  <output className="cc-password">{communityPassword}</output>
                </div>

                <div className="cc-key-actions">
                  <Button
                    variant="secondary"
                    icon="content_copy"
                    onClick={() => copyToClipboard(communityPassword)}
                  >
                    {t('communities.create.copyPassword')}
                  </Button>
                  <Button
                    variant="cyan"
                    icon={isDownloaded ? 'check' : 'download'}
                    className="cc-download"
                    onClick={downloadKeys}
                    disabled={!!error}
                  >
                    {t('communities.create.downloadKeys')}
                  </Button>
                </div>
                <p className="cc-fine">{t('communities.create.passwordWarning')}</p>
              </div>
            )}
            {step === 3 && (
              <div className="cc-step">
                <p className="cc-head">
                  <Trans i18nKey="communities.create.signText" values={{ user }} components={{ strong: <strong /> }} />
                </p>

                {/* Every wallet aioha can sign an ACTIVE operation with.
                    HiveSigner is absent on purpose: it authorises posting
                    only, so it can never sign account creation. */}
                <div className="v2-choices cc-providers">
                  {SIGN_PROVIDERS.map((prov) => {
                    const current = currentProvider === prov.id;
                    const sub = current
                      ? t('communities.create.signedIn')
                      : prov.id === Providers.Keychain && hasKeychain
                        ? t('communities.create.installed')
                        : canSignWith(prov.id) ? null : t('communities.create.signInToUse', { provider: prov.label });
                    return (
                      <button
                        type="button"
                        key={prov.id}
                        className={`v2-choice is-accent cc-provider${current ? ' is-on is-current' : ''}`}
                        disabled={isLoading || !isDownloaded || !canSignWith(prov.id)}
                        onClick={() => signWithProvider(prov.id)}
                      >
                        <Icon name={isLoading && current ? 'progress_activity' : prov.icon} size={18} className={`v2-choice__icon${isLoading && current ? ' v2-spin' : ''}`} />
                        <b className="cc-provider-name">{prov.label}</b>
                        {sub && <span className="cc-provider-tag">{sub}</span>}
                      </button>
                    );
                  })}
                </div>

                <div className="cc-or"><span>{t('communities.create.or')}</span></div>

                <label className="v2-field cc-field">
                  <span className="v2-eyebrow cc-label">{t('communities.create.pasteKey')}</span>
                  <div className="cc-copy-row">
                    <input
                      className="v2-input cc-mono"
                      type="password"
                      placeholder="5K…"
                      value={selectedKey}
                      onChange={(e) => setSelectedKey(e.target.value)}
                    />
                    <Button
                      variant="primary"
                      className="cc-primary"
                      disabled={isLoading || !selectedKey.trim()}
                      loading={isLoading}
                      onClick={() => handleCreateCommuntiyWithKey()}
                    >
                      {t('communities.create.sign')}
                    </Button>
                  </div>
                  <span className="v2-field__hint cc-hint">
                    {t('communities.create.pasteKeyHint')}
                  </span>
                </label>
              </div>
            )}
            {step === 4 && !error && (
              <div className="cc-step cc-done v2-success">
                {/* `Noun`, not the word "community": this same modal makes badges,
                    and it congratulated people on a community they had not made. */}
                <h3>{isBadge ? t('communities.create.badge.created') : t('communities.create.community.created')}</h3>
                <p className="cc-done-name">@{communityName}</p>

                {isBadge ? (
                  <p className="cc-done-text">
                    <Trans i18nKey="communities.create.badge.doneText" components={{ strong: <strong /> }} />
                  </p>
                ) : (
                  <p className="cc-done-text">
                    <Trans i18nKey="communities.create.community.doneText" components={{ strong: <strong /> }} />
                  </p>
                )}

                <p className="cc-done-note">
                  {t('communities.create.doneNote')}
                </p>
              </div>
            )}
            {step === 4 && error && (
              <div className="cc-step cc-done cc-failed">
                <p className="cc-done-text">
                  <b>{isBadge ? t('communities.create.badge.createFailed') : t('communities.create.community.createFailed')}</b>{' '}
                  {t('communities.create.failedText')}
                </p>
              </div>
            )}
    </DialogShell>
  );
}

export default CreateCommunity;