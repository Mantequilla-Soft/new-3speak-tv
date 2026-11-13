import { Link } from "react-router-dom"
import { useTranslation } from "react-i18next"
import "./Uploadvideo.scss"

// /upload: the studio start (design 44c). Continue the draft, or start a new
// video in the uploader. The choices are tiles: the new video is the one
// picked out. (44c's HEVC note is the studio preview's state: VideoPreview
// shows it once a picked file can't play, not here before there is a file.)
function UploadVideo() {
  const { t } = useTranslation()

  return (
    <div className="upload-start">
      <div className="upload-start__card">
        {/* 44c draws the two choices and the note only; the name stays for screen readers. */}
        <h1 className="upload-start__title">{t("upload.page.shareVideo")}</h1>

        <Link to="/draft" className="upload-start__choice">
          <span className="upload-start__text">
            <b>{t("studio.select.editDraft")}</b>
            <span>{t("studio.select.editDraftDesc")}</span>
          </span>
        </Link>

        <div className="upload-start__or">{t("studio.select.or")}</div>

        <Link to="/studio" className="upload-start__choice is-on">
          <span className="upload-start__text">
            <b>{t("studio.select.createNew")}</b>
            <span>{t("studio.select.createNewDesc")}</span>
          </span>
        </Link>
      </div>
    </div>
  )
}

export default UploadVideo
