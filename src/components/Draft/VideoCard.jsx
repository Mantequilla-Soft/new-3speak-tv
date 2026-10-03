import React from 'react';
import "./VideoCard.scss"
import dayjs from "dayjs";
import utc from 'dayjs/plugin/utc';
import {  useNavigate } from 'react-router-dom';
import { fixVideoThumbnail } from '../../utils/fixThumbnails';
import fallbackImg from '../../assets/image/speak.jpg';
import { useTranslation } from 'react-i18next';
dayjs.extend(utc);
const VideoCard = ({  video, onEdit, onView, onDelete, onPublish}) => {
  const { t } = useTranslation();
  const navigate = useNavigate()
  const handleNavigate = ()=>{
    navigate(`/watch?v=${video?.owner}/${video.permlink ?? "unknown"}`)
  }
  const getStatusLabel = (status) => {
  switch (status) {
    case 'published':
      return t('upload.drafts.status.published');
    case 'scheduled':
      return t('upload.drafts.status.scheduled');
    case 'failed':
    case 'publish_manual':
      return t('upload.drafts.status.failed');
    default:
      return status;
  }
};


  // console.log(video)

  return (
    <div className="video-card">
      <div className="thumbnail">
        <img src={fixVideoThumbnail(video)} alt={video.title} onError={(e) => (e.currentTarget.src = fallbackImg)} />
      </div>
      <div className="content">
        <h3 className="title">{video.title || ""}</h3>
        <div className="metas">
          <span className="date">{dayjs(video.created_at).fromNow()}</span>
          <span className={`status status--${video.status}`}>
            {getStatusLabel(video.status)}
          </span>
        </div>
        {video.status === 'scheduled' && video.publish_data && (
          <div className="scheduled-date">
            {t('upload.drafts.publishesAt', { date: dayjs(typeof video.publish_data === 'number' ? video.publish_data * 1000 : video.publish_data).format('MMM D, YYYY [at] h:mm A') })}
          </div>
        )}
        <div className="actions">
          {(video.status === 'published' || video.status === 'scheduled') ? (
            <>
              <button
                className="btn btn--secondary btn--sm"
                onClick={() => onEdit(video.id)}
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
                {t('common.actions.edit')}
              </button>
              {/* Scheduled posts don't have a public URL yet, so only show "View" for published. */}
              {video.status === 'published' && (
                <button
                  className="btn btn--secondary btn--sm"
                  onClick={handleNavigate}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                  {t('common.actions.view')}
                </button>
              )}
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
            ""
          )}
        </div>
      </div>
    </div>
  );
};

export default VideoCard;