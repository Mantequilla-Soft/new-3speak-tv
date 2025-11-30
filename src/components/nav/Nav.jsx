import { GiToggles } from "react-icons/gi";
import logo from "../../assets/image/3S_logo.svg";
import "./nav.scss";
import { CiSearch } from "react-icons/ci";
import Sidebar from "../Sidebar/Sidebar";
import { Link, NavLink } from "react-router-dom";
import { useAppStore } from "../../lib/store";
import { useGetMyQuery } from "../../hooks/getUserDetails";
import { AiOutlineClose} from "react-icons/ai";
import { IoCloudUploadSharp } from "react-icons/io5";
import { MdOutlineDashboard, MdOutlineDynamicFeed, MdOutlineLeaderboard } from "react-icons/md";
import { FaFire, FaRegSmile } from "react-icons/fa";
import { LuNewspaper } from "react-icons/lu";
import apple_icon from "../../assets/image/app-store.png"
import play_store from "../../assets/image/playstore.png"
import { useEffect, useRef, useState } from "react";
import SearchList from "./SearchList";
import SearchList_Sm from "./SearchList_Sm";
import { TiThMenu } from "react-icons/ti";

function Nav({ setSideBar, toggleProfileNav }) {
  const { authenticated, LogOut, user } = useAppStore();
  const [nav, setNav] = useState(false)
  const [searchTerm, setSearchTerm] = useState('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const searchBoxRef = useRef(null);
  const [searchTermSm, setSearchTermSm] = useState('');
  const [isDropdownOpensm, setIsDropdownOpensm] = useState(false);
  const searchBoxRefsm = useRef(null);
   const sideNavRef = useRef(null); // Ref for the side nav container
  const menuIconRef = useRef(null); // Ref for the menu toggle button



  const handleNav = () =>{
    setNav((prev) => !prev);
   }

   useEffect(() => {
  const handleClickOutside = (e) => {
    // Check if:
    // 1. Nav is open
    // 2. Click is outside side nav
    // 3. Click is outside menu icon (if ref exists)
    if (nav && 
        sideNavRef.current && 
        !sideNavRef.current.contains(e.target) && 
        (!menuIconRef.current || !menuIconRef.current.contains(e.target))) {
      setNav(false);
    }
  };

  document.addEventListener('click', handleClickOutside, true);

  return () => {
    document.removeEventListener('click', handleClickOutside, true);
  };
}, [nav]);





  return (
    <nav className="nav-container">
      <div className="nav-left flex-dev">
        <TiThMenu size={25} className="menu-icon" onClick={() => setSideBar((prev) => (prev === false ? true : false))}/>
        <Link to="/"><img className="logo" src={logo} alt="" /></Link>
      </div>
      
      <div className="phone-nav-left" ref={menuIconRef} >
        <TiThMenu size={25} className="menu-icon" onClick={handleNav} />
        <Link to="/"><img className="logo" src={logo} alt="" /></Link>
      </div>
      <div className="nav-middle flex-dev">
        <div className="search-wrapper" >
          <span className="search-icon" ref={searchBoxRef}>
            <svg xmlns="http://www.w3.org/2000/svg" className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="7"></circle>
              <path d="m16 16 4 4"></path>
            </svg>
          </span>
          <input onFocus={() => setIsDropdownOpen(true)} value={searchTerm} onChange={(e)=> setSearchTerm(e.target.value.toLowerCase()) } type="search" placeholder="Search users or communities..." className="search-input" />
        </div>




        <SearchList searchTerm={searchTerm} setSearchTerm={setSearchTerm} searchBoxRef={searchBoxRef} isDropdownOpen={isDropdownOpen} setIsDropdownOpen={setIsDropdownOpen} />
      </div>
      <div className={nav ? "side-nav" : "side-nav-else"} ref={sideNavRef}>
      <AiOutlineClose className="close-nav" onClick={handleNav}/> 

      <div >
            <div className="shortcut-links" >

            <div className="search-wrap-sm" >
                <div className="wrap" ref={searchBoxRefsm}>
                 <input onFocus={() => setIsDropdownOpensm(true)} type="text" value={searchTermSm}  onChange={(e)=> setSearchTermSm(e.target.value.toLowerCase()) } />
                 <CiSearch size={20} color="green" />
                </div>
                <SearchList_Sm searchTerm={searchTermSm} setSearchTerm={setSearchTermSm} handleNav={handleNav} searchBoxRefsm={searchBoxRefsm} isDropdownOpensm={isDropdownOpensm} setIsDropdownOpensm={setIsDropdownOpensm} />
              </div>
              <Link to="/" className="side-link-n" onClick={handleNav}>
                <MdOutlineDashboard className="icon" /> <span>Home</span>
              </Link>
              {authenticated && <Link to="/studio" className="side-link-n" onClick={handleNav}>
                <IoCloudUploadSharp className="icon" /> <span>Upload Video</span>
              </Link>}
              <Link to="/firstupload" className="side-link-n" onClick={handleNav}>
                <FaRegSmile className="icon"/> <span>First Uploads</span>
              </Link>
              
              <Link to="/trend" className="side-link-n" onClick={handleNav}>
                <FaFire className="icon" /> <span>Trending Content</span>
              </Link> 
              <Link to="/new" className="side-link-n" onClick={handleNav}>
                <LuNewspaper className="icon" /> <span>New Content</span>
              </Link>
              <Link to="/communities" className="side-link-n" onClick={handleNav}>
                <MdOutlineDynamicFeed className="icon" /> <span>Communities</span>
              </Link>
              {/* <Link to="/leaderboard" className="side-link-n" onClick={handleNav}>
                <MdOutlineLeaderboard className="icon" /> <span>Leaderboard</span>
              </Link> */}
              <Link to="/about" className="side-link-n" onClick={handleNav}>
                <MdOutlineLeaderboard className="icon" /> <span>About</span>
              </Link>
              {/* <div className="side-link-n" onClick={handleNav}>
                <HiInformationCircle className="icon" /> <span>About 3speak</span>
              </div> */}
              

          
      
              <hr />
            </div>
            <div className="subscibed-list">
              <h3>Download</h3>
              <div className="side-link-n">
                <img src={apple_icon} alt=""className="store-icon" /> <span>Apple Store</span>
              </div>
              <div className="side-link-n">
              <img src={play_store} alt=""className="store-icon" /> <span>Play Store</span>
              </div>
              
              
            </div>
          </div>
      </div>




      {authenticated ? (
        <div className="nav-right flex-div">
          <span>{user}</span>
          {/* <IoIosNotifications size={20} /> */}
          
          <img src={`https://images.hive.blog/u/${user}/avatar`} alt="" onClick={toggleProfileNav} />
          {/* <div className="dropdown-menu">
            <Link className="list">My Channel</Link>
            <Link className="list">Upload Video</Link>
            <Link className="list">PlayList</Link>
            <Link to="/wallet" className="list" >Wallet</Link>
            <Link className="list" >Logout</Link>
          </div> */}
        </div>
      ) : (
        <>
          <Link to="/login">
            <button>LOG IN</button>
          </Link>
        </>
      )}
    </nav>
  );
}

export default Nav;
