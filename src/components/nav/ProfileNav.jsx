import { useEffect, useRef, useState } from 'react'
import "./ProfileNav.scss"
import { useAppStore } from '../../lib/store';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Icon } from '../v2/Icon';
import { Toggle } from '../v2/ui';
import { useGetMyQuery } from '../../hooks/getUserDetails';
import { readNavTabsOpen, setNavTabsOpen, useNavTabsOpen } from './navTabsPref';
import { useChat } from '../../context/ChatContext';
import { useServerUnread } from '../../hooks/useServerUnread';
import { getVotePower } from '../../utils/hiveUtils';
import { getHiveUrl, ensureHealthyNode } from '../../utils/hiveNode';
import { adsEnabledFor, VIDEO_IMPORT_ENABLED } from '../../utils/config';
import useCanImportVideos from '../../hooks/useCanImportVideos';
import SettingsModal from '../SettingsModal/SettingsModal';
import { useAvatarUrl } from '../../utils/avatarCache';
import { fetchBackfillSummary } from '../../lib/incubation';
import { fetchMyInviteLinks } from '../../lib/referralLinks';
import LeaderboardBadges from '../LeaderboardBadges/LeaderboardBadges';
import { usePwaInstall } from '../../utils/pwaInstall';
import { toastIn } from '../../utils/toast';
import { isTranslatorName } from '../../lib/translatorApi';

// Headed "Install", the same as the bottom bar's install hint.
const installToast = toastIn('Install');

// Unread chat messages, on the phone-only Chat row (the top bar has the
// button from tablets up). Mounted only once chat is connected.
function ChatUnread() {
  const { unreadCount } = useServerUnread();
  if (!unreadCount) return null;
  return <span className="profilenav-count num">{unreadCount > 9 ? '9+' : unreadCount}</span>;
}




// `pinned` false = a hover peek (useHoverPeek in App.jsx): the page stays usable
// around it and leaving it closes it. `leaving` = fading out.
function ProfileNav({ isVisible, pinned = true, leaving = false, hoverProps, onclose, openLoginModal }) {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate()
  const { user, LogOut } = useAppStore();
  const effectiveTheme = useAppStore((s) => s.getEffectiveTheme?.() || s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const tabsOpen = useNavTabsOpen();
  const chat = useChat();
  const my = useGetMyQuery();
  const incubationHandle = useAppStore((s) => s.incubationHandle);
  // No Hive account: voting power, resource credits, a wallet, analytics and
  // the advertiser console are all things that read or spend an account that
  // does not exist yet. Showing them was offering a menu of dead ends.
  const isIncubating = !user && !!incubationHandle;
  const canImport = useCanImportVideos(VIDEO_IMPORT_ENABLED ? user : null);

  // How many off-chain posts are still waiting to be published to Hive.
  //
  // Only a GRADUATED user has any: the backlog is the things they made before
  // the account existed. 0 for everyone else, and the entry is hidden rather
  // than shown empty -- a menu item leading to "nothing to publish" is a dead
  // end, which is the same reason the wallet and analytics rows are hidden
  // during the warm-up.
  const [backlogPending, setBacklogPending] = useState(0);
  useEffect(() => {
    if (!user) { setBacklogPending(0); return undefined; }
    let alive = true;
    fetchBackfillSummary()
      .then((sum) => { if (alive) setBacklogPending(Number(sum?.pending) || 0); })
      // 401 (not a butrauth identity) and 409 (never incubated) are the ORDINARY
      // answers for most users, not errors. Either way: no entry.
      .catch(() => { if (alive) setBacklogPending(0); });
    return () => { alive = false; };
  }, [user]);
  // Does 3Speak have this account down as a referrer? Only then is there an
  // "Invite links" entry. Hidden rather than shown empty for everybody else,
  // the same reasoning as the backlog entry above. Any failure (signed out,
  // Butter Auth unreachable) just means no entry.
  const [inviteLinkCount, setInviteLinkCount] = useState(0);
  // Translators (TRANSLATORS on the server) get a Translate entry in this menu.
  const [isTranslator, setIsTranslator] = useState(false);
  useEffect(() => {
    if (!user) { setIsTranslator(false); return undefined; }
    let alive = true;
    isTranslatorName(user).then((ok) => { if (alive) setIsTranslator(ok); });
    return () => { alive = false; };
  }, [user]);
  useEffect(() => {
    if (!user) { setInviteLinkCount(0); return undefined; }
    let alive = true;
    fetchMyInviteLinks()
      .then((d) => { if (alive) setInviteLinkCount((d?.links || []).length); })
      .catch(() => { if (alive) setInviteLinkCount(0); });
    return () => { alive = false; };
  }, [user]);
  // What to SHOW. Someone incubating has no Hive account, so `user` is null and
  // the panel rendered a blank name over a broken cover.
  const displayName = user || incubationHandle;
  const isManteAuth = localStorage.getItem("manteauth_login") === "true";
  // Serves a freshly uploaded picture instead of the cached hive proxy copy.
  const myAvatar = useAvatarUrl(user, null);
  const [votingPower, setVotingPower] = useState(0);
  const [rc, setRc] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { canInstallPrompt, isIOS, showInstall, promptInstall } = usePwaInstall();
  // Currently chosen Hive RPC node (auto-picked by the session probe).
  const [rpcNode, setRpcNode] = useState(getHiveUrl());
  useEffect(() => {
    let cancelled = false;
    ensureHealthyNode().then((u) => { if (!cancelled) setRpcNode(u || getHiveUrl()); });
    return () => { cancelled = true; };
  }, []);

  const handlewallletNavigation = () => {
    navigate(`/wallet/${user}`)
  }

  const fetchVotePower = async (user) => {
    try {
      const result = await getVotePower(user);
      if (result) {
        const { vp, rcPercent } = result;
        setRc(rcPercent.toFixed(2));
        setVotingPower((vp / 100).toFixed(2));
      }
    } catch (err) {
      console.error('Error fetching account:', err);
    }
  }
  useEffect(() => {
    if (!user) return;
    fetchVotePower(user);
  }, []);

  // Leaving the page closes the menu. On phones the bottom bar stays usable
  // while it is open, so a tap on Feeds or Shorts would otherwise navigate
  // underneath a menu that stays up.
  const openPath = useRef(null);
  useEffect(() => {
    if (!isVisible) { openPath.current = null; return; }
    if (openPath.current === null) { openPath.current = location.pathname; return; }
    if (openPath.current !== location.pathname) onclose();
  }, [isVisible, location.pathname, onclose]);

  // A dropdown closes on Escape, the same as every other menu people know.
  useEffect(() => {
    if (!isVisible) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onclose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isVisible, onclose]);

  const rpcHost = rpcNode.replace(/^https?:\/\//, '').replace(/\/$/, '');
  // The name people chose on their Hive profile, over the handle.
  const fullName = (user && my?.profile?.username === user && my.profile.name) || displayName;
  const initial = String(displayName || '').slice(0, 1).toUpperCase();
  const dark = effectiveTheme === 'dark';

  // One row of the menu: a Material Symbols icon and its label.
  const row = (icon, label, extra) => (<><Icon name={icon} size={18} className="pn-icon" /><span className="pn-label">{label}</span>{extra}</>);
  // One tile of the control centre (07d): icon 24 in its tone over a 12/500 label.
  const tile = (icon, label, tone) => (<><Icon name={icon} size={24} className={`pn-tile-icon${tone ? ` is-${tone}` : ''}`} /><span className="pn-label">{label}</span></>);

  return (
    // The account menu as a control centre (designs 07d, 42b): who you are with
    // a Switch, your voting power and resource credits, your six places as
    // tiles, the theme, then the rest as rows, 3Speak's socials, and Settings |
    // Log out along the bottom. Desktop: a card hanging from the avatar.
    // Phones and tablets: the same card as a sheet above the bottom bar.
    <div className={`profilenav-container${isVisible ? ' visible' : ''}${pinned ? '' : ' peek'}${leaving ? ' leaving' : ''}`} onClick={onclose}>
      <div className="profile-wrap" role="menu" aria-label={t('nav.profile.accountMenu')} onClick={(e) => e.stopPropagation()} {...hoverProps}>
        <div className="pn-grab" aria-hidden="true" />
        <div className="pn-header">
          <Link to="/profile" className="pn-avatar-link" onClick={onclose} aria-label={t('nav.profile.myChannelAria')}>
            {myAvatar ? <img className="pn-avatar" src={myAvatar} alt="" /> : <span className="pn-avatar is-initial" aria-hidden="true">{initial}</span>}
          </Link>
          <div className="pn-identity">
            <span className="pn-name">{fullName}</span>
            <span className="pn-handle">@{displayName}</span>
          </div>
          {/* For every login: wallet users get aioha's switcher (with their
              Butter Auth accounts added), Butter Auth users the login modal's
              own list (wallet accounts + other Butter Auth accounts). */}
          <button type="button" className="pn-switch" role="menuitem" aria-label={t('nav.profile.changeAccount')} title={t('nav.profile.changeAccount')} onClick={() => { onclose(); openLoginModal(); }}>
            {t('nav.profile.switch')}
          </button>
        </div>

        <div className="pn-scroll">
          {/* The same automatic badges the profile header shows (3Speak Pro plus
              leaderboard standings). The component renders nothing for an account
              holding none, and the wrapper then collapses. A badge is a link to its
              board, so following one closes the menu. */}
          {user && (
            <div className="pn-badges" onClick={(e) => { if (e.target.closest('a')) onclose(); }}>
              <LeaderboardBadges username={user} />
            </div>
          )}

          {!isIncubating && (
            <div className="pn-meters">
              <div className="pn-meter" title={t('nav.profile.vpTooltip')}>
                <div className="pn-meter-head">
                  <span className="pn-meter-label">{t('nav.profile.votingPower')}</span>
                  <strong className="num">{votingPower}%</strong>
                </div>
                <div className="pn-meter-track"><div className="pn-meter-fill" style={{ width: `${Math.min(100, Number(votingPower) || 0)}%` }} /></div>
              </div>
              <div className="pn-meter is-rc" title={t('nav.profile.rcTooltip')}>
                <div className="pn-meter-head">
                  <span className="pn-meter-label">{t('nav.profile.resourceCredits')}</span>
                  <strong className="num">{rc}%</strong>
                </div>
                <div className="pn-meter-track"><div className="pn-meter-fill" style={{ width: `${Math.min(100, Number(rc) || 0)}%` }} /></div>
              </div>
            </div>
          )}

          {/* Your places, as tiles (07d): Channel, Studio, Wallet / Playlists,
              History, Badges. */}
          <div className="pn-tiles">
            <Link to="/profile" className="pn-tile" role="menuitem" aria-label={t('nav.profile.myChannel')} onClick={onclose}>
              {tile('person', t('nav.profile.tiles.channel'))}
            </Link>
            <Link to="/draft" className="pn-tile" role="menuitem" onClick={onclose}>
              {tile('video_library', t('studio.drafts.title'), 'accent')}
            </Link>
            {!isIncubating && (
              <button type="button" className="pn-tile" role="menuitem" onClick={() => { handlewallletNavigation(); onclose() }}>
                {tile('account_balance_wallet', t('common.nav.wallet'))}
              </button>
            )}
            <Link to="/profile?tab=playlists" className="pn-tile" role="menuitem" onClick={onclose}>
              {tile('playlist_play', t('nav.playlists.label'), 'cyan')}
            </Link>
            {user && (
              <Link to={`/watched/${user}`} className="pn-tile" role="menuitem" aria-label={t('nav.playlists.watchHistory')} onClick={onclose}>
                {tile('history', t('nav.profile.tiles.history'))}
              </Link>
            )}
            {user && (
              <Link to={`/b/${user}`} className="pn-tile" role="menuitem" onClick={onclose}>
                {tile('military_tech', t('app.routes.badges'), 'accent')}
              </Link>
            )}
          </div>

          {/* The theme, as a switch on its own tile (07d) */}
          <div className="pn-theme">
            <Icon name="dark_mode" size={24} />
            <span className="pn-theme-label">{t('nav.profile.darkTheme')}</span>
            <Toggle
              checked={dark}
              label={dark ? t('nav.theme.switchToLight') : t('nav.theme.switchToDark')}
              onChange={(on) => setTheme(on ? 'dark' : 'light')}
            />
          </div>

          <div className="pn-section">
            {backlogPending > 0 && (
              <Link to="/publish-backlog" className="pn-item" role="menuitem" onClick={onclose}>
                {row('inventory_2', t('nav.profile.publishBacklog'), <span className="profilenav-count num">{backlogPending}</span>)}
              </Link>
            )}
            {!isIncubating && (
              <Link to="/profile?tab=stats" className="pn-item" role="menuitem" onClick={onclose}>
                {row('monitoring', t('nav.profile.analytics'))}
              </Link>
            )}
            {/* ▶️ Import your own videos from YouTube & co. (moved here from the profile
                header). Needs a Hive account to publish, so not for incubating users,
                and a verified link to a platform we import from. */}
            {VIDEO_IMPORT_ENABLED && !isIncubating && canImport && (
              <Link to="/youtube-import" className="pn-item" role="menuitem" onClick={onclose}>
                {row('move_to_inbox', t('ytimport.entry'))}
              </Link>
            )}
            {/* Closed testing. Same gate as the /advertise page itself, so the menu can
                never offer a link to a page that would answer with a 404. */}
            {!isIncubating && adsEnabledFor(user) && (
              <Link to="/advertise" className="pn-item" role="menuitem" onClick={onclose}>
                {row('campaign', t('nav.advertise'))}
              </Link>
            )}
            {inviteLinkCount > 0 && (
              <Link to="/invite-links" className="pn-item" role="menuitem" onClick={onclose}>
                {row('link', t('nav.profile.inviteLinks'))}
              </Link>
            )}
            {isTranslator && (
              <Link to="/translate" className="pn-item" role="menuitem" onClick={onclose}>
                {row('translate', t('translator.title'))}
              </Link>
            )}
            {/* Phones and tablets only: the sections the top bar's tabs and the
                bottom bar do not carry there. */}
            <Link to="/audio" className="pn-item pn-phone-only" role="menuitem" onClick={onclose}>
              {row('graphic_eq', t('nav.bottom.audio'))}
            </Link>
            <Link to="/live" className="pn-item pn-phone-only" role="menuitem" onClick={onclose}>
              {row('sensors', t('nav.tabs.live'))}
            </Link>
            {!(chat.warmup && !chat.ready) && (
              <Link to="/chat" className="pn-item pn-mobile-only" role="menuitem" onClick={onclose}>
                {row('chat_bubble', t('chat.button.label'), chat.ready ? <ChatUnread /> : null)}
              </Link>
            )}
            <Link to="/leaderboard" className="pn-item" role="menuitem" onClick={onclose}>
              {row('leaderboard', t('app.routes.rankings'))}
            </Link>
            {/* Phones and tablets only, and only where the app can actually be
                installed. iOS has no install prompt, so it gets the Share-sheet
                instructions. */}
            {showInstall && (
              <button
                type="button"
                className="pn-item pn-phone-only"
                role="menuitem"
                onClick={() => {
                  onclose();
                  if (canInstallPrompt) promptInstall();
                  else if (isIOS) installToast(t('nav.profile.iosInstallToast'), { icon: <Icon name="ios_share" size={18} /> });
                }}
              >
                {row('install_mobile', t('nav.installApp'))}
              </button>
            )}
          </div>

          {/* 42b: the small links, and the switch for the bar's section tabs */}
          <div className="pn-links">
            <Link to="/about" className="pn-link" role="menuitem" onClick={onclose}>{t('nav.aboutLink')}</Link>
            <Link to="/faq" className="pn-link" role="menuitem" onClick={onclose}>{t('nav.faqLink')}</Link>
            <span className="pn-links-gap" />
            <button
              type="button"
              className="pn-link is-strong pn-desktop-only"
              role="menuitem"
              aria-pressed={!tabsOpen}
              onClick={() => setNavTabsOpen(!readNavTabsOpen())}
            >
              {tabsOpen ? t('nav.hidePages') : t('nav.showPages')}
            </button>
          </div>

          <div className="pn-socials">
            {/* Brand names, not words to translate; the aria labels say where they go. */}
            <div className="support-wrap">
              <a href="https://discord.com/invite/NSFS2VGj83" className="social-link" target="_blank" rel="noopener noreferrer" aria-label={t('nav.profile.onDiscord')}>
                Discord
              </a>
              <a href="https://x.com/3speaktv?utm_source=3speak.tv " className="social-link" target="_blank" rel="noopener noreferrer" aria-label={t('nav.profile.onX')}>
                X
              </a>
              <a href="https://t.me/threespeak?utm_source=3speak.tv" className="social-link" target="_blank" rel="noopener noreferrer" aria-label={t('nav.profile.onTelegram')}>
                Telegram
              </a>
            </div>
            <div className="rpc-node-line" title={rpcNode}>
              <span className="rpc-node-dot" aria-hidden="true" />
              <span className="rpc-node-host">{rpcHost}</span>
            </div>
          </div>
        </div>

        {/* 07d: Settings and Log out along the bottom */}
        <div className="pn-footer">
          <button type="button" className="pn-foot-btn" role="menuitem" onClick={() => { setSettingsOpen(true); onclose(); }}>
            <Icon name="settings" size={20} /><span className="pn-label">{t('common.nav.settings')}</span>
          </button>
          {isManteAuth && (
            <button type="button" className="pn-foot-btn is-logout" role="menuitem" onClick={() => { LogOut(user); onclose(); navigate('/'); }}>
              <Icon name="logout" size={20} /><span className="pn-label">{t('nav.profile.logout')}</span>
            </button>
          )}
        </div>
      </div>

      {/* Portals to <body>, so it shows even though this container hides once the
          menu row that opened it closes the menu. */}
      <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}

export default ProfileNav
