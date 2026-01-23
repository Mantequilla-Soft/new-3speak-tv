
import { Link, useNavigate } from "react-router-dom";
import "./CommunitriesTags.scss"
import { FaVideo } from 'react-icons/fa'
import { useAppStore } from "../../lib/store";
import {  toast } from 'sonner'
import 'react-toastify/dist/ReactToastify.css';
function CommunitiesTags() {
  const { authenticated } = useAppStore();
  const navigate = useNavigate();
  const handleSelectTag = (tag, name) => {
    navigate(`/t/${tag}`, {state: {commuintyName: name}});
  };
  const handleNavigate = ()=>{
    if(!authenticated){
      toast.error("Login to upload video")
    }else{
      navigate(`/studio`)
    }
  }
  return (
    <div className="wrap-community">
        <div className="wrap">
        <span onClick={()=>{handleSelectTag("hive-13323", "Splinterlands")}}>splinterlands</span>
        <span onClick={()=>{handleSelectTag("hive-140169", "Vibes")}}>vibes</span>
        <span onClick={()=>{handleSelectTag("hive-193816", "Music")}}>music</span>
        <span className="tags" onClick={()=>{handleSelectTag("hive-174578", "Ocd")}}>ocd</span>
        <span className="tags"onClick={()=>{handleSelectTag("hive-110011", "Aliento")}}>aliento</span>
        <span className="tags" onClick={()=>{handleSelectTag("hive-106130", "Spendhbd")}}>spendhbd</span>
        <span className="tags tab-out"onClick={()=>{handleSelectTag("hive-163772", "Worldmappin")}}>worldmappin</span>
        <span className="tab-out" onClick={()=>{handleSelectTag("hive-167922", "LeoFinance")}}>LeoFinance</span>
        {/* <span>garden</span>
        <span>motivation</span>
        <span>Qurator</span>
        <span>Foodies Bee Hive</span>
        <span>LeoFinance</span>
        <span>garden</span>
        <span>motivation</span>
        <span>Qurator</span> */}
        <span className="tags tab-out" onClick={()=>{handleSelectTag("leofinance")}}>openmic</span>
        <span className="tags tab-out" onClick={()=>{handleSelectTag("leofinance")}}>afritunes</span>
        </div>

        <div className="wrap-upload-video" onClick={handleNavigate}>
        <FaVideo />
        </div>

    </div>
  )
}

export default CommunitiesTags