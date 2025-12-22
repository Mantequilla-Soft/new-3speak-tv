import React from 'react'
import "./FirstUploads.scss"
import { useQuery } from '@apollo/client'
import { NEW_CONTENT } from '../graphql/queries'
import CardSkeleton from '../components/Cards/CardSkeleton'
import Card3 from "../components/Cards/Card3";

const NewVideos = () => {
  const { data, loading, error } = useQuery(NEW_CONTENT);

  // Transform GraphQL response to match Card3 expected format
  const videos = data?.socialFeed?.items?.map(item => ({
    ...item,
    author: item.author?.username || item.author,
    duration: item.spkvideo?.duration,
    created_at: item.created_at,
  })) || [];

  console.log(videos);

  return (
    <div className='firstupload-container'>
      <div className='headers'>New VIDEOS</div>
      {loading ? <CardSkeleton /> : <Card3 videos={videos} loading={false} />}
      {error && <p>Error fetching videos</p>}
    </div>
  );
};

export default NewVideos;
