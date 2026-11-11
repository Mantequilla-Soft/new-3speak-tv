import { Link } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { Icon } from "../components/v2/Icon"
import "./Uploadvideo.scss"

// /upload: the studio start (design 44c). Continue the draft, or start a new
// video in the uploader; under them the note on files the browser can't
// preview. The choices are tiles: the new video is the one picked out.
function UploadVideo() {
  const { t } = useTranslation()

  return (
    <div className="upload-start">
      <div className="upload-start__card">
        <h1 className="upload-start__title">{t("upload.page.shareVideo")}</h1>

        <Link to="/draft" className="upload-start__choice">
          <span className="upload-start__icon"><Icon name="edit_note" size={22} /></span>
          <span className="upload-start__text">
            <b>{t("studio.select.editDraft")}</b>
            <span>{t("studio.select.editDraftDesc")}</span>
          </span>
          <Icon name="chevron_right" size={20} className="upload-start__chev" />
        </Link>

        <div className="upload-start__or">{t("studio.select.or")}</div>

        <Link to="/studio" className="upload-start__choice is-on">
          <span className="upload-start__icon"><Icon name="upload" size={22} /></span>
          <span className="upload-start__text">
            <b>{t("studio.select.createNew")}</b>
            <span>{t("studio.select.createNewDesc")}</span>
          </span>
          <Icon name="arrow_forward" size={20} className="upload-start__chev" />
        </Link>

        <p className="upload-start__note">
          <Icon name="info" size={18} />
          <span>{t("upload.preview.cannotPreviewHevc")}</span>
        </p>
      </div>
    </div>
  )
}

export default UploadVideo
