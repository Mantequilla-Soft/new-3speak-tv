import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { IoClose, IoLogoGithub, IoCheckmarkCircle } from 'react-icons/io5';
import {
  MdHome, MdOndemandVideo, MdChatBubbleOutline, MdSmartphone, MdAmpStories, MdContentCut, MdFileUpload,
  MdAudiotrack, MdPodcasts, MdLiveTv, MdPerson, MdGroups, MdPlaylistPlay, MdVolunteerActivism, MdCampaign,
  MdForum, MdNotifications, MdLeaderboard, MdShare, MdLogin, MdSettings, MdAutoAwesome, MdExpandMore,
} from 'react-icons/md';
import { useAppStore } from '../../lib/store';
import { APP_VERSION } from '../../version';
import { CHANGELOG, changelogSince, groupChangelog } from '../../changelog';
import { markVersionSeen } from '../../utils/appVersion';
import { formatDaysAgo } from '../../i18n';
import logo from '../../assets/image/3S_logo.svg';
import logoDark from '../../assets/image/3S_logodark.png';
import './ChangelogModal.scss';

// DUMMY MODE: while we design the popup it opens on every load with the latest
// entries so we can iterate on styling. To go live, set DUMMY_MODE = false — then
// it only opens for users who upgraded (store.appUpdatedFrom, set by checkAppVersion).
const DUMMY_MODE = false;

// Short, friendly relative date e.g. "2 weeks ago", in the reader's language.
const timeAgo = formatDaysAgo;

// One icon per category (src/changelog.js CHANGELOG_CATEGORIES).
const CATEGORY_ICONS = {
  home: MdHome, watch: MdOndemandVideo, comments: MdChatBubbleOutline, shorts: MdSmartphone, stories: MdAmpStories,
  editor: MdContentCut, upload: MdFileUpload, audio: MdAudiotrack, podcasts: MdPodcasts, live: MdLiveTv,
  profile: MdPerson, groups: MdGroups, playlists: MdPlaylistPlay, tips: MdVolunteerActivism, ads: MdCampaign,
  chat: MdForum, notifications: MdNotifications, leaderboard: MdLeaderboard, sharing: MdShare, account: MdLogin,
  settings: MdSettings, general: MdAutoAwesome,
};

// Few updates: every group open. Many (someone back after weeks): only the group
// with the newest change, the rest are headers with a count to open.
const OPEN_ALL_UP_TO = 6;
const initiallyOpen = (groups, total) => new Set(
  groups.length === 1 || total <= OPEN_ALL_UP_TO ? groups.map((g) => g.category) : groups.slice(0, 1).map((g) => g.category),
);

// Routes that must never be interrupted by "what's new". /advertise is a landing
// page we send people to from outside 3Speak, and a changelog for an app they have
// not used yet is the worst possible first thing to put in front of them.
const SILENT_ROUTES = ['/advertise'];
const isSilentRoute = (pathname) => {
  const p = String(pathname || '').toLowerCase();
  return SILENT_ROUTES.some((r) => p === r || p.startsWith(`${r}/`));
};

export default function ChangelogModal() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const silenced = isSilentRoute(pathname);
  const appUpdatedFrom = useAppStore((s) => s.appUpdatedFrom);
  const setAppUpdatedFrom = useAppStore((s) => s.setAppUpdatedFrom);
  const theme = useAppStore((s) => s.theme);
  const [open, setOpen] = useState(false);
  // Which category groups are open (null until the popup first renders its groups).
  const [openGroups, setOpenGroups] = useState(null);
  useEffect(() => {
    // Held, not spent: `appUpdatedFrom` is left alone and markVersionSeen() is not
    // called, so the popup still appears the moment they leave this route.
    if (silenced) return;
    if (DUMMY_MODE) {
      setOpen(true);
      return;
    }
    if (!appUpdatedFrom) return;
    // Version bumped without a changelog entry for it — nothing to show, just advance.
    if (changelogSince(appUpdatedFrom).length === 0) {
      markVersionSeen();
      setAppUpdatedFrom(null);
      return;
    }
    setOpen(true);
  }, [appUpdatedFrom, setAppUpdatedFrom, silenced]);

  // Lock the page behind the popup so the scroll wheel never scrolls the site.
  // Must honour `silenced` too: a popup that is open but not rendered would
  // otherwise leave the page underneath unscrollable with nothing to close.
  useEffect(() => {
    if (!open || silenced) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [open, silenced]);

  // Also covers arriving at a silenced route with the popup already up: it goes
  // away, and comes back on the way out, because `open` is never cleared here.
  if (!open || silenced) return null;

  const entries = DUMMY_MODE ? CHANGELOG : changelogSince(appUpdatedFrom);
  if (entries.length === 0) return null;
  const groups = groupChangelog(entries);
  const opened = openGroups || initiallyOpen(groups, entries.length);
  const toggle = (category) => {
    const next = new Set(opened);
    if (next.has(category)) next.delete(category); else next.add(category);
    setOpenGroups(next);
  };

  const close = () => {
    setOpen(false);
    if (!DUMMY_MODE) {
      markVersionSeen(); // write the version only AFTER the popup has been shown
      setAppUpdatedFrom(null);
    }
  };

  return (
    <div className="changelog-overlay">
      <div className="changelog-modal" role="dialog" aria-modal="true">
        <button className="changelog-close" onClick={close} aria-label={t('common.actions.close')}>
          <IoClose />
        </button>

        <div className="changelog-header">
          <img className="changelog-logo" src={theme === 'dark' ? logoDark : logo} alt="3Speak" />
          <h2>{t('app.changelog.title')}</h2>
          <p className="changelog-subtitle">{t('app.changelog.subtitle', { version: APP_VERSION })}</p>
        </div>

        <div className="changelog-body">
          {groups.map(({ category, entries: list }) => {
            const Icon = CATEGORY_ICONS[category] || MdAutoAwesome;
            const isOpen = opened.has(category);
            const panelId = `changelog-group-${category}`;
            return (
              <section className={`changelog-group${isOpen ? ' open' : ''}`} key={category}>
                <button type="button" className="changelog-group-head" aria-expanded={isOpen} aria-controls={panelId} onClick={() => toggle(category)}>
                  <span className="changelog-group-icon"><Icon /></span>
                  <span className="changelog-group-name">{t(`app.changelog.categories.${category}`)}</span>
                  <span className="changelog-group-count">{list.length}</span>
                  <MdExpandMore className="changelog-group-chevron" aria-hidden="true" />
                </button>
                {isOpen && (
                  <div className="changelog-group-list" id={panelId}>
                    {list.map((entry) => (
                      <div className="changelog-entry" key={entry.version}>
                        <div className="changelog-entry-meta">
                          <span className="changelog-entry-version">v{entry.version}</span>
                          {entry.date && <span className="changelog-entry-date">{timeAgo(entry.date)}</span>}
                        </div>
                        <p className="changelog-entry-summary">{entry.summary}</p>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>

        <div className="changelog-footer">
          <a
            className="changelog-repo"
            href="https://github.com/Mantequilla-Soft/new-3speak-tv/tree/production"
            target="_blank"
            rel="noopener noreferrer"
          >
            <IoLogoGithub />
            <span>{t('app.changelog.readTheCode')}</span>
          </a>
          <button className="changelog-cta" onClick={close}>
            <IoCheckmarkCircle />
            <span>{t('app.changelog.gotIt')}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
