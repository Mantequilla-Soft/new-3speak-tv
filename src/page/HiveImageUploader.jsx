// HiveImageUploader.jsx — standalone image uploader (/image).
// Uploads through the shared image pipeline: the @threespeak backend signs the
// hive.blog challenge server-side (works for every login, no pasted keys), with
// fallbacks to user-signed hive.blog / the 3Speak image server.
import { useState, useRef } from 'react';
import './HiveImageUploader.scss';
import { uploadThumbnail } from '../utils/uploadThumbnail';
import { useTranslation } from 'react-i18next';
import { Button, Icon } from '../components/v2/ui';

const HiveImageUploader = () => {
  const { t } = useTranslation();
  const [selectedImage, setSelectedImage] = useState(null);
  const [preview, setPreview] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadedUrl, setUploadedUrl] = useState('');
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);

  // Handle file selection
  const handleFileSelect = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setError(t('posts.imageUploader.invalidFile'));
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError(t('posts.imageUploader.tooLarge'));
      return;
    }

    setSelectedImage(file);
    setError('');
    setUploadedUrl('');

    const reader = new FileReader();
    reader.onloadend = () => setPreview(reader.result);
    reader.readAsDataURL(file);
  };

  // Upload via the @threespeak-backed image pipeline
  const handleUpload = async () => {
    if (!selectedImage) {
      setError(t('posts.imageUploader.selectFirst'));
      return;
    }

    setUploading(true);
    setError('');

    try {
      const url = await uploadThumbnail(selectedImage);
      setUploadedUrl(url);
      setError('');
    } catch (err) {
      setError(err?.message || t('posts.imageUploader.uploadFailed'));
    } finally {
      setUploading(false);
    }
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(uploadedUrl);
    alert(t('posts.imageUploader.urlCopied'));
  };

  const handleReset = () => {
    setSelectedImage(null);
    setPreview(null);
    setUploadedUrl('');
    setError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const pick = () => fileInputRef.current?.click();

  // 29d: one card. A cyan-barred title, the dashed drop zone (the preview once
  // a file is picked), the actions, then the hosted URL with Copy.
  return (
    <div className="hive-image-uploader">
      <div className="uploader-container">
        <div className="uploader-head">
          <span className="uploader-head__bar" aria-hidden="true" />
          <h2>{t('posts.imageUploader.title')}</h2>
        </div>

        {/* File Upload Section */}
        <div className="upload-section">
          <div
            className={`drop-zone ${selectedImage ? 'has-image' : ''}`}
            onClick={pick}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } }}
            role="button"
            tabIndex={0}
            aria-label={t('posts.imageUploader.clickToSelect')}
          >
            {preview ? (
              <img src={preview} alt={t('posts.imageUploader.previewAlt')} className="preview-image" />
            ) : (
              <div className="drop-zone-content">
                <Icon name="add_photo_alternate" size={32} className="upload-icon" />
                <p>{t('posts.imageUploader.clickToSelect')}</p>
                <span>{t('posts.imageUploader.formats')}</span>
              </div>
            )}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileSelect}
            className="file-input"
          />

          {selectedImage && (
            <div className="file-info">
              <p className="file-name">{selectedImage.name}</p>
              <p className="file-size">
                {(selectedImage.size / 1024 / 1024).toFixed(2)} MB
              </p>
            </div>
          )}
        </div>

        {/* Error Message */}
        {error && (
          <div className="error-message" role="alert">
            <Icon name="error" size={18} /> <span>{error}</span>
          </div>
        )}

        {/* Upload Button */}
        <div className="button-group">
          <Button
            variant="primary"
            size={48}
            className="btn-primary is-next"
            trailing="cloud_upload"
            loading={uploading}
            onClick={handleUpload}
            disabled={!selectedImage || uploading}
          >
            {uploading ? t('posts.imageUploader.uploading') : t('posts.imageUploader.upload')}
          </Button>

          {selectedImage && (
            <Button variant="secondary" size={48} icon="restart_alt" className="btn-secondary" onClick={handleReset}>
              {t('common.actions.reset')}
            </Button>
          )}
        </div>

        {/* Success Result */}
        {uploadedUrl && (
          <div className="success-section">
            <div className="success-message" role="status">
              <Icon name="check_circle" size={18} /> <span>{t('posts.imageUploader.success')}</span>
            </div>
            <div className="url-display">
              <div className="uploaded-preview">
                <img src={uploadedUrl} alt={t('posts.imageUploader.uploadedAlt')} />
              </div>
              <div className="url-display__body">
                {selectedImage && <b>{selectedImage.name}</b>}
                <input
                  type="text"
                  value={uploadedUrl}
                  readOnly
                  className="url-input"
                  aria-label={t('posts.imageUploader.success')}
                  onFocus={(e) => e.target.select()}
                />
              </div>
              <Button variant="cyan" size={40} trailing="content_copy" className="btn-copy" onClick={copyToClipboard}>
                {t('common.actions.copy')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default HiveImageUploader;
