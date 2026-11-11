import { useEffect, useState } from "react";
import { useTranslation, Trans } from "react-i18next";
import { Banner } from "../v2/ui";
import "./Select.scss";

const VideoPreview = ({ file }) => {
  useTranslation();
  const [objectUrl, setObjectUrl] = useState(null);
  const [previewError, setPreviewError] = useState(false);

  useEffect(() => {
    if (file) {
      setPreviewError(false);
      const url = URL.createObjectURL(file);
      setObjectUrl(url);
      return () => URL.revokeObjectURL(url);
    }
  }, [file]);

  if (!objectUrl) return null;

  // Browsers can't decode some codecs (e.g. HEVC/H.265 from iPhones) for an
  // inline preview, even though the file uploads and is transcoded fine.
  if (previewError) {
    return (
      <Banner tone="neutral" icon="movie_off" className="video-preview-fallback studio-preview-note">
        <Trans i18nKey="studio.preview.cannotPreview" components={{ b: <b /> }} />
      </Banner>
    );
  }

  return (
    <video
      src={objectUrl}
      controls
      width="100%"
      className="studio-preview"
      onError={() => setPreviewError(true)}
    />
  );
};

export default VideoPreview
