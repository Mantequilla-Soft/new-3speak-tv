import "./Select.scss";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Icon } from "../v2/Icon";

// Studio start (44c): edit a draft, or create a new video. Two choice tiles in
// one card; "Create" is the primary choice, so it carries the accent.
function Select() {
  const { t } = useTranslation();
  return (
    <div className="select-container">
      <div className="main-option">
        <Link to="/draft" className="draft-wrap">
          <span className="draft-wrap__icon"><Icon name="edit_note" size={22} /></span>
          <span className="draft-wrap__body">
            <b>{t('studio.select.editDraft')}</b>
            <span>{t('studio.select.editDraftDesc')}</span>
          </span>
          <Icon name="arrow_forward" size={18} className="draft-wrap__go" />
        </Link>
        <span className="or">{t('studio.select.or')}</span>
        <Link to="/studio" className="draft-wrap is-primary">
          <span className="draft-wrap__icon"><Icon name="upload" size={22} /></span>
          <span className="draft-wrap__body">
            <b>{t('studio.select.createNew')}</b>
            <span>{t('studio.select.createNewDesc')}</span>
          </span>
          <Icon name="arrow_forward" size={18} className="draft-wrap__go" />
        </Link>
      </div>
    </div>
  );
}

export default Select;
