import React from 'react';
import "./VideoCard.scss"
import dayjs from "dayjs";
import {  useNavigate } from 'react-router-dom';
const VideoCard = ({  video, onEdit, onView, onDelete, onPublish}) => {
  const navigate = useNavigate()
  const handleNavigate = ()=>{
    navigate(`/watch?v=${video?.owner}/${video.permlink ?? "unknown"}`)
  }

  console.log(video)

  return (
    <div className="video-card">
      <div className="thumbnail">
        <img src={video.thumbUrl} alt={video.title} />
      </div>
      <div className="content">
        <h3 className="title">{video.title || ""}</h3>
        <div className="metas">
          <span className="date">{dayjs(video.created).fromNow()}</span>
          <span className={`status status--${video.status}`}>
            {video.status === 'published' ? 'Published' : 'Failed'}
          </span>
        </div>
        <div className="actions">
          {video.status === 'published' ? (
            <>
              <button 
                className="btn btn--secondary btn--sm" 
                onClick={() => onEdit(video.id)}
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
                Edit
              </button>
              <button 
                className="btn btn--secondary btn--sm" 
                onClick={handleNavigate}
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
                View
              </button>
              {/* <button 
                className="btn btn--danger btn--sm" 
                onClick={() => onDelete(video.id)}
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  <line x1="10" y1="11" x2="10" y2="17" />
                  <line x1="14" y1="11" x2="14" y2="17" />
                </svg>
                Delete
              </button> */}
            </>
          ) : (
            <button 
              className="btn btn--primary btn--sm animate-pulse" 
              onClick={() => onPublish(video.id)}
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14" />
                <path d="M12 5l7 7-7 7" />
              </svg>
              Publish
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default VideoCard;