import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { IoClose } from 'react-icons/io5';
import { FaYoutube, FaSoundcloud, FaCopy, FaCheck, FaTrash, FaExternalLinkAlt } from 'react-icons/fa';
import { toastIn } from '../../utils/toast';
import {
  getHash,
  getLinks,
  checkLink,
  unlinkLink,
  PLATFORMS,
  platformProfileUrl,
  platformLabel,
} from '../../utils/socialVerifier';
import './AddSocialLink_modal.scss';

// Every toast from this module is headed "Profile"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Profile');

const PLATFORM_ICONS = {
  youtube: FaYoutube,
  soundcloud: FaSoundcloud,
};

export default function AddSocialLink_modal({ isOpen, onClose, hiveUsername, onChange }) {
  const [step, setStep] = useState('list'); // 'list' | 'flow'
  const [hashInfo, setHashInfo] = useState(null);
  const [links, setLinks] = useState([]);
  const [loadingLinks, setLoadingLinks] = useState(false);
  const [selectedPlatform, setSelectedPlatform] = useState(null);
  const [platformUsername, setPlatformUsername] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [unlinkingKey, setUnlinkingKey] = useState(null);
  const [error, setError] = useState('');
  const [hashCopied, setHashCopied] = useState(false);

  useEffect(() => {
    if (!isOpen || !hiveUsername) return;
    setLoadingLinks(true);
    Promise.all([
      getHash(hiveUsername).catch(() => null),
      getLinks(hiveUsername).catch(() => []),
    ]).then(([h, l]) => {
      setHashInfo(h);
      setLinks(l);
    }).finally(() => setLoadingLinks(false));
  }, [isOpen, hiveUsername]);

  if (!isOpen) return null;

  const resetFlow = () => {
    setStep('list');
    setSelectedPlatform(null);
    setPlatformUsername('');
    setError('');
  };

  const handleClose = () => {
    resetFlow();
    onClose();
  };

  const refreshLinks = async () => {
    const fresh = await getLinks(hiveUsername).catch(() => []);
    setLinks(fresh);
    onChange?.();
  };

  const handleCopyHash = async () => {
    if (!hashInfo?.hash) return;
    try {
      await navigator.clipboard.writeText(hashInfo.hash);
      setHashCopied(true);
      toast.success('Hash copied');
      setTimeout(() => setHashCopied(false), 1500);
    } catch {
      toast.error('Could not copy to clipboard');
    }
  };

  const handlePickPlatform = (platform) => {
    setSelectedPlatform(platform);
    setStep('flow');
    setError('');
  };

  const handleVerify = async () => {
    if (!selectedPlatform || !platformUsername.trim()) {
      toast.error('Enter your platform handle or ID');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const record = await checkLink({
        hive_username: hiveUsername,
        platform: selectedPlatform,
        platform_username: platformUsername.trim(),
      });
      if (record?.verified) {
        toast.success('Account verified and linked');
        await refreshLinks();
        resetFlow();
      } else {
        setError(
          'Hash not found on the profile yet. Make sure the change is saved publicly, then try again.'
        );
      }
    } catch (err) {
      const data = err?.response?.data;
      const code = data?.code;
      if (code === 'CHANNEL_ALREADY_LINKED') {
        setError(`This channel is already verified by another Hive user (@${data?.claimed_by}).`);
      } else if (code === 'TOO_MANY_LINKS') {
        setError('You have reached the maximum number of linked accounts.');
      } else if (err?.response?.status === 404) {
        setError('That channel does not exist on the platform.');
      } else if (err?.response?.status === 401) {
        setError('Signature could not be verified. Make sure you are logged in with your posting key.');
      } else if (err?.response?.status === 429) {
        setError('Too many requests. Please wait a minute and try again.');
      } else if (err?.response?.status === 502) {
        setError('Platform lookup failed. Try again in a moment.');
      } else {
        setError(data?.error || err.message || 'Verification failed');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleUnlink = async (link) => {
    const confirmMsg = `Remove your ${platformLabel(link.platform)} link? Make sure the verification hash is no longer on your public profile, otherwise the unlink will be rejected.`;
    if (!window.confirm(confirmMsg)) return;
    const key = `${link.platform}:${link.platform_username}`;
    setUnlinkingKey(key);
    try {
      const result = await unlinkLink({
        hive_username: hiveUsername,
        platform: link.platform,
        platform_username: link.platform_username,
      });
      if (result?.deleted) {
        toast.success('Link removed');
        await refreshLinks();
      } else if (result?.still_present) {
        toast.error('Hash is still on your profile — remove it first.');
      } else {
        toast.error(result?.error || 'Unlink failed');
      }
    } catch (err) {
      const data = err?.response?.data;
      if (data?.still_present) {
        toast.error('Hash is still on your profile — remove it first.');
      } else if (err?.response?.status === 404) {
        toast.error('No such link to remove.');
        await refreshLinks();
      } else {
        toast.error(data?.error || err.message || 'Unlink failed');
      }
    } finally {
      setUnlinkingKey(null);
    }
  };

  return createPortal(
    <div className="social-link-modal-overlay" onClick={handleClose}>
      <div className="social-link-modal-content" onClick={(e) => e.stopPropagation()}>
        <button className="social-link-close-btn" onClick={handleClose}>
          <IoClose size={22} />
        </button>

        {step === 'list' && (
          <>
            <h3 className="social-link-modal-title">Linked external profiles</h3>
            <p className="social-link-modal-sub">
              Prove you own a YouTube (or other) channel by pasting your unique 3Speak hash
              into your public profile description, then verifying it here.
            </p>

            {loadingLinks ? (
              <p className="social-link-loading">Loading…</p>
            ) : links.length > 0 ? (
              <ul className="social-link-list">
                {links.map((link) => {
                  const Icon = PLATFORM_ICONS[link.platform];
                  const url = platformProfileUrl(link.platform, link.platform_username);
                  const key = `${link.platform}:${link.platform_username}`;
                  return (
                    <li key={key} className="social-link-list__item">
                      {Icon && <Icon className="social-link-list__icon" />}
                      <div className="social-link-list__meta">
                        <strong>{platformLabel(link.platform)}</strong>
                        <span className="social-link-list__id">{link.platform_username}</span>
                      </div>
                      {url && (
                        <a
                          href={url}
                          className="social-link-list__open"
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Open profile"
                        >
                          <FaExternalLinkAlt />
                        </a>
                      )}
                      <button
                        className="social-link-list__remove"
                        onClick={() => handleUnlink(link)}
                        disabled={unlinkingKey === key}
                        title="Remove link"
                      >
                        {unlinkingKey === key ? '…' : <FaTrash />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="social-link-empty">No external profiles linked yet.</p>
            )}

            <h4 className="social-link-section-title">Add a new platform</h4>
            <div className="social-link-platform-grid">
              {Object.entries(PLATFORMS).map(([key, info]) => {
                const Icon = PLATFORM_ICONS[key];
                return (
                  <button
                    key={key}
                    className="social-link-platform-btn"
                    onClick={() => handlePickPlatform(key)}
                  >
                    {Icon && <Icon size={28} />}
                    <span>{info.label}</span>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {step === 'flow' && selectedPlatform && (
          <>
            <h3 className="social-link-modal-title">
              Link your {platformLabel(selectedPlatform)} channel
            </h3>

            <ol className="social-link-steps">
              <li>
                <strong>Copy your unique verification hash:</strong>
                <div className="social-link-hash-row">
                  <code className="social-link-hash">{hashInfo?.hash || '…'}</code>
                  <button
                    className="social-link-copy-btn"
                    onClick={handleCopyHash}
                    disabled={!hashInfo?.hash}
                  >
                    {hashCopied ? <FaCheck /> : <FaCopy />}
                  </button>
                </div>
              </li>
              <li>
                <strong>
                  Paste it into your public {platformLabel(selectedPlatform)} profile description
                </strong>{' '}
                (anywhere — about / bio / description is fine). Save the change.
              </li>
              <li>
                <strong>Enter your {platformLabel(selectedPlatform)} identifier:</strong>
                <input
                  className="social-link-input"
                  type="text"
                  value={platformUsername}
                  onChange={(e) => setPlatformUsername(e.target.value)}
                  placeholder={PLATFORMS[selectedPlatform]?.inputPlaceholder}
                  autoFocus
                />
                {PLATFORMS[selectedPlatform]?.inputHelp && (
                  <small className="social-link-input-help">
                    {PLATFORMS[selectedPlatform].inputHelp}
                  </small>
                )}
              </li>
            </ol>

            {error && <div className="social-link-error">{error}</div>}

            <div className="social-link-actions">
              <button
                className="social-link-btn-secondary"
                onClick={() => { setStep('list'); setError(''); }}
                disabled={submitting}
              >
                Back
              </button>
              <button
                className="social-link-btn-primary"
                onClick={handleVerify}
                disabled={submitting || !platformUsername.trim()}
              >
                {submitting ? 'Verifying…' : 'Verify'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
