import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { IoClose } from 'react-icons/io5';
import { FaYoutube, FaSoundcloud, FaTiktok, FaCopy, FaCheck, FaTrash, FaExternalLinkAlt } from 'react-icons/fa';
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
import { useTranslation, Trans } from 'react-i18next';
import './AddSocialLink_modal.scss';

// Every toast from this module is headed "Profile"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Profile');

const PLATFORM_ICONS = {
  youtube: FaYoutube,
  tiktok: FaTiktok,
  soundcloud: FaSoundcloud,
};

export default function AddSocialLink_modal({ isOpen, onClose, hiveUsername, onChange }) {
  const { t } = useTranslation();
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
      toast.success(t('modals.socialLink.hashCopied'));
      setTimeout(() => setHashCopied(false), 1500);
    } catch {
      toast.error(t('modals.socialLink.copyFailed'));
    }
  };

  const handlePickPlatform = (platform) => {
    setSelectedPlatform(platform);
    setStep('flow');
    setError('');
  };

  const handleVerify = async () => {
    if (!selectedPlatform || !platformUsername.trim()) {
      toast.error(t('modals.socialLink.enterHandle'));
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
        toast.success(t('modals.socialLink.verified'));
        await refreshLinks();
        resetFlow();
      } else {
        setError(
          t('modals.socialLink.errors.hashNotFound')
        );
      }
    } catch (err) {
      const data = err?.response?.data;
      const code = data?.code;
      if (code === 'CHANNEL_ALREADY_LINKED') {
        setError(t('modals.socialLink.errors.alreadyLinked', { user: data?.claimed_by }));
      } else if (code === 'TOO_MANY_LINKS') {
        setError(t('modals.socialLink.errors.tooMany'));
      } else if (err?.response?.status === 404) {
        setError(t('modals.socialLink.errors.notFound'));
      } else if (err?.response?.status === 401) {
        setError(t('modals.socialLink.errors.badSignature'));
      } else if (err?.response?.status === 429) {
        setError(t('modals.socialLink.errors.rateLimited'));
      } else if (err?.response?.status === 502) {
        setError(t('modals.socialLink.errors.lookupFailed'));
      } else {
        setError(data?.error || err.message || t('modals.socialLink.errors.verifyFailed'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleUnlink = async (link) => {
    const confirmMsg = t('modals.socialLink.confirmUnlink', { platform: platformLabel(link.platform) });
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
        toast.success(t('modals.socialLink.removed'));
        await refreshLinks();
      } else if (result?.still_present) {
        toast.error(t('modals.socialLink.errors.stillPresent'));
      } else {
        toast.error(result?.error || t('modals.socialLink.errors.unlinkFailed'));
      }
    } catch (err) {
      const data = err?.response?.data;
      if (data?.still_present) {
        toast.error(t('modals.socialLink.errors.stillPresent'));
      } else if (err?.response?.status === 404) {
        toast.error(t('modals.socialLink.errors.noSuchLink'));
        await refreshLinks();
      } else {
        toast.error(data?.error || err.message || t('modals.socialLink.errors.unlinkFailed'));
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
            <h3 className="social-link-modal-title">{t('modals.socialLink.title')}</h3>
            <p className="social-link-modal-sub">
              {t('modals.socialLink.intro')}
            </p>

            {loadingLinks ? (
              <p className="social-link-loading">{t('common.status.loading')}</p>
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
                          title={t('modals.socialLink.openProfile')}
                        >
                          <FaExternalLinkAlt />
                        </a>
                      )}
                      <button
                        className="social-link-list__remove"
                        onClick={() => handleUnlink(link)}
                        disabled={unlinkingKey === key}
                        title={t('modals.socialLink.removeLink')}
                      >
                        {unlinkingKey === key ? '…' : <FaTrash />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="social-link-empty">{t('modals.socialLink.empty')}</p>
            )}

            <h4 className="social-link-section-title">{t('modals.socialLink.addPlatform')}</h4>
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
              {t('modals.socialLink.flowTitle', { platform: platformLabel(selectedPlatform) })}
            </h3>

            <ol className="social-link-steps">
              <li>
                <strong>{t('modals.socialLink.step1')}</strong>
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
                <Trans i18nKey="modals.socialLink.step2" values={{ platform: platformLabel(selectedPlatform) }} components={{ strong: <strong /> }} />
              </li>
              <li>
                <strong>{t('modals.socialLink.step3', { platform: platformLabel(selectedPlatform) })}</strong>
                <input
                  className="social-link-input"
                  type="text"
                  value={platformUsername}
                  onChange={(e) => setPlatformUsername(e.target.value)}
                  placeholder={PLATFORMS[selectedPlatform]?.inputPlaceholderKey && t(PLATFORMS[selectedPlatform].inputPlaceholderKey)}
                  autoFocus
                />
                {PLATFORMS[selectedPlatform]?.inputHelpKey && (
                  <small className="social-link-input-help">
                    {t(PLATFORMS[selectedPlatform].inputHelpKey)}
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
                {t('common.actions.back')}
              </button>
              <button
                className="social-link-btn-primary"
                onClick={handleVerify}
                disabled={submitting || !platformUsername.trim()}
              >
                {submitting ? t('modals.socialLink.verifying') : t('modals.socialLink.verify')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
