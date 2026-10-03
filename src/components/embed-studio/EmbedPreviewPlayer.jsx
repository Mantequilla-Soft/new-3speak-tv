import { useEffect, useState } from "react";
import { FileVideo, Play } from "lucide-react";
import { useTranslation } from "react-i18next";

// Preview-step stand-in for the final 3Speak player. The published body starts
// with the embed URL, which renders as the video player at the top of the post;
// here we emulate that with the locally-selected file. Until the user hits play
// we show the thumbnail (the poster the published player would show), matching
// what viewers see before they start the video.
const EmbedPreviewPlayer = ({ file, poster, portrait = false }) => {
  const { t } = useTranslation();
  const [objectUrl, setObjectUrl] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [previewError, setPreviewError] = useState(false);

  useEffect(() => {
    if (!file) {
      setObjectUrl(null);
      return;
    }
    setPreviewError(false);
    const url = URL.createObjectURL(file);
    setObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const cls = `ep-player${portrait ? " ep-player--portrait" : ""}`;

  // Poster state — thumbnail with a play button, until the user clicks it.
  if (poster && !playing) {
    return (
      <div className={cls}>
        <button
          type="button"
          className="ep-player__poster"
          onClick={() => setPlaying(true)}
          aria-label={t("upload.preview.playVideo")}
          disabled={!objectUrl}
        >
          <img src={poster} alt="" />
          {objectUrl && (
            <span className="ep-player__play">
              <Play size={30} fill="currentColor" />
            </span>
          )}
        </button>
      </div>
    );
  }

  // No local file to play (e.g. handed over from an external uploader) — fall
  // back to just the poster if we have one.
  if (!objectUrl) {
    return poster ? (
      <div className={cls}>
        <img className="ep-player__still" src={poster} alt="" />
      </div>
    ) : null;
  }

  // Browsers can't decode some codecs (e.g. HEVC/H.265 from iPhones) for an
  // inline preview, even though the file uploads and is transcoded fine.
  if (previewError) {
    return (
      <div className="video-preview-fallback" style={{ marginTop: 0 }}>
        <FileVideo className="video-preview-fallback-icon" />
        <p>
          {t("upload.preview.cannotPreviewHevc")}
        </p>
      </div>
    );
  }

  return (
    <div className={cls}>
      <video
        src={objectUrl}
        poster={poster || undefined}
        controls
        autoPlay={playing}
        onError={() => setPreviewError(true)}
      />
    </div>
  );
};

export default EmbedPreviewPlayer;
