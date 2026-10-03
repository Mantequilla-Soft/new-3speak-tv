import { useEffect, useState } from "react";
import { FileVideo } from "lucide-react";
import { useTranslation } from "react-i18next";

 const VideoPreview = ({ file }) => {
  const { t } = useTranslation();
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
      <div className="video-preview-fallback" style={{ marginTop: "1rem" }}>
        <FileVideo className="video-preview-fallback-icon" />
        <p>
          {t('studio.preview.cannotPreview')}
        </p>
      </div>
    );
  }

  return (
    <video
      src={objectUrl}
      controls
      width="100%"
      style={{ marginTop: "1rem", borderRadius: "10px" }}
      onError={() => setPreviewError(true)}
    />
  );
};

export default VideoPreview
