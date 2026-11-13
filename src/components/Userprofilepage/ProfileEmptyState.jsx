import { useNavigate } from 'react-router-dom';
import { creatorKey, getCreatorSettings, isUploadBlocked } from '../../utils/creatorSettings';
import { useSupportBlock } from '../../lib/supportBlockStore';
import { useAppStore } from '../../lib/store';
import { useTranslation } from 'react-i18next';
import { Button } from '../v2/ui';
import { Icon } from '../v2/Icon';
import './ProfileEmptyState.scss';

/**
 * What a profile tab shows when it has nothing in it.
 *
 * On your own profile that is a call to action: the tab you just opened is the
 * one place you already care about that kind of content, so it offers the
 * upload rather than announcing an absence. On someone else's it is one quiet
 * line — a visitor can't fix an empty tab, so a big block would just be noise.
 *
 * Uploads run through the same creator gate the Upload menu uses (a blocked
 * creator gets the support dialog, not the studio).
 */
const KINDS = {
  video: {
    icon: 'smart_display',
    titleKey: 'profile.empty.video.title',
    textKey: 'profile.empty.video.text',
    ctaKey: 'profile.empty.video.cta',
    go: (navigate) => navigate('/embed-studio'),
    visitorKey: 'profile.empty.video.visitor',
  },
  shorts: {
    icon: 'view_day',
    titleKey: 'profile.empty.shorts.title',
    textKey: 'profile.empty.shorts.text',
    ctaKey: 'profile.empty.shorts.cta',
    go: (navigate) => navigate('/embed-studio?from=shorts'),
    visitorKey: 'profile.empty.shorts.visitor',
  },
  audio: {
    icon: 'graphic_eq',
    titleKey: 'profile.empty.audio.title',
    textKey: 'profile.empty.audio.text',
    ctaKey: 'profile.empty.audio.cta',
    go: () => window.dispatchEvent(new CustomEvent('open-audio-upload')),
    visitorKey: 'profile.empty.audio.visitor',
  },
  playlists: {
    icon: 'playlist_play',
    titleKey: 'profile.empty.playlists.title',
    textKey: 'profile.empty.playlists.text',
    ctaKey: 'profile.empty.playlists.cta',
    // Opens a modal the page owns, so it isn't an upload and isn't gated.
    gated: false,
    visitorKey: 'profile.empty.playlists.visitor',
  },
};

export default function ProfileEmptyState({ kind = 'video', isOwnProfile = false, username, onAction }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const cfg = KINDS[kind] || KINDS.video;

  if (!isOwnProfile) {
    return (
      <div className="profile-empty">
        <Icon name={cfg.icon} size={24} className="pe-visitor-icon" />
        <p className="pe-line">{t(cfg.visitorKey, { user: username })}</p>
      </div>
    );
  }

  const onClick = async (e) => {
    e.preventDefault();
    if (cfg.gated === false) { onAction?.(); return; }
    // Same gate as UploadLinks: fails open if the check itself errors.
    const { user: hiveUser, incubationHandle } = useAppStore.getState();
    const settings = await getCreatorSettings(creatorKey(hiveUser, incubationHandle));
    if (isUploadBlocked(settings)) {
      useSupportBlock.getState().showSupportBlock('upload');
      return;
    }
    cfg.go(navigate);
  };

  return (
    <div className="profile-empty profile-empty--own">
      <span className="pe-icon"><Icon name={cfg.icon} size={24} /></span>
      <strong className="pe-title">{t(cfg.titleKey)}</strong>
      <span className="pe-text">{t(cfg.textKey)}</span>
      <Button variant="primary" size={40} trailing="add" className="pe-btn" onClick={onClick}>
        {t(cfg.ctaKey)}
      </Button>
      {/* What the same tab says to everyone else (37b). */}
      <span className="pe-visitor">{t('profile.empty.visitorPreview', { text: t(cfg.visitorKey, { user: username }) })}</span>
    </div>
  );
}
