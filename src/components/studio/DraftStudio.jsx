import React, { useEffect, useState } from 'react';
import axios from 'axios';
import "./DraftStudio.scss"
import FilterBar from '../Draft/FilterBar';
import VideoCard from '../Draft/VideoCard';
import { useNavigate } from 'react-router-dom';
import BarLoader from '../Loader/BarLoader';



const DraftStudio = () => {
  const navigate = useNavigate()
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const accessToken = localStorage.getItem("access_token");
  const [filter, setFilter] = useState('all');
  console.log(accessToken)
  console.log(videos)

 

  const fetchMyVideos = async () => {
    try {
      const response = await axios.get('https://studio.3speak.tv/mobile/api/my-videos', {
        headers: {
          'Content-Type': 'application/json',
          // ✅ Important: Use a browser extension or server to pass the correct cookie if CORS blocks it
          Authorization: `Bearer ${accessToken}`, // This must be set from the browser session or via a proxy
        },
        withCredentials: true // Needed to send cookies from browser
      });

      setVideos(response.data || []);
    } catch (error) {
      console.error('Failed to fetch videos:', error.response.data);
    } finally {
      setLoading(false);
    }
  };
  const filteredVideos = videos.filter(video => {
    if (filter === 'all') return true;
    return video.status === filter;
  });

  const handleFilterChange = (newFilter) => {
    setFilter(newFilter);
  };

  useEffect(() => {
    fetchMyVideos();
  }, []);

  const handleEdit = (video) =>{
    navigate(`/editvideo/${video._id}`, {state: {video}})
  }

  if (loading) return <div><BarLoader /></div>;

  return (
    <div>
      <FilterBar onFilterChange={handleFilterChange} activeFilter={filter} />

      {videos.length === 0 ? (
        <div className="no-videos fade-in">
          <p>No videos found with the selected filter.</p>
        </div>
      ) : (
        <div className="video-grid">
          {filteredVideos.map(video => (
            <VideoCard
              key={video._id}
              video={video}
              onEdit={()=>handleEdit(video)}
              // onView={handleView}
              // onDelete={handleDelete}
              // onPublish={handlePublish}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default DraftStudio;
