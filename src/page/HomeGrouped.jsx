import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useQuery as useApolloQuery } from "@apollo/client";
import axios from "axios";
import { FaChevronLeft, FaChevronRight } from "react-icons/fa";
import { Link } from "react-router-dom";
import "./HomeGrouped.scss";
import { NEW_CONTENT } from "../graphql/queries";
import CardSkeleton from "../components/Cards/CardSkeleton";
import Card3 from "../components/Cards/Card3";

// Fetch functions for each feed
const fetchHome = async () => {
  const res = await axios.get(`https://3speak.tv/apiv2/feeds/home?page=0`);
  return res.data.trends || res.data;
};

const fetchFirstUploads = async () => {
  const res = await axios.get(`https://3speak.tv/apiv2/feeds/firstUploads?page=1`);
  return res.data;
};

const fetchTrending = async () => {
  const res = await axios.get(`https://3speak.tv/apiv2/feeds/trending?limit=50`);
  return res.data;
};

// Horizontal scrollable video row component
const VideoRow = ({ title, videos, linkTo, isLoading }) => {
  const scrollContainerRef = useRef(null);

  const scroll = (direction) => {
    if (scrollContainerRef.current) {
      const scrollAmount = 600;
      scrollContainerRef.current.scrollBy({
        left: direction === "left" ? -scrollAmount : scrollAmount,
        behavior: "smooth",
      });
    }
  };




  const TrendingIcon = () => (
  <svg width="17" height="17" viewBox="0 0 17 17" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path fill-rule="evenodd" clip-rule="evenodd" d="M1.19628 1.19628C-9.73787e-08 2.39256 0 4.31794 0 8.16872C0 12.0194 -9.73787e-08 13.9449 1.19628 15.1411C2.39256 16.3374 4.31794 16.3374 8.16872 16.3374C12.0194 16.3374 13.9449 16.3374 15.1411 15.1411C16.3374 13.9449 16.3374 12.0194 16.3374 8.16872C16.3374 4.31794 16.3374 2.39256 15.1411 1.19628C13.9449 -9.73787e-08 12.0194 0 8.16872 0C4.31794 0 2.39256 -9.73787e-08 1.19628 1.19628ZM12.2531 8.71333C12.2531 12.1986 9.34861 13.0699 7.89645 13.0699C6.62573 13.0699 4.08436 12.1986 4.08436 8.71333C4.08436 7.19737 4.95263 6.23498 5.6821 5.75056C6.01561 5.5291 6.43042 5.67065 6.45199 6.07042C6.49916 6.94512 7.17328 7.64772 7.69534 6.94431C8.17313 6.30051 8.40896 5.42625 8.40896 4.90123C8.40896 4.12783 9.19185 3.63637 9.80311 4.11021C10.9945 5.03381 12.2531 6.58055 12.2531 8.71333Z" fill="red"/>
</svg>

);

const NewContentIcon = () => (
  <svg width="17" height="17" viewBox="0 0 17 17" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path fill-rule="evenodd" clip-rule="evenodd" d="M4.28863 0.316799C5.34951 0.0810337 6.63651 0 8.16872 0C9.70092 0 10.9879 0.0810337 12.0488 0.316799C13.119 0.554631 14.0084 0.960641 14.6926 1.64484C15.3768 2.32903 15.7828 3.21849 16.0206 4.28863C16.2564 5.34951 16.3374 6.63651 16.3374 8.16872C16.3374 9.70092 16.2564 10.9879 16.0206 12.0488C15.7828 13.119 15.3768 14.0084 14.6926 14.6926C14.0084 15.3768 13.119 15.7828 12.0488 16.0206C10.9879 16.2564 9.70092 16.3374 8.16872 16.3374C6.63651 16.3374 5.34951 16.2564 4.28863 16.0206C3.21849 15.7828 2.32903 15.3768 1.64484 14.6926C0.960641 14.0084 0.554631 13.119 0.316799 12.0488C0.0810337 10.9879 0 9.70092 0 8.16872C0 6.63651 0.0810337 5.34951 0.316799 4.28863C0.554631 3.21849 0.960641 2.32903 1.64484 1.64484C2.32903 0.960641 3.21849 0.554631 4.28863 0.316799ZM11.1064 6.80601C12.1609 7.40854 12.1609 8.92898 11.1064 9.5315L7.47764 11.6051C6.51169 12.1571 5.30983 11.4596 5.30983 10.3471V5.99044C5.30983 4.87792 6.51169 4.18044 7.47764 4.73241L11.1064 6.80601Z" fill="red"/>
</svg>

);

const FirstUploadIcon = () => (
  <svg width="17" height="17" viewBox="0 0 17 17" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path
    fill-rule="evenodd"
    clip-rule="evenodd"
    d="M0 8.35236C0 4.41501 0 2.44635 1.22318 1.22318C2.44635 0 4.41501 0 8.35236 0C12.2897 0 14.2584 0 15.4815 1.22318C16.7047 2.44635 16.7047 4.41501 16.7047 8.35236C16.7047 12.2897 16.7047 14.2584 15.4815 15.4815C14.2584 16.7047 12.2897 16.7047 8.35236 16.7047C4.41501 16.7047 2.44635 16.7047 1.22318 15.4815C0 14.2584 0 12.2897 0 8.35236ZM8.35236 13.155C8.69831 13.155 8.97878 12.8745 8.97878 12.5285V8.19425L10.4151 9.63052C10.6598 9.87516 11.0563 9.87516 11.301 9.63052C11.5456 9.38588 11.5456 8.98931 11.301 8.74467L8.79528 6.23893C8.67785 6.12146 8.51848 6.05546 8.35236 6.05546C8.18623 6.05546 8.02686 6.12146 7.90943 6.23893L5.4037 8.74467C5.15907 8.98931 5.15907 9.38588 5.4037 9.63052C5.64833 9.87516 6.04497 9.87516 6.2896 9.63052L7.72593 8.19425V12.5285C7.72593 12.8745 8.0064 13.155 8.35236 13.155ZM5.01141 4.8026C4.66545 4.8026 4.38499 4.52214 4.38499 4.17618C4.38499 3.83021 4.66545 3.54975 5.01141 3.54975H11.6933C12.0393 3.54975 12.3197 3.83021 12.3197 4.17618C12.3197 4.52214 12.0393 4.8026 11.6933 4.8026H5.01141Z"
    fill="red"
  />
</svg>

);

const iconsByTitle = {
  "Home Feed" : <TrendingIcon />,
  "New Content": <NewContentIcon />,
  "First Time Uploads": <FirstUploadIcon />,
  "Trending": <TrendingIcon />
};

  return (
    <div className="video-row">
      <div className="row-header">
<div className="wrap-title">
  {iconsByTitle[title]}
  <h2>{title}</h2>
</div>
        {linkTo && (
          <Link to={linkTo} className="view-all">
            View All
          </Link>
        )}
      </div>

      <div className="scroll-wrapper">
        <button className="scroll-btn left" onClick={() => scroll("left")}>
          <FaChevronLeft />
        </button>

        <div className="video-scroll-container-horizontal" ref={scrollContainerRef}>
          {isLoading || videos.length === 0 ? (
            // Show skeleton placeholders while loading
            <div className="skeleton-horizontal-container">
              {Array.from({ length: 8 }).map((_, index) => (
                <div key={`skeleton-${index}`} className="skeleton-card-horizontal">
                  <div className="skeleton video-thumbnail-skeleton"></div>
                  <div className="skeleton line-skeleton"></div>
                  <div className="skeleton line-skeleton" style={{width: '60%'}}></div>
                </div>
              ))}
            </div>
          ) : (
            <div className="card-container-horizontal">
              <Card3 videos={videos.slice(0, 16)} loading={false}  tooltipVariant="group" />
            </div>
          )}
        </div>

        <button className="scroll-btn right" onClick={() => scroll("right")}>
          <FaChevronRight />
        </button>
      </div>
    </div>
  );
};

const HomeGrouped = () => {
  // Fetch all feeds
  const { data: homeData, isLoading: homeLoading } = useQuery({
    queryKey: ["home-grouped"],
    queryFn: fetchHome,
    staleTime: 5 * 60 * 1000, // Consider data fresh for 5 minutes
    gcTime: 10 * 60 * 1000, // Keep in cache for 10 minutes
  });

  const { data: firstUploadsData, isLoading: firstUploadsLoading } = useQuery({
    queryKey: ["firstuploads-grouped"],
    queryFn: fetchFirstUploads,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  const { data: trendingData, isLoading: trendingLoading } = useQuery({
    queryKey: ["trending-grouped"],
    queryFn: fetchTrending,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  const { data: newContentData, loading: newContentLoading } = useApolloQuery(NEW_CONTENT, {
    variables: { limit: 50, skip: 0 },
  });

  return (
    <div className="home-grouped-container">
      <VideoRow
        title="Home Feed"
        videos={homeData || []}
        linkTo="/home-feed"
        isLoading={homeLoading}
      />

      <VideoRow
        title="New Content"
        videos={newContentData?.socialFeed?.items || []}
        linkTo="/new"
        isLoading={newContentLoading}
      />

      <VideoRow
        title="Trending"
        videos={trendingData || []}
        linkTo="/trend"
        isLoading={trendingLoading}
      />

      <VideoRow
        title="First Time Uploads"
        videos={firstUploadsData || []}
        linkTo="/firstupload"
        isLoading={firstUploadsLoading}
      />
    </div>
  );
};

export default HomeGrouped;
