import { useNavigate } from 'react-router-dom';
import { IoCloudUploadSharp } from 'react-icons/io5';
import { MdGraphicEq } from 'react-icons/md';
import { IoMdAdd } from 'react-icons/io';
import ShortsIcon from '../icons/ShortsIcon';
import { getCreatorSettings, isUploadBlocked } from '../../utils/creatorSettings';
import { useSupportBlock } from '../../lib/supportBlockStore';
import { useAppStore } from '../../lib/store';
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
    Icon: IoCloudUploadSharp,
    title: 'No videos yet',
    text: 'Upload your first video and it lands right here.',
    cta: 'Upload a video',
    go: (navigate) => navigate('/embed-studio'),
    visitor: (u) => `@${u} hasn't published any videos yet.`,
  },
  shorts: {
    Icon: ShortsIcon,
    title: 'No shorts yet',
    text: 'Shorts are vertical videos, made for a quick scroll.',
    cta: 'Upload a short',
    go: (navigate) => navigate('/embed-studio?from=shorts'),
    visitor: (u) => `@${u} hasn't published any shorts yet.`,
  },
  audio: {
    Icon: MdGraphicEq,
    title: 'No audio yet',
    text: 'Music, podcasts and mixes live on your profile too.',
    cta: 'Upload audio',
    go: () => window.dispatchEvent(new CustomEvent('open-audio-upload')),
    visitor: (u) => `@${u} hasn't published any audio yet.`,
  },
  playlists: {
    Icon: IoMdAdd,
    title: 'No playlists yet',
    text: 'Group your videos into a playlist people can watch in order.',
    cta: 'Create your first playlist',
    // Opens a modal the page owns, so it isn't an upload and isn't gated.
    gated: false,
    visitor: (u) => `@${u} has no public playlists.`,
  },
};

export default function ProfileEmptyState({ kind = 'video', isOwnProfile = false, username, onAction }) {
  const navigate = useNavigate();
  const cfg = KINDS[kind] || KINDS.video;

  if (!isOwnProfile) {
    return (
      <div className="profile-empty">
        <p className="pe-line">{cfg.visitor(username)}</p>
      </div>
    );
  }

  const Icon = cfg.Icon;
  const onClick = async (e) => {
    e.preventDefault();
    if (cfg.gated === false) { onAction?.(); return; }
    // Same gate as UploadLinks: fails open if the check itself errors.
    const settings = await getCreatorSettings(useAppStore.getState().user);
    if (isUploadBlocked(settings)) {
      useSupportBlock.getState().showSupportBlock('upload');
      return;
    }
    cfg.go(navigate);
  };

  return (
    <div className="profile-empty profile-empty--own">
      <span className="pe-icon"><Icon size={22} /></span>
      <strong className="pe-title">{cfg.title}</strong>
      <span className="pe-text">{cfg.text}</span>
      <button type="button" className="pe-btn" onClick={onClick}>{cfg.cta}</button>
    </div>
  );
}
