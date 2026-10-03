import React from "react";
import "./Select.scss";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
function Select() {
  const { t } = useTranslation();
  return (
    <div className="select-container">
      <div className="main-option">
        <Link to="/draft" className="draft-wrap">
          <div className="icon group-hover">
            <i className="fas fa-edit group-hover"></i>
          </div>
          <h3>{t('studio.select.editDraft')}</h3>
          <p className="">
            {t('studio.select.editDraftDesc')}
          </p>
        </Link>
        <span className="or">{t('studio.select.or')}</span>
        <Link to="/studio">
          <div className="draft-wrap">
          
          <div className="icon group-hover">
          <i className="fas fa-cloud-upload-alt group-hover"></i>
          </div>
            <h3>{t('studio.select.createNew')}</h3>
            <p className="video-options__desc group-hover">
            {t('studio.select.createNewDesc')}
          </p>
          </div>
        </Link>
      </div>
    </div>
  );
}

export default Select;
