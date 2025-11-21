import axios from "axios";
import React, { useEffect } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import Card3 from "../components/Cards/Card3";
import CardSkeleton from "../components/Cards/CardSkeleton";

// const fetchVideos = async ({ pageParam = 1 }) => {
//   const res = await axios.get(
//     // `https://3speak.tv/apiv2/feeds/@kesolink?page=${pageParam}`
//     // `https://3speak.tv/apiv2/feeds/community/hive-140169/new?page=${pageParam}`
//     `https://3speak.tv/apiv2/feeds/trending/more?skip=${pageParam}`
//   );
//   return res.data;
// };

const fetchVideos = async ({ pageParam = 0 }) => {
  let user = `eddiespino`
  let url;

  // On first load, use /feeds/trending
  if (pageParam === 0) {
    url = `https://3speak.tv/apiv2/feeds/@${user}?page=${pageParam}`;
  } 
  // On later loads, use /feeds/trending/more with skip
  else {
    url = `https://3speak.tv/apiv2/feeds/@${user}/more?page=${pageParam}`;
  }

  const res = await axios.get(url);
  // Notice: trending returns an array, while /more returns { trends: [...] }
  return res.data.trends || res.data;
};


function Test() {
  useEffect(()=>{
    getData()
  },[])

const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isError,
  } = useInfiniteQuery({
    queryKey: ["trendingVideos"],
    queryFn: fetchVideos,
    getNextPageParam: (lastPage, allPages) => {
      // If lastPage returned data, calculate new skip
      const currentTotal = allPages.flat().length;
      if (lastPage && lastPage.length > 0) return currentTotal;
      return undefined; // Stop when no more data
    },
  });

  console.log(data)

 // Infinite scroll effect
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

  // Flatten all pages into one list
  const videos = data?.pages.flat() || [];


  const getData= async()=>{
    // testing function
    try{
      const res = await axios.get(`http://144.48.107.2:3005/getjobid/${user}/${permlink}`)
      console.log(res)

      const ress = await axios.get(`https://encoder-gateway.infra.3speak.tv/api/v0/gateway/jobstatus/${res.data.jobId}`)
      console.log(ress.data.job.progress.download_pct )
    }catch (err){
      console.log(err)

    }
  }



  return (
    <div>
      {isLoading ? <CardSkeleton /> :  <Card3 videos={videos} loading={isFetchingNextPage} />}
      {isError && <p>Error fetching videos</p>}

      

      {isFetchingNextPage && (
        <p style={{ textAlign: "center" }}>Loading more...</p>
      )}
      {/* {!hasNextPage && (
        <p style={{ textAlign: "center" }}>No more videos</p>
      )} */}
    </div>
  );
}

export default Test;
