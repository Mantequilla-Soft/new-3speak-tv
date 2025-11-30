import { useQuery } from '@apollo/client';
import React, { useEffect, useState } from 'react'
import { getFollowers } from '../../hive-api/api';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { GET_SOCIAL_FEED_BY_CREATOR } from '../../graphql/queries';
import Cards from '../Cards/Cards';
import icon from "../../../public/images/stack.png"
import "./UserProfilePage.scss"
import BarLoader from '../Loader/BarLoader';
import { Quantum } from 'ldrs/react'
import 'ldrs/react/Quantum.css'
import { useInfiniteQuery } from '@tanstack/react-query';
import axios from 'axios';
import Card3 from '../Cards/Card3';
import { IoMdShare } from 'react-icons/io';
import { IoLogoRss } from 'react-icons/io5';
import Follower from './Follower';



function UserProfilePage() {
    const { user } = useParams();
    const navigate = useNavigate()
    const [follower, setFollower] = useState(null)
    const [show, setShow] = useState("video");
      // GET_TOTAL_COUNT_OF_FOLLOWING
      // const { username } = useParams();
      useEffect(()=>{
        getFollowersCount(user)
      },[])

 const LIMIT = 100;

const fetchVideos = async ({ pageParam = 0 }) => {
  let url;
  if (pageParam === 0) {
    // first 100 videos
    url = `https://3speak.tv/apiv2/feeds/@${user}`;
  } else {
    // next batches
    url = `https://3speak.tv/apiv2/feeds/@${user}/more?skip=${pageParam}`;
  }

  const res = await axios.get(url);
  return res.data;
};

      
const {
  data,
  fetchNextPage,
  hasNextPage,
  isFetchingNextPage,
  isLoading,
} = useInfiniteQuery({
  queryKey: ["UserProfilePage", user],
  queryFn: fetchVideos,
  getNextPageParam: (lastPage, allPages) => {
    // If the last page has items, calculate next skip value
    if (lastPage.length > 0) {
      return allPages.flat().length; // next skip = total items loaded so far
    }
    return undefined; // stop if no more data
  },
});

      
        useEffect(() => {
              const handleScroll = () => {
                if (
                  window.innerHeight + window.scrollY >=
                    document.body.offsetHeight - 200 &&
                  !isFetchingNextPage &&
                  hasNextPage
                ) {
                  fetchNextPage();
                }
              };
          
              window.addEventListener("scroll", handleScroll);
              return () => window.removeEventListener("scroll", handleScroll);
            }, [isFetchingNextPage, hasNextPage, fetchNextPage]);
          
            // Flatten all pages into a single array
            const videos = data?.pages.flat() || [];
            console.log(videos)


      // const { loading, error, data } = useQuery(GET_SOCIAL_FEED_BY_CREATOR, {
      //   variables: { id: user },
      // });
      // const videos = data?.socialFeed?.items || [];
      // console.log(videos);
    
    
      const getFollowersCount = async (user)=>{
        try{
          const follower = await getFollowers(user)
        setFollower(follower)
        } catch (err){
          console(err)
        }
      }

      const handleWalletNavigate = (user)=>{
        navigate(`/wallet/${user}`)
      }
    console.log(data)
  return (
    <div className="profile-page-container">
      <div className="profile-card">
        <div className="profile-header">
          <img className="gradient-bg" src={`https://images.hive.blog/u/${user}/cover`} alt="" />
        </div>
      <div className="profile-body">
          <div className="top-section">
            <div className="left-info">
              <div className="avatar">
                <img
                  src={`https://images.hive.blog/u/${user}/avatar`}
                  alt="Profile avatar"
                />
              </div>
              <div className="user-meta">
                <h2>{user}</h2>
                <div className="user-badges">
                  <span className="status-dot">
                    <span className="dot"></span>Verified creator
                  </span>
                </div>
              </div>
            </div>
      
            <div className="button-group">
              <button className="btn btn-primary" onClick={() => setShow("follower")}>
                Followers{" "}
                  {follower?.follower_count !== undefined ? (
                    follower.follower_count
                  ) : (
                    <Quantum size="15" speed="1.75" color="red" />
                  )}
              </button>
              <button className="btn btn-secondary" onClick={() => window.open(`https://3speak.tv/rss/${user}.xml`, "_blank")}>
                <IoLogoRss />
              </button>
                    <button
                      className="btn btn-secondary"
                      onClick={() => {
                        if (navigator.share) {
                          navigator.share({
                            title: `${user}`,
                            text: `Follow ${user} on 3Speak`,
                            url: `https://3speak.tv/user/${user}`,
                          });
                        } else {
                          window.open(`https://3speak.tv/user/${user}`, "_blank");
                        }
                      }}
                    >
                      <IoMdShare />
                    </button>
      
            </div>
          </div>
        </div>
        </div>
      <div className="toggle-wrap">
        <div className="wrap">
          <span onClick={() => setShow("video")}>Videos</span> 
        </div>
        <span className="followers" onClick={()=>{handleWalletNavigate(user)}}>wallet</span> 
      </div>
      <div className="container-video">
  {show === "video" ? (
    isLoading ? (
      <BarLoader />
    ) : videos?.length === 0 ? (
      <div className='empty-wrap'>
        <img src={icon} alt="" />
        <span>No Video Data Available</span>
      </div>
    ) : (
      <Card3 videos={videos} loading={isFetchingNextPage} />
    )
  ) : (
    <Follower count={follower} />
  )}
</div>

    </div>
  )
}

export default UserProfilePage