import { useNavigate } from "react-router-dom";
import "./CommunitriesTags.scss"
import { useAppStore } from "../../lib/store";
import { toastIn } from '../../utils/toast';
import { useTranslation } from 'react-i18next';
import { Icon } from '../v2/Icon';
import 'react-toastify/dist/ReactToastify.css';

// Every toast from this module is headed "Community"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Community');

// Quick links into a few communities' tag feeds, as v2 filter chips, with the
// upload shortcut at the end. [label, tag, community name, hide class]
const TAGS = [
  ['splinterlands', 'hive-13323', 'Splinterlands', ''],
  ['vibes', 'hive-140169', 'Vibes', ''],
  ['music', 'hive-193816', 'Music', ''],
  ['ocd', 'hive-174578', 'Ocd', 'tags'],
  ['aliento', 'hive-110011', 'Aliento', 'tags'],
  ['spendhbd', 'hive-106130', 'Spendhbd', 'tags'],
  ['worldmappin', 'hive-163772', 'Worldmappin', 'tags tab-out'],
  ['LeoFinance', 'hive-167922', 'LeoFinance', 'tab-out'],
  ['openmic', 'leofinance', undefined, 'tags tab-out'],
  ['afritunes', 'leofinance', undefined, 'tags tab-out'],
];

function CommunitiesTags() {
  const { t } = useTranslation();
  const { authenticated } = useAppStore();
  const navigate = useNavigate();
  const handleSelectTag = (tag, name) => {
    navigate(`/t/${tag}`, {state: {commuintyName: name}});
  };
  const handleNavigate = ()=>{
    if(!authenticated){
      toast.error(t('communities.tags.loginToUpload'))
    }else{
      navigate(`/embed-studio`)
    }
  }
  return (
    <div className="wrap-community">
      <div className="wrap v2-chips">
        {TAGS.map(([label, tag, name, cls]) => (
          <button key={label} type="button" className={`v2-chip h28 ${cls}`} onClick={() => handleSelectTag(tag, name)}>
            {label}
          </button>
        ))}
      </div>

      <button
        type="button"
        className="v2-iconbtn v2-btn--primary h32 is-round wrap-upload-video"
        onClick={handleNavigate}
        aria-label={t('common.actions.upload')}
        title={t('common.actions.upload')}
      >
        <Icon name="videocam" size={18} />
      </button>
    </div>
  )
}

export default CommunitiesTags
