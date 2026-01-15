import { Upload, FileText, Info, CheckCircle, ArrowLeft } from "lucide-react";
import "./VideoUploadStatus.scss";
import { useMemo } from "react";
import { useLegacyUpload } from "../../context/LegacyUploadContext";

const VideoUploadStatus = ({  uploadVideoTo3Speak, setUploading}) => {
  // 🎬 ✅ Publishing to Hive...

  

  const {uploadVideoProgress, statusMessages, isScheduled} = useLegacyUpload()
  console.log("message status", statusMessages)

  const isBackgroundProcessing = statusMessages.some(msg =>
  msg.message.includes("processing in the background")
);

  const successPairs = [
    { loading: "Preparing upload request…", done: "Prepare completed ✔" },
    { loading: "Uploading thumbnail…", done: "✔ Thumbnail uploaded successfully" },
    { loading: "Uploading video…", done: "Video upload finished ✔" },
    { loading: "Starting finalization…", done: "✔ Upload finalized successfully" },
    { loading: "Waiting for encoding to start…", done: "Video encoding has started!" },
  ];

  // Memoize cleaned messages for performance
const cleanedMessages = useMemo(() => {
  let filtered = [...statusMessages];

  /* ---------------- SUCCESS PAIRS ---------------- */
  successPairs.forEach(pair => {
    const hasDone = filtered.some(m => m.message === pair.done);
    if (hasDone) {
      filtered = filtered.filter(m => m.message !== pair.loading);
    }
  });

    /* ---------------- REMOVE PUBLISHING MESSAGE WHEN SCHEDULED ---------------- */
  if (isScheduled) {
    filtered = filtered.filter(
      msg =>
        !msg.message.includes("🎬 ✅ Publishing to Hive...")
    );
  }

  /* ---------------- DEDUPE STATUS LABELS ---------------- */
  const seenStatus = new Map();

  filtered.forEach((msg, index) => {
    if (msg.message.startsWith("🎬")) {
      // overwrite previous occurrence, keep latest index
      seenStatus.set(msg.message, index);
    }
  });

  filtered = filtered.filter((msg, index) => {
    if (!msg.message.startsWith("🎬")) return true;
    return seenStatus.get(msg.message) === index;
  });

  /* ---------------- KEEP ONLY LATEST ENCODING % ---------------- */
  const encodingMsgs = filtered.filter(m =>
    m.message.includes("Encoding:")
  );

  if (encodingMsgs.length > 1) {
    const latest = encodingMsgs[encodingMsgs.length - 1];
    filtered = filtered.filter(
      m => !m.message.includes("Encoding:") || m === latest
    );
  }

  return filtered;
}, [statusMessages]);


  // latest status text based on cleaned messages
  const latestStatus = cleanedMessages.length
    ? cleanedMessages[cleanedMessages.length - 1].message
    : "Starting...";

  const hasError = statusMessages.some(m => m.type === "error");

const canLeavePage = statusMessages.some(msg =>
  [
    "⏳ Queued for encoding...",
    "🎬 ⏳ Queued for encoding...",
    "🎬 Processing (assigned)...",
    "🎬 🎬 Encoding: 0%",
    "🎬 Processing (uploading)..."
  ].includes(msg.message)
);

  // Check if finalize succeeded - if so, don't show retry button even if there are polling errors
  const hasFinalizeSuccess = statusMessages.some(msg => 
    msg.message.includes("Upload finalized successfully") || 
    msg.message.includes("finalized successfully")
  );
  
  // Only show retry if there's an error AND finalize hasn't succeeded yet
  // const shouldShowRetry = hasError && !hasFinalizeSuccess;
  const shouldShowRetry = hasError && !hasFinalizeSuccess && !isBackgroundProcessing;


  return (
    <div className="upload-status-container">
      {statusMessages.some(msg => msg.type === "error") && (
        <button className="btn-close" onClick={() => setUploading(false)}>
          <ArrowLeft />
        </button>
      )}
      
      <div className="upload-icon">
        <Upload size={30} strokeWidth={1.5} />
      </div>

      <h2 className="upload-title">Uploading Your Video</h2>
      <p className="upload-subtitle">Please wait while we process your content...</p>

      <div className="current-status">
        <span className="status-label">Current Status:</span>
        <div className="status-text">
          <span className="status-dot"></span>
          {latestStatus}
        </div>
      </div>

      <div className="progress-section">
        <div className="progress-header">
          <span className="progress-label">Upload Progress</span>
          <span className="progress-percentage">{uploadVideoProgress}%</span>
        </div>

        <div className="progress-bar-container">
          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{ width: `${uploadVideoProgress}%` }}
            ></div>
          </div>
          <div className="progress-markers">
            <span className="marker">Start</span>
            <span className="marker">25%</span>
            <span className="marker">50%</span>
            <span className="marker">75%</span>
            <span className="marker">Complete</span>
          </div>
        </div>
      </div>

      {shouldShowRetry && (
        <div className="retry-btn-wrapper">
          <button onClick={uploadVideoTo3Speak} className="retry-btn">
            Retry Upload
          </button>
        </div>
      )}

      <div className={`caution-wrap ${canLeavePage ? "can-leave" : ""}`}>
        {canLeavePage && <span className="bip-dot" />}
        {canLeavePage
          ? "You can now leave the page while your video is processing."
          : "Please stay on this page until the upload is finished."
        }
      </div>


      <div className="activity-log">
        <div className="activity-log-header">
          <div className="wrapin">
            <FileText size={18} />
             <span>Activity Log</span>
          </div>
          <div className="discord">
            For Support reach out to us on{" "}
            <a
              href="https://discord.gg/NSFS2VGj83"
              target="_blank"
              rel="noopener noreferrer"
              className="discord-link"
            >
              Discord
            </a>
          </div>


        </div>
        <div className="activity-log-content">
          {cleanedMessages.map((msg, i) => {
            const isSuccess = 
              msg.message.includes("✔") || 
              msg.message.includes("✅") || 
              msg.message.includes("🎉") ||
              msg.type === "success";
            
            const isWarning = msg.type === "warning" || msg.message.includes("⚠️");
            const isEncoding = msg.message.includes("⚙️ Encoding");
            
            const itemClass = isSuccess 
              ? "success" 
              : msg.type === "error" 
              ? "error" 
              : isWarning
              ? "warning"
              : "info";

            return (
              <div key={i} className={`activity-item ${itemClass}`}>
                <div className="activity-icon">
                  {isSuccess ? (
                    <CheckCircle size={20} />
                  ) : (
                    <Info size={20} />
                  )}
                </div>
                <div className="activity-details">
                  <p className="activity-message">{msg.message}</p>
                  {/* {msg.time && (
                    <span className="activity-time">{msg.time}</span>
                  )} */}
                </div>
              </div>
            );
          })}
        </div>
        <div className="notification-wrap">
          <p>The encoding can take between one minute to an hour depending on the size and length of the video.</p>
          <p>Visit <a href="https://monitor.3speak.tv" target="_blank" rel="noopener noreferrer" className="monitor-link">monitor.3speak.tv</a> to watch the progress of the encoding.</p>
          <p>Note: Once the video is encoded, it can take up to 10 minutes for the video to be posted to Hive frontends.</p>
        </div>
      </div>
    </div>
  );
};

export default VideoUploadStatus;
