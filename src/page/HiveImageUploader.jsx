// HiveImageUploader.jsx
import React, { useState, useRef } from 'react';
import { PrivateKey } from '@hiveio/dhive';
import './HiveImageUploader.scss';
import { Buffer } from "buffer";
const HiveImageUploader = () => {
  const [selectedImage, setSelectedImage] = useState(null);
  const [preview, setPreview] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadedUrl, setUploadedUrl] = useState('');
  const [error, setError] = useState('');
  const [username, setUsername] = useState('');
  const [postingKey, setPostingKey] = useState('');
  const fileInputRef = useRef(null);

  // Sign image data
  const signImage = async (imageData) => {
    try {
      const key = PrivateKey.fromString(postingKey);
      
      // Create hash - using Web Crypto API for browser
      const encoder = new TextEncoder();
      const challengeBuffer = encoder.encode('ImageSigningChallenge');
      
      // Combine challenge and image data
      const combined = new Uint8Array(challengeBuffer.length + imageData.length);
      combined.set(challengeBuffer);
      combined.set(imageData, challengeBuffer.length);
      
      // Hash with SHA-256
      const hashBuffer = await crypto.subtle.digest('SHA-256', combined);
      const hashArray = new Uint8Array(hashBuffer);
      
      // Sign the hash
      const signature = key.sign(Buffer.from(hashArray)).toString();
      return signature;
    } catch (err) {
      throw new Error('Failed to sign image: ' + err.message);
    }
  };

  // Handle file selection
  const handleFileSelect = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      setError('Please select a valid image file');
      return;
    }

    // Validate file size (10MB limit)
    if (file.size > 10 * 1024 * 1024) {
      setError('Image size must be less than 10MB');
      return;
    }

    setSelectedImage(file);
    setError('');
    setUploadedUrl('');

    // Create preview
    const reader = new FileReader();
    reader.onloadend = () => {
      setPreview(reader.result);
    };
    reader.readAsDataURL(file);
  };

  // Upload image to Hive ImageHoster
  const handleUpload = async () => {
    if (!selectedImage) {
      setError('Please select an image first');
      return;
    }

    if (!username || !postingKey) {
      setError('Please enter your Hive username and posting key');
      return;
    }

    setUploading(true);
    setError('');

    try {
      // Read file as ArrayBuffer
      const arrayBuffer = await selectedImage.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);

      // Sign the image
      const signature = await signImage(uint8Array);

      // Create FormData
      const formData = new FormData();
      formData.append('image', selectedImage);

      // Upload to ImageHoster
      const imageHosterUrl = 'https://images.hive.blog';
      const response = await fetch(`${imageHosterUrl}/${username}/${signature}`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Upload failed: ${response.status} - ${errorText}`);
      }

      const result = await response.json();
      setUploadedUrl(result.url);
      setError('');
      
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  // Copy URL to clipboard
  const copyToClipboard = () => {
    navigator.clipboard.writeText(uploadedUrl);
    alert('URL copied to clipboard!');
  };

  // Reset form
  const handleReset = () => {
    setSelectedImage(null);
    setPreview(null);
    setUploadedUrl('');
    setError('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="hive-image-uploader">
      <div className="uploader-container">
        <h2>Hive Image Uploader</h2>
        
        {/* Credentials Section */}
        <div className="credentials-section">
          <div className="input-group">
            <label htmlFor="username">Hive Username</label>
            <input
              type="text"
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter your Hive username"
            />
          </div>
          
          <div className="input-group">
            <label htmlFor="postingKey">Posting Key</label>
            <input
              type="password"
              id="postingKey"
              value={postingKey}
              onChange={(e) => setPostingKey(e.target.value)}
              placeholder="Enter your posting private key"
            />
            <small className="warning">⚠️ Never share your private key!</small>
          </div>
        </div>

        {/* File Upload Section */}
        <div className="upload-section">
          <div
            className={`drop-zone ${selectedImage ? 'has-image' : ''}`}
            onClick={() => fileInputRef.current?.click()}
          >
            {preview ? (
              <img src={preview} alt="Preview" className="preview-image" />
            ) : (
              <div className="drop-zone-content">
                <svg className="upload-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <p>Click to select an image</p>
                <span>PNG, JPG, GIF up to 10MB</span>
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
          <div className="error-message">
            <span>❌</span> {error}
          </div>
        )}

        {/* Upload Button */}
        <div className="button-group">
          <button
            className="btn btn-primary"
            onClick={handleUpload}
            disabled={!selectedImage || uploading || !username || !postingKey}
          >
            {uploading ? (
              <>
                <span className="spinner"></span>
                Uploading...
              </>
            ) : (
              'Upload Image'
            )}
          </button>

          {selectedImage && (
            <button className="btn btn-secondary" onClick={handleReset}>
              Reset
            </button>
          )}
        </div>

        {/* Success Result */}
        {uploadedUrl && (
          <div className="success-section">
            <div className="success-message">
              <span>✅</span> Image uploaded successfully!
            </div>
            <div className="url-display">
              <input
                type="text"
                value={uploadedUrl}
                readOnly
                className="url-input"
              />
              <button className="btn btn-copy" onClick={copyToClipboard}>
                Copy
              </button>
            </div>
            <div className="uploaded-preview">
              <img src={uploadedUrl} alt="Uploaded" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default HiveImageUploader;