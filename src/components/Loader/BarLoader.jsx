import { Icon } from '../v2/Icon';
import "./BarLoader.scss"

// A page-level loading state (STYLE_GUIDE §6/§11): the cyan progress glyph,
// centred in the space the page will take. Cyan, because loading is system work.
function BarLoader() {
  return (
    <div className="barloader-container" role="status" aria-busy="true">
      <Icon name="progress_activity" size={32} className="v2-spin barloader-icon" />
    </div>
  )
}

export default BarLoader
