import { useEffect, useState } from 'react';
import { FaYoutube, FaSoundcloud, FaTiktok, FaInstagram, FaPlayCircle } from 'react-icons/fa';
import { SiRumble } from 'react-icons/si';
import { Icon as MsIcon } from '../v2/Icon';
import { toastIn } from '../../utils/toast';
import {
  getLinks,
  unlinkLink,
  platformProfileUrl,
  platformLabel,
} from '../../utils/socialVerifier';
import { useTranslation } from 'react-i18next';
import './SocialLinks.scss';

// Every toast from this module is headed "Profile"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Profile');

// Shared with the admin view on warm-up profiles (AdvertiserAdminPanel).
export const PLATFORM_ICONS = {
  youtube: FaYoutube,
  tiktok: FaTiktok,
  instagram: FaInstagram,
  bitchute: FaPlayCircle,
  rumble: SiRumble,
  soundcloud: FaSoundcloud,
};

// What the profile header draws (37b): Material Symbols, like the rest of the
// screen. PLATFORM_ICONS above stays for the other screens that import it.
const PLATFORM_SYMBOLS = {
  youtube: 'smart_display',
  tiktok: 'music_note',
  instagram: 'photo_camera',
  bitchute: 'play_circle',
  rumble: 'videocam',
  soundcloud: 'cloud',
};

export default function SocialLinks({ hiveUsername, refreshKey = 0, canDelete = false, onChange, column = false }) {
  const { t } = useTranslation();
  const [links, setLinks] = useState([]);
  const [removingKey, setRemovingKey] = useState(null);

  useEffect(() => {
    if (!hiveUsername) return;
    let cancelled = false;
    getLinks(hiveUsername)
      .then((data) => { if (!cancelled) setLinks(data); })
      .catch(() => { if (!cancelled) setLinks([]); });
    return () => { cancelled = true; };
  }, [hiveUsername, refreshKey]);

  const handleRemove = async (link) => {
    const label = platformLabel(link.platform);
    const ok = window.confirm(
      t('profile.social.confirmRemove', { platform: label })
    );
    if (!ok) return;
    const key = `${link.platform}:${link.platform_username}`;
    setRemovingKey(key);
    try {
      const result = await unlinkLink({
        hive_username: hiveUsername,
        platform: link.platform,
        platform_username: link.platform_username,
      });
      if (result?.deleted) {
        toast.success(t('profile.social.removed'));
        setLinks((prev) => prev.filter((l) => `${l.platform}:${l.platform_username}` !== key));
        onChange?.();
      } else if (result?.still_present) {
        toast.error(t('profile.social.hashStillPresent'));
      } else {
        toast.error(result?.error || t('profile.social.unlinkFailed'));
      }
    } catch (err) {
      const data = err?.response?.data;
      if (data?.still_present) {
        toast.error(t('profile.social.hashStillPresent'));
      } else if (err?.response?.status === 404) {
        toast.error(t('profile.social.noSuchLink'));
        onChange?.();
      } else if (err?.response?.status === 401) {
        toast.error(t('profile.social.signatureFailed'));
      } else {
        toast.error(data?.error || err.message || t('profile.social.unlinkFailed'));
      }
    } finally {
      setRemovingKey(null);
    }
  };

  if (!links.length) return null;

  return (
    <span className={`social-links${column ? ' social-links--column' : ''}`}>
      {links.map((link) => {
        const symbol = PLATFORM_SYMBOLS[link.platform];
        const url = platformProfileUrl(link.platform, link.platform_username);
        if (!symbol || !url) return null;
        const key = `${link.platform}:${link.platform_username}`;
        const removing = removingKey === key;
        return (
          <span key={key} className={`social-links__chip social-links__chip--${link.platform}`}>
            <a
              className="social-links__icon"
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              title={t('profile.social.verified', { platform: platformLabel(link.platform) })}
              aria-label={t('profile.social.verified', { platform: platformLabel(link.platform) })}
            >
              <MsIcon name={symbol} size={18} />
            </a>
            {canDelete && (
              <button
                type="button"
                className="social-links__remove"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleRemove(link);
                }}
                disabled={removing}
                title={t('profile.social.removeLink', { platform: platformLabel(link.platform) })}
                aria-label={t('profile.social.removeLink', { platform: platformLabel(link.platform) })}
              >
                <MsIcon name="close" size={12} />
              </button>
            )}
          </span>
        );
      })}
    </span>
  );
}
