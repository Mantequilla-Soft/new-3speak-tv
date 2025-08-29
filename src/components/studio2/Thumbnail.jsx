import React, { useEffect, useRef, useState } from "react";
import { Upload, Check} from "lucide-react";
import * as tus from "tus-js-client";
import "./VideoUploadStep2.scss";
import {  toast } from 'sonner'
import { TailChase } from 'ldrs/react'
import 'ldrs/react/TailChase.css'
import { useUpload } from "../../context/UploadContext";
import { StepProgress } from "./StepProgress";
import { Navigate, useNavigate } from "react-router-dom";

// Default values shown

function Thumbnail() {
 const { generatedThumbnail, setThumbnailFile, setStep,  setUploadThumbnailProgress,videoFile, step, selectedThumbnail, setSelectedThumbnail, selectedIndex, setSelectedIndex } = useUpload()
  const tusEndPoint = "https://uploads.3speak.tv/files/";
  // const [selectedThumbnail, setSelectedThumbnail] = useState("");
  const [customfile, setCustomFile] = useState([]);
  const [customFiles, setCustomFiles] = useState([]); 
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const thumbnailInputRef = useRef(null);
  // const [selectedIndex, setSelectedIndex] = useState(null);
  const navigate = useNavigate()

        if (!videoFile ) {
    return <Navigate to="/studio" replace />;
  }


    useEffect(()=>{
      setStep(2)
    }, [])



const handleThumbnailUpload = (event) => {
  const file = event.target.files[0];
  if (file && file.type.startsWith("image/")) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const base64 = e.target?.result;
      setCustomFile((prev) => [...prev, base64]);     // for display
      setCustomFiles((prev) => [...prev, file]);       // for upload
    };
    reader.readAsDataURL(file);
  }
};



    const allThumbnails = [...generatedThumbnail, ...customfile];

    const uploadThumbnail = ()=>{
      if (!selectedThumbnail) {
            toast.error("Please select a thumbnail first.");
            return;
        }

      process()
      navigate("/studio/details")
      setStep(3)
      // process()

    }

    const process = () => {
        setLoading(true)

        let fileToUpload = null;

        // Check if it's one of the custom uploads (base64)
        const indexInCustom = customfile.indexOf(selectedThumbnail);

        if (indexInCustom !== -1) {
            // It's a custom thumbnail
            fileToUpload = customFiles[indexInCustom];
        } else {
            // It's one of the generated thumbnails (base64), convert to Blob
            const byteString = atob(selectedThumbnail.split(',')[1]);
            const mimeString = selectedThumbnail.split(',')[0].split(':')[1].split(';')[0];
            const ab = new ArrayBuffer(byteString.length);
            const ia = new Uint8Array(ab);
            for (let i = 0; i < byteString.length; i++) {
                ia[i] = byteString.charCodeAt(i);
            }
            fileToUpload = new Blob([ab], { type: mimeString });
        }

        const upload = new tus.Upload(fileToUpload, {
            endpoint: tusEndPoint,
            retryDelays: [0, 3000, 5000, 10000, 20000],
            metadata: {
                filename: "thumbnail.jpg",
                filetype: fileToUpload.type,
            },
            onError: (error) => {
                console.error("Thumbnail upload failed:", error);
                setError("Thumbnail upload failed.");
            },
            onProgress: (bytesUploaded, bytesTotal) => {
                const percentage = Number(((bytesUploaded / bytesTotal) * 100).toFixed(2));
                setUploadThumbnailProgress(percentage);
            },
            onSuccess: () => {
                const uploadedUrl = upload.url;
                setThumbnailFile(uploadedUrl)
                console.log("Thumbnail uploaded successfully:", uploadedUrl);
                setThumbnailFile(uploadedUrl)

            },
        });

        upload.start();
    };


  return (
    // <div className="upload-step">
    //   <div className="upload-step__header">
    //     <h2 className="upload-step__title">Choose Thumbnail</h2>
    //     <p className="upload-step__subtitle">
    //       Select a thumbnail for your video or upload your own
    //     </p>
    //   </div>

    //   <div className="upload-step__content">
    //     <div className="thumbnail-grid">
    //       {allThumbnails.map((thumbnail, index) => (
    //         <div
    //           key={index}
    //           className={`thumbnail-card 
    //                 ${
    //                   selectedIndex === index
    //                     ? "thumbnail-card--selected"
    //                     : ""
    //                 }
    //                 `}
    //           onClick={() => {setSelectedIndex(index);setSelectedThumbnail(thumbnail)}}
    //         >
    //           <div className="content">
    //             <img
    //               src={thumbnail}
    //               alt={`Thumbnail ${index + 1}`}
    //               className="image"
    //             />
    //             {selectedIndex === index && (
    //               <div className="check">
    //                 <Check className="w-4 h-4" />
    //               </div>
    //             )}
    //             {index >= generatedThumbnail.length && (
    //               <div className="badge">Custom</div>
    //             )}
    //           </div>
    //         </div>
    //       ))}

    //       <div className="thumbnail-upload">
    //         <div className="thumbnail-upload__content">
    //           <input
    //             type="file"
    //             accept="image/*"
    //             ref={thumbnailInputRef}
    //             onChange={handleThumbnailUpload}
    //             className="thumbnail-upload__input"
    //             id="thumbnail-upload"
    //           />
    //           <label
    //             htmlFor="thumbnail-upload"
    //             className="thumbnail-upload__content"
    //           >
    //             <div className="thumbnail-upload__icon">
    //               <Upload className="w-4 h-4" />
    //             </div>
    //             <span className="thumbnail-upload__label">Upload Custom</span>
    //           </label>
    //         </div>
    //       </div>
    //     </div>
    //     <div className="upload-step__actions">
    //     {/* <button 
    //     // onClick={onBack}
    //      className="button button-outline">
    //       Back
    //     </button> */}
    //     <button
    //       onClick={uploadThumbnail}
    //       // disabled={!selectedThumbnail}
    //       className="button button-primary"
    //     >
    //      {loading?<TailChase size="20" speed="1.75" color="white" /> : "Proceed to Details"}
    //     </button>
    //   </div>
    //   </div>
    //   {/* {thumbnailProgress > 0 &&<div className="progress-bar">
    //         <div className="progress-bar-fill" style={{ width: `${thumbnailProgress}%` }}>
    //           {thumbnailProgress > 0 && <span className="progress-bar-text">{thumbnailProgress}%</span>}
    //         </div>
    //       </div>} */}


      
    // </div>



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
        <div className="thumbnail-grid">
          {allThumbnails.map((thumbnail, index) => (
            <div
              key={index}
              className={`thumbnail-card 
                    ${
                      selectedIndex === index
                        ? "thumbnail-card--selected"
                        : ""
                    }
                    `}
              onClick={() => {setSelectedIndex(index);setSelectedThumbnail(thumbnail)}}
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
                <span className="thumbnail-upload__label">Upload Custom</span>
              </label>
            </div>
          </div>
        </div>
        <div className="upload-step__actions">
        {/* <button 
        // onClick={onBack}
         className="button button-outline">
          Back
        </button> */}
        <button
          onClick={uploadThumbnail}
          // disabled={!selectedThumbnail}
          className="button button-primary"
        >
         {loading?<TailChase size="20" speed="1.75" color="white" /> : "Proceed to Details"}
        </button>
      </div>
      </div>
      {/* {thumbnailProgress > 0 &&<div className="progress-bar">
            <div className="progress-bar-fill" style={{ width: `${thumbnailProgress}%` }}>
              {thumbnailProgress > 0 && <span className="progress-bar-text">{thumbnailProgress}%</span>}
            </div>
          </div>} */}


      
    </div>
         
            </div>
        </div>
              
    
          </>
  );
}

export default Thumbnail;
