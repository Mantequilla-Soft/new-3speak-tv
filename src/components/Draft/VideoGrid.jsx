import React, { useState } from 'react';
import VideoCard, { VideoData } from './VideoCard';
import FilterBar from './FilterBar';
// import { toast } from 'sonner';
import { toastIn } from '../../utils/toast';
import 'react-toastify/dist/ReactToastify.css';
import "./VideoGrid.scss"

// Every toast from this module is headed "Video"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Video');

const VideoGrid = ({ videos }) => {
  const [filter, setFilter] = useState('all');

  const filteredVideos = videos.filter(video => {
    if (filter === 'all') return true;
    return video.status === filter;
  });

  const handleFilterChange = (newFilter) => {
    setFilter(newFilter);
  };

  const handleEdit = (id) => {
    toast.info(`Editing video coming soon`);
  };

  const handleView = (id) => {
    toast.info(`Viewing video coming soon`);
  };

  const handleDelete = (id) => {
    toast.error(`Deleting video coming soon`);
  };

  const handlePublish = (id) => {
    toast.success(`Publishing video coming soon`);
  };

  // console.log(filteredVideos)

  return (
    <div>
      <FilterBar onFilterChange={handleFilterChange} activeFilter={filter} />
      
      {filteredVideos.length === 0 ? (
        <div className="no-videos fade-in">
          <p>No videos found with the selected filter.</p>
        </div>
      ) : (
        <div className="video-grid">
          {filteredVideos.map(video => (
            <VideoCard
              key={video.id}
              video={video}
              onEdit={handleEdit}
              onView={handleView}
              onDelete={handleDelete}
              onPublish={handlePublish}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default VideoGrid;