import React, { useEffect, useRef, useState } from 'react'
import "./ProfileNav.scss"
import '../../page/Login/KeyChainLogin.scss';
import { useAppStore } from '../../lib/store';
import { useGetMyQuery } from '../../hooks/getUserDetails';
import { MdSettings, MdTrendingUp, MdCampaign, MdCloudUpload, MdPersonAdd } from "react-icons/md";
import { ImPower } from "react-icons/im";
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { FaDiscord, FaLanguage } from 'react-icons/fa';
import { IoPower } from 'react-icons/io5';
import { FaCheckToSlot, FaJxl, FaSquareXTwitter } from 'react-icons/fa6';
import { TiThList } from "react-icons/ti";
import { IoMdPerson } from 'react-icons/io';
import { HiInformationCircle } from 'react-icons/hi';
import { RiWallet3Fill } from 'react-icons/ri';
import { SiTelegram } from "react-icons/si";
import { getVotePower } from '../../utils/hiveUtils';
import { getHiveUrl, ensureHealthyNode } from '../../utils/hiveNode';
import { adsEnabledFor } from '../../utils/config';
import LabeledToggle from '../LabeledToggle/LabeledToggle';
import SettingsModal from '../SettingsModal/SettingsModal';
import { useAvatarUrl } from '../../utils/avatarCache';
import { fetchBackfillSummary } from '../../lib/incubation';
import { fetchMyInviteLinks } from '../../lib/referralLinks';
import LeaderboardBadges from '../LeaderboardBadges/LeaderboardBadges';




function ProfileNav({ isVisible, onclose, toggleAddAccount, openLoginModal }) {
  const location = useLocation();
  const navigate = useNavigate()
  const { user, showNsfw, setShowNsfw, toggleTheme, LogOut } = useAppStore();
  const incubationHandle = useAppStore((s) => s.incubationHandle);
  // No Hive account: voting power, resource credits, a wallet, analytics and
  // the advertiser console are all things that read or spend an account that
  // does not exist yet. Showing them was offering a menu of dead ends.
  const isIncubating = !user && !!incubationHandle;

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

  // A dropdown closes on Escape, the same as every other menu people know.
  useEffect(() => {
    if (!isVisible) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onclose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isVisible, onclose]);

  const rpcHost = rpcNode.replace(/^https?:\/\//, '').replace(/\/$/, '');

  return (
    // Desktop: a dropdown hanging from the avatar, like every account menu people
    // already know. Phone: a bottom sheet. The cover photo that used to fill the
    // top was dropped on purpose: it was the loudest thing on screen and said
    // nothing about what the menu does.
    <div className={`profilenav-container ${isVisible ? 'visible' : ''}`} onClick={onclose}>
      <div className="profile-wrap" role="menu" aria-label="Account menu" onClick={(e) => e.stopPropagation()}>
        <div className="pn-header">
          <Link to="/profile" className="pn-avatar-link" onClick={onclose} aria-label="My channel">
            <img className="pn-avatar" src={myAvatar} alt="" />
          </Link>
          <div className="pn-identity">
            <span className="pn-name">{displayName}</span>
            <span className="pn-handle">@{displayName}</span>
          </div>
        </div>

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
            <div className="pn-meter" title="Voting Power: how much weight your next vote carries">
              <span className="pn-meter-label">VP</span>
              <div className="pn-meter-track"><div className="pn-meter-fill" style={{ width: `${Math.min(100, Number(votingPower) || 0)}%` }} /></div>
              <strong>{votingPower}%</strong>
            </div>
            <div className="pn-meter" title="Resource Credits: what your actions on Hive cost">
              <span className="pn-meter-label">RC</span>
              <div className="pn-meter-track"><div className="pn-meter-fill" style={{ width: `${Math.min(100, Number(rc) || 0)}%` }} /></div>
              <strong>{rc}%</strong>
            </div>
          </div>
        )}

        <div className="pn-section">
          <Link to="/profile" className="pn-item" role="menuitem" onClick={onclose}>
            <IoMdPerson className="pn-icon" /> <span>My Channel</span>
          </Link>
          {backlogPending > 0 && (
            <Link to="/publish-backlog" className="pn-item" role="menuitem" onClick={onclose}>
              <MdCloudUpload className="pn-icon" />
              <span>Publish backlog</span>
              <span className="profilenav-count">{backlogPending}</span>
            </Link>
          )}
          {!isIncubating && (
            <button type="button" className="pn-item" role="menuitem" onClick={() => { handlewallletNavigation(); onclose() }}>
              <RiWallet3Fill className="pn-icon" /> <span>Wallet</span>
            </button>
          )}
          <button type="button" className="pn-item" role="menuitem" onClick={() => { setSettingsOpen(true); onclose(); }}>
            <MdSettings className="pn-icon" /> <span>Settings</span>
          </button>
        </div>

        <div className="pn-section">
          {!isIncubating && (
            <Link to="/profile?tab=stats" className="pn-item" role="menuitem" onClick={onclose}>
              <MdTrendingUp className="pn-icon" /> <span>Analytics</span>
            </Link>
          )}
          {/* Closed testing. Same gate as the /advertise page itself, so the menu can
              never offer a link to a page that would answer with a 404. */}
          {!isIncubating && adsEnabledFor(user) && (
            <Link to="/advertise" className="pn-item" role="menuitem" onClick={onclose}>
              <MdCampaign className="pn-icon" /> <span>Advertise</span>
            </Link>
          )}
          {inviteLinkCount > 0 && (
            <Link to="/invite-links" className="pn-item" role="menuitem" onClick={onclose}>
              <MdPersonAdd className="pn-icon" /> <span>Invite links</span>
            </Link>
          )}
          <Link to="/about" className="pn-item" role="menuitem" onClick={onclose}>
            <HiInformationCircle className="pn-icon" /> <span>About 3Speak</span>
          </Link>
        </div>

        <div className="pn-section">
          {/* Hidden for ButrAuth sessions: the account switcher is aioha-only and
              there is no path yet between a ButrAuth session and an aioha wallet.
              Until ButrAuth is available as an aioha provider, offering the switch
              would just strand the user. */}
          {!isManteAuth && (
            <button type="button" className="pn-item" role="menuitem" onClick={() => { onclose(); openLoginModal(); }}>
              <IoPower className="pn-icon" /> <span>Change account</span>
            </button>
          )}
          {isManteAuth && (
            <button type="button" className="pn-item" role="menuitem" onClick={() => { LogOut(user); onclose(); navigate('/'); }}>
              <IoPower className="pn-icon" /> <span>Logout</span>
            </button>
          )}
        </div>

        <div className="pn-footer">
          <div className="rpc-node-line" title={rpcNode}>
            <span className="rpc-node-dot" aria-hidden="true" />
            <span className="rpc-node-host">{rpcHost}</span>
          </div>
          <div className="support-wrap">
            <a href="https://discord.com/invite/NSFS2VGj83" className="social-link" target="_blank" rel="noopener noreferrer" aria-label="3Speak on Discord">
              <FaDiscord />
            </a>
            <a href="https://x.com/3speaktv?utm_source=3speak.tv " className="social-link" target="_blank" rel="noopener noreferrer" aria-label="3Speak on X">
              <FaSquareXTwitter />
            </a>
            <a href="https://t.me/threespeak?utm_source=3speak.tv" className="social-link" target="_blank" rel="noopener noreferrer" aria-label="3Speak on Telegram">
              <SiTelegram />
            </a>
          </div>
        </div>
      </div>

      {/* Portals to <body>, so it shows even though this container hides once the
          menu row that opened it closes the menu. */}
      <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}

export default ProfileNav