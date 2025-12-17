import React, { useEffect, useRef, useState } from "react";
import { Upload, Check } from "lucide-react";
import * as tus from "tus-js-client";
import "./VideoUploadStep2.scss";
import { toast } from "sonner";
import { TailChase } from "ldrs/react";
import "ldrs/react/TailChase.css";
import { StepProgress } from "./StepProgress";
import { Navigate, useNavigate } from "react-router-dom";
import { useLegacyUpload } from "../../context/LegacyUploadContext";

function Thumbnail() {
  const {
    generatedThumbnail,
    thumbnailFile,
    setThumbnailFile,
    setStep,
    setUploadThumbnailProgress,
    videoFile,
    step,
    selectedThumbnail,
    setSelectedThumbnail,
    selectedIndex,
    setSelectedIndex,
  } = useLegacyUpload();

  const [customfile, setCustomFile] = useState([]);
  const [customFiles, setCustomFiles] = useState([]);
  const [loading, setLoading] = useState(false);

  const thumbnailInputRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    setStep(2);
  }, []);

  // AUTO SELECT FIRST GENERATED THUMBNAIL ONLY IF NO CUSTOM EXISTS
  useEffect(() => {
    if (
      generatedThumbnail.length > 0 &&
      selectedIndex === null &&
      customfile.length === 0
    ) {
      const first = generatedThumbnail[0];

      setSelectedIndex(0);
      setSelectedThumbnail(first);

      const base64 = first;
      const mime = base64.split(";")[0].split(":")[1];
      const byteString = atob(base64.split(",")[1]);

      const ab = new ArrayBuffer(byteString.length);
      const ia = new Uint8Array(ab);
      for (let i = 0; i < byteString.length; i++) {
        ia[i] = byteString.charCodeAt(i);
      }

      const blob = new Blob([ab], { type: mime });
      setThumbnailFile(blob);
    }
  }, [generatedThumbnail]);

  // NEW — Auto-select newest uploaded thumbnail
  useEffect(() => {
    if (customfile.length > 0) {
      const newestIndex =
        generatedThumbnail.length + (customfile.length - 1);

      setSelectedIndex(newestIndex);
      setSelectedThumbnail(customfile[customfile.length - 1]);
      setThumbnailFile(customFiles[customFiles.length - 1]);
    }
  }, [customfile]);

  if (!videoFile) {
    return <Navigate to="/studio" replace />;
  }

  const handleThumbnailUpload = (event) => {
    const file = event.target.files[0];
    if (file && file.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const base64 = e.target?.result;
        setCustomFile((prev) => [...prev, base64]);
        setCustomFiles((prev) => [...prev, file]);
      };
      reader.readAsDataURL(file);
    }
  };

  const allThumbnails = [...generatedThumbnail, ...customfile];

  const uploadThumbnail = () => {
    if (!selectedThumbnail || !thumbnailFile) {
      toast.error("Please select a thumbnail first.");
      return;
    }

    navigate("/studio/details");
    setStep(3);
  };

  return (
    <>
      <div className="studio-main-container">
        <div className="studio-page-header">
          <h1>Upload Video</h1>
          <p>Follow the steps below to upload and publish your video</p>
        </div>

        <StepProgress step={step} />

        <div className="studio-page-content">
          <div className="upload-step">
            <div className="upload-step__header">
              <h2 className="upload-step__title">Choose Thumbnail</h2>
              <p className="upload-step__subtitle">
                Select a thumbnail for your video or upload your own
              </p>
            </div>

            <div className="upload-step__content">
                            <div className="upload-step__actions">
                <button
                  onClick={uploadThumbnail}
                  className="button button-primary"
                >
                  {loading ? (
                    <TailChase size="20" speed="1.75" color="white" />
                  ) : (
                    "Proceed to Details"
                  )}
                </button>
              </div>
              <div className="thumbnail-grid">
                {allThumbnails.map((thumbnail, index) => (
                  <div
                    key={index}
                    className={`thumbnail-card ${
                      selectedIndex === index ? "thumbnail-card--selected" : ""
                    }`}
                    onClick={() => {
                      setSelectedIndex(index);
                      setSelectedThumbnail(thumbnail);

                      const customIndex = customfile.indexOf(thumbnail);
                      if (customIndex !== -1) {
                        setThumbnailFile(customFiles[customIndex]);
                        return;
                      }

                      const base64 = thumbnail;
                      const mime = base64.split(";")[0].split(":")[1];
                      const byteString = atob(base64.split(",")[1]);

                      const ab = new ArrayBuffer(byteString.length);
                      const ia = new Uint8Array(ab);
                      for (let i = 0; i < byteString.length; i++)
                        ia[i] = byteString.charCodeAt(i);

                      const blob = new Blob([ab], { type: mime });
                      setThumbnailFile(blob);
                    }}
                  >
                    <div className="content">
                      <img
                        src={thumbnail}
                        alt={`Thumbnail ${index + 1}`}
                        className="image"
                      />

                      {selectedIndex === index && (
                        <div className="check">
                          <Check className="w-4 h-4" />
                        </div>
                      )}

                      {index >= generatedThumbnail.length && (
                        <div className="badge">Custom</div>
                      )}
                    </div>
                  </div>
                ))}

                <div className="thumbnail-upload">
                  <div className="thumbnail-upload__content">
                    <input
                      type="file"
                      accept="image/*"
                      ref={thumbnailInputRef}
                      onChange={handleThumbnailUpload}
                      className="thumbnail-upload__input"
                      id="thumbnail-upload"
                    />
                    <label
                      htmlFor="thumbnail-upload"
                      className="thumbnail-upload__content"
                    >
                      <div className="thumbnail-upload__icon">
                        <Upload className="w-4 h-4" />
                      </div>
                      <span className="thumbnail-upload__label">
                        Upload Custom
                      </span>
                    </label>
                  </div>
                </div>
              </div>

              {/* <div className="upload-step__actions">
                <button
                  onClick={uploadThumbnail}
                  className="button button-primary"
                >
                  {loading ? (
                    <TailChase size="20" speed="1.75" color="white" />
                  ) : (
                    "Proceed to Details"
                  )}
                </button>
              </div> */}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export default Thumbnail;
