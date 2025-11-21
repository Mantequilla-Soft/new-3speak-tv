import { Upload, FileText, Info, CheckCircle } from "lucide-react";
import "./VideoUploadStatus.scss";
// import { useEffect, useState } from "react";



const VideoUploadStatus = ({progress, statusMessages, uploadVideoTo3Speak}) => {


//     const [progress, setProgress] = useState(0);
//   const [statusMessages, setStatusMessages] = useState([]);

//   // Helper to add messages
//   const pushStatus = (message, type = "info") => {
//     setStatusMessages(prev => [
//       ...prev,
//       {
//         message,
//         type,
//         time: new Date().toLocaleTimeString(),
//       },
//     ]);
//   };

//   useEffect(() => {
//     // Simulate upload events
//     let steps = [
//       { msg: "Preparing upload…", prog: 5 },
//       { msg: "Uploading thumbnail…", prog: 10 },
//       { msg: "Uploading video…", prog: 40 },
//       { msg: "Uploading video 50%…", prog: 50 },
//       { msg: "Uploading video 75%…", prog: 75 },
//     //   { msg: "Finalizing upload…", prog: 90 },
//     //   { msg: "Encoding video 20%…", prog: 92 },
//     //   { msg: "Encoding video 60%…", prog: 95 },
//     //   { msg: "Publishing video…", prog: 100 },
//       { msg: "Upload complete!", prog: 100, type: "success" },
//     ];

//     let i = 0;

//     const interval = setInterval(() => {
//       if (i < steps.length) {
//         pushStatus(steps[i].msg, steps[i].type || "info");
//         setProgress(steps[i].prog);
//         i++;
//       } else {
//         clearInterval(interval);
//       }
//     }, 1200);

//     return () => clearInterval(interval);
//   }, []);

    // ✅ Get the latest status automatically
    const latestStatus = statusMessages.length
        ? statusMessages[statusMessages.length - 1].message
        : "Starting...";

  return (
    <div className="upload-status-container">
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
          <span className="progress-percentage">{progress}%</span>
        </div>

        <div className="progress-bar-container">
          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{ width: `${progress}%` }}
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

      {statusMessages.some(msg => msg.type === "error") && (
      <div className="retry-btn-wrapper">
        <button onClick={uploadVideoTo3Speak} className="retry-btn">Retry Upload</button>
      </div>
      )}

      <div className="activity-log">
        <div className="activity-log-header">
          <FileText size={18} />
          <span>Activity Log</span>
        </div>
        <div className="activity-log-content">
          {statusMessages.map((msg, i) => (
            <div key={i} className={`activity-item ${msg.type}`}>
              <div className="activity-icon">
                {msg.type === "info" ? (
                  <Info size={20} />
                ) : (
                  <CheckCircle size={20} />
                )}
              </div>
              <div className="activity-details">
                {/* <span className="activity-time">{msg.time}</span> */}
                <p className="activity-message">{msg.message}</p>
              </div>
            </div>
          ))}
        </div>

      </div>
    </div>
  );
};

export default VideoUploadStatus;
