import React, { useEffect, useRef, useState } from 'react'
import "./ProfileNav.scss"
import '../../page/Login/KeyChainLogin.scss';
import { useAppStore } from '../../lib/store';
import { useGetMyQuery } from '../../hooks/getUserDetails';
import { MdKeyboardArrowDown, MdOutlineKeyboardArrowUp, MdSettings, MdTrendingUp, MdCampaign, MdChevronRight } from "react-icons/md";
import { ImPower } from "react-icons/im";
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { FaDiscord, FaLanguage } from 'react-icons/fa';
import { IoPower } from 'react-icons/io5';
import { FaCheckToSlot, FaJxl, FaSquareXTwitter } from 'react-icons/fa6';
import { TiThList } from "react-icons/ti";
import { IoMdPerson } from 'react-icons/io';
import { HiInformationCircle } from 'react-icons/hi';
import { RiWallet3Fill } from 'react-icons/ri';
import logo from "../../assets/image/3S_logo.svg";
import logoDark from '../../assets/image/3S_logodark.png';
import { SiTelegram } from "react-icons/si";
import { getVotePower } from '../../utils/hiveUtils';
import { getHiveUrl, ensureHealthyNode } from '../../utils/hiveNode';
import { adsEnabledFor } from '../../utils/config';
import LabeledToggle from '../LabeledToggle/LabeledToggle';
import SettingsModal from '../SettingsModal/SettingsModal';
import { useAvatarUrl } from '../../utils/avatarCache';




function ProfileNav({ isVisible, onclose, toggleAddAccount, openLoginModal }) {
  const location = useLocation();
  const navigate = useNavigate()
  const { user, theme, showNsfw, setShowNsfw, toggleTheme, sidebarHidden, setSidebarHidden, LogOut } = useAppStore();
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

  return (

    <div className={`profilenav-container ${isVisible ? 'visible' : ''}`} onClick={onclose}>
      <div className="profile-wrap" onClick={(e) => e.stopPropagation()}>
        {/* Was a bare letter "X" at 16px in the top-right corner, sitting on
            whatever cover photo the account happens to have. This is a real
            button on the edge the panel slides back through. */}
        <button type="button" className="profilenav-close" onClick={onclose} aria-label="Close menu">
          <MdChevronRight />
        </button>

        <div className='pro-top-wrap'style={{ backgroundImage: `url(https://images.hive.blog/u/${user}/cover)`, backgroundSize: "cover", backgroundPosition: "center",}}> 
            {/* <img className='' src={getUserProfile?.images?.cover} alt="" /> */}
            <img className='avatar-img' src={myAvatar}  alt="" />
            <span className='username'>{user}</span>
            <div className="power-wrap">
            <div className="wrap-in">
              <div className="wrap">
                <MdOutlineKeyboardArrowUp />
                <span>{votingPower}% {" "} VP</span>
              </div>
              <div className="tooltip">
                Voting Power
                <div className="tooltip-arrow"></div>
              </div>
            </div>
            <div className="wrap-in">
              <div className="wrap">
              <MdKeyboardArrowDown />
              <span>{rc}% {" "} RC</span>
              </div>
              <div className="tooltip">
                Resource Credit
                <div className="tooltip-arrow"></div>
              </div>
              </div>

            </div>
           </div>
        <div className="list-wrap">
          <Link to="/profile" className="wrap" onClick={onclose}>
            <IoMdPerson className="icon" /> <span>My Channel</span>
          </Link>
          <Link to="/profile?tab=stats" className="wrap" onClick={onclose}>
            <MdTrendingUp className="icon" /> <span>Analytics</span>
          </Link>
          {/* <Link className="wrap" onClick={onclose}>
            <TiThList className="icon" /> <span>Playlist</span>
          </Link> */}

          <a className="wrap" onClick={() => { handlewallletNavigation(); onclose() }}>
            <RiWallet3Fill className="icon" /> <span>Wallet</span>
          </a>
          {/* <Link className="wrap">
            <FaLanguage className="icon" /> <span>Language Settings</span>
          </Link> */}
          {/* Closed testing. Same gate as the /advertise page itself, so the menu can
              never offer a link to a page that would answer with a 404. */}
          {adsEnabledFor(user) && (
            <Link to="/advertise" className="wrap" onClick={onclose}>
              <MdCampaign className="icon" /> <span>Advertise</span>
            </Link>
          )}
          <a className="wrap" onClick={() => { setSettingsOpen(true); onclose(); }}>
            <MdSettings className="icon" /> <span>Settings</span>
          </a>
          <Link to="/about" className="wrap" onClick={onclose}>
            <HiInformationCircle className="icon" /> <span>About 3Speak</span>
          </Link>
          {/* Hidden for ButrAuth sessions: the account switcher is aioha-only and
              there is no path yet between a ButrAuth session and an aioha wallet.
              Until ButrAuth is available as an aioha provider, offering the switch
              would just strand the user. */}
          {!isManteAuth && (
            <a className="wrap" onClick={() => { onclose(); openLoginModal(); }}>
              <IoPower className="icon" /> <span>Change account</span>
            </a>
          )}
          {isManteAuth && (
            <a className="wrap" onClick={() => { LogOut(user); onclose(); navigate('/'); }}>
              <IoPower className="icon" /> <span>Logout</span>
            </a>
          )}

           </div>
           <hr className="profile-divider" />
           <div className="rpc-node-line" title={rpcNode}>
             <span className="rpc-node-dot" aria-hidden="true" />
             <span className="rpc-node-label">RPC:</span>
             <span className="rpc-node-host">{rpcNode.replace(/^https?:\/\//, '').replace(/\/$/, '')}</span>
           </div>
           <div className="logo-wrap">
          {theme === "light" ? <img className="logo" src={logo} alt="3Speak Logo" /> :
            <img className="logo" src={logoDark} alt="3Speak Logo" />}
           </div>
        <div className="support-wrap">
          <a href="https://discord.com/invite/NSFS2VGj83" className="social-link" target="_blank" rel="noopener noreferrer">
            <FaDiscord size={30} />
          </a>
          <a href="https://x.com/3speaktv?utm_source=3speak.tv " className="social-link" target="_blank" rel="noopener noreferrer">
            <FaSquareXTwitter size={30} />
          </a>
          <a href="https://t.me/threespeak?utm_source=3speak.tv" className="social-link" target="_blank" rel="noopener noreferrer">
            <SiTelegram size={30} />
          </a>

        </div>
           

           <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />

        
      </div>
    </div>
  )
}

export default ProfileNav