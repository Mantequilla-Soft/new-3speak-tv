import { useEffect, useState } from 'react';
import { toastIn } from '../../utils/toast';
import {
  getHash,
  getLinks,
  checkLink,
  unlinkLink,
  PLATFORMS,
  platformProfileUrl,
  platformLabel,
  warmupSocial,
} from '../../utils/socialVerifier';
import { useTranslation, Trans } from 'react-i18next';
import { SOCIAL_LINK_ENABLED } from '../../utils/config';
import DialogShell from './DialogShell';
import { Button, IconButton } from '../v2/ui';
import { Icon } from '../v2/Icon';
import './AddSocialLink_modal.scss';

// Every toast from this module is headed "Profile"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Profile');

// Material Symbols stand-ins for the platforms (one icon set per screen).
const PLATFORM_ICONS = {
  youtube: 'smart_display',
  tiktok: 'music_video',
  instagram: 'photo_camera',
  bitchute: 'play_circle',
  rumble: 'live_tv',
  soundcloud: 'cloud',
};

// `warmup`: a warm-up user (no Hive account) doing the optional "link your
// channel" task. Everything goes through warmupSocial (3Speak's API, keyed by the
// session) and the platform list comes from the server, NOT the profile link
// switches (SOCIAL_LINK_ENABLED), so it works on prod while those are off.
// `inline`: Settings > Connections renders the same panel as a page section.
// A change there tells an open own-profile page (SOCIAL_LINKS_CHANGED) to reload
// its link chips, since nothing else would.
export const SOCIAL_LINKS_CHANGED = '3speak:social-links-changed';

export default function AddSocialLink_modal({ isOpen, onClose, hiveUsername, onChange, warmup = false, inline = false }) {
  const { t } = useTranslation();
  const [warmupPlatforms, setWarmupPlatforms] = useState([]);
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
    if (!isOpen || warmup) return;
    if (!hiveUsername) return;
    setLoadingLinks(true);
    Promise.all([
      getHash(hiveUsername).catch(() => null),
      getLinks(hiveUsername).catch(() => []),
    ]).then(([h, l]) => {
      setHashInfo(h);
      setLinks(l);
    }).finally(() => setLoadingLinks(false));
  }, [isOpen, hiveUsername, warmup]);
  useEffect(() => {
    if (!isOpen || !warmup) return;
    setLoadingLinks(true);
    warmupSocial.load()
      .then((d) => {
        setHashInfo(d?.code ? { hash: d.code } : null);
        setLinks(d?.links || []);
        setWarmupPlatforms(d?.platforms || []);
      })
      .catch(() => setLinks([]))
      .finally(() => setLoadingLinks(false));
  }, [isOpen, warmup]);

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
    const fresh = warmup
      ? await warmupSocial.load().then((d) => d?.links || []).catch(() => [])
      : await getLinks(hiveUsername).catch(() => []);
    setLinks(fresh);
    onChange?.();
    if (inline) window.dispatchEvent(new Event(SOCIAL_LINKS_CHANGED));
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
      const record = await (warmup ? warmupSocial.check : checkLink)({
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
        setError(data?.claimed_by
          ? t('modals.socialLink.errors.alreadyLinked', { user: data.claimed_by })
          : t('modals.socialLink.errors.alreadyLinkedOther'));
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
      const result = await (warmup ? warmupSocial.unlink : unlinkLink)({
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

  const title = step === 'flow' && selectedPlatform
    ? t('modals.socialLink.flowTitle', { platform: platformLabel(selectedPlatform) })
    : t('modals.socialLink.title');

  const actions = step === 'flow' && selectedPlatform ? (
    <>
      <Button
        variant="secondary"
        className="social-link-btn-secondary"
        onClick={() => { setStep('list'); setError(''); }}
        disabled={submitting}
      >
        {t('common.actions.back')}
      </Button>
      <Button
        variant="cyan"
        className="social-link-btn-primary"
        onClick={handleVerify}
        disabled={submitting || !platformUsername.trim()}
        loading={submitting}
      >
        {submitting ? t('modals.socialLink.verifying') : t('modals.socialLink.verify')}
      </Button>
    </>
  ) : null;

  // Design 43b (linked external profiles): the linked list as filled rows,
  // the platforms as tiles; verifying is three numbered steps with the hash in
  // a mono well, the error in accent, Back and Verify in the footer.
  const body = (
    <>
      {step === 'list' && (
        <>
          <p className="social-link-modal-sub">
            {t('modals.socialLink.intro')}
          </p>

          {loadingLinks ? (
            <p className="social-link-loading"><Icon name="progress_activity" size={16} className="v2-spin" /> {t('common.status.loading')}</p>
          ) : links.length > 0 ? (
            <ul className="social-link-list">
              {links.map((link) => {
                const icon = PLATFORM_ICONS[link.platform] || 'link';
                const url = platformProfileUrl(link.platform, link.platform_username);
                const key = `${link.platform}:${link.platform_username}`;
                return (
                  <li key={key} className="social-link-list__item">
                    <span className="social-link-list__icon"><Icon name={icon} size={20} /></span>
                    <div className="social-link-list__meta">
                      <strong>{platformLabel(link.platform)}</strong>
                      <span className="social-link-list__id">{link.platform_username}</span>
                    </div>
                    {url && (
                      <IconButton
                        as="a"
                        href={url}
                        className="social-link-list__open"
                        target="_blank"
                        rel="noopener noreferrer"
                        icon="open_in_new"
                        label={t('modals.socialLink.openProfile')}
                        size={32}
                        variant="ghost"
                        round
                      />
                    )}
                    <IconButton
                      className="social-link-list__remove"
                      onClick={() => handleUnlink(link)}
                      disabled={unlinkingKey === key}
                      icon={unlinkingKey === key ? 'progress_activity' : 'delete'}
                      label={t('modals.socialLink.removeLink')}
                      size={32}
                      variant="ghost"
                      round
                    />
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="social-link-empty">{t('modals.socialLink.empty')}</p>
          )}

          <h4 className="social-link-section-title">{t('modals.socialLink.addPlatform')}</h4>
          <div className="social-link-platform-grid">
            {Object.entries(PLATFORMS).filter(([key]) => (warmup ? warmupPlatforms.includes(key) : SOCIAL_LINK_ENABLED[key])).map(([key, info]) => (
              <button
                key={key}
                type="button"
                className="v2-dock social-link-platform-btn"
                onClick={() => handlePickPlatform(key)}
              >
                <Icon name={PLATFORM_ICONS[key] || 'link'} size={22} />
                <span>{info.label}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {step === 'flow' && selectedPlatform && (
        <>
          <ol className="social-link-steps">
            <li>
              <span className="social-link-steps__n">1</span>
              <div className="social-link-steps__body">
                <strong>{t('modals.socialLink.step1')}</strong>
                <div className="social-link-hash-row">
                  <code className="social-link-hash">{hashInfo?.hash || '…'}</code>
                  <Button
                    size={36}
                    className="social-link-copy-btn"
                    onClick={handleCopyHash}
                    disabled={!hashInfo?.hash}
                    icon={hashCopied ? 'check' : 'content_copy'}
                  >
                    {hashCopied ? t('common.actions.copied') : t('common.actions.copy')}
                  </Button>
                </div>
              </div>
            </li>
            <li>
              <span className="social-link-steps__n">2</span>
              <div className="social-link-steps__body">
                <Trans i18nKey="modals.socialLink.step2" values={{ platform: platformLabel(selectedPlatform) }} components={{ strong: <strong /> }} />
              </div>
            </li>
            <li>
              <span className="social-link-steps__n">3</span>
              <div className="social-link-steps__body">
                <strong>{t('modals.socialLink.step3', { platform: platformLabel(selectedPlatform) })}</strong>
                <input
                  className="v2-input social-link-input"
                  type="text"
                  value={platformUsername}
                  onChange={(e) => setPlatformUsername(e.target.value)}
                  placeholder={PLATFORMS[selectedPlatform]?.inputPlaceholderKey && t(PLATFORMS[selectedPlatform].inputPlaceholderKey)}
                  aria-label={t('modals.socialLink.step3', { platform: platformLabel(selectedPlatform) })}
                  autoFocus
                />
                {PLATFORMS[selectedPlatform]?.inputHelpKey && (
                  <small className="social-link-input-help">
                    {t(PLATFORMS[selectedPlatform].inputHelpKey)}
                  </small>
                )}
              </div>
            </li>
          </ol>

          {error && <div className="social-link-error" role="alert">{error}</div>}
          {inline && <div className="social-link-actions">{actions}</div>}
        </>
      )}
    </>
  );

  // Settings > Connections: the same panel as a section of the page, no popup.
  if (inline) {
    return (
      <div className="settings-section social-link-inline">
        <h4 className="settings-section-title">{title}</h4>
        {body}
      </div>
    );
  }

  return (
    <DialogShell
      onClose={handleClose}
      title={title}
      width={520}
      zIndex={1100}
      overlayClassName="social-link-modal-overlay"
      className="social-link-modal-content"
      footer={actions}
    >
      {body}
    </DialogShell>
  );
}
