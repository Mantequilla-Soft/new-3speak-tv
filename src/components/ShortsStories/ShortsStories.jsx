import { useRef, useState, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { FaChevronLeft, FaChevronRight, FaPlus } from "react-icons/fa";
import { SHORTS_STORIES_URL } from "../../utils/config";
import { useAppStore } from "../../lib/store";
import HiveAvatar from "../HiveAvatar/HiveAvatar";
import "./ShortsStories.scss";
import { useTranslation } from "react-i18next";

const fetchShortsStories = async (username) => {
  const params = {};
  if (username) {
    // currentuser drives the always-on dismissals; hidewatched is the preference.
    params.currentuser = username;
    params.hidewatched = useAppStore.getState().hideWatched ? '1' : '0';
  }
  if (useAppStore.getState().showNsfw) params.nsfw = 'true';
  const res = await axios.get(SHORTS_STORIES_URL, { params });
  return res.data;
};

/**
 * Custom hook to access shorts stories data.
 * Use this from external components (e.g. Short.jsx) to get the creator list
 * without rendering the stories bar.
 */
export const useShortsStories = () => {
  const { user, showNsfw } = useAppStore();

  const { data, isLoading } = useQuery({
    queryKey: ["shorts-stories", user, showNsfw],
    queryFn: () => fetchShortsStories(user),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  return {
    creators: data?.creators || [],
    currentUserHasShort: data?.currentUserHasShort || false,
    isLoading,
  };
};

/**
 * ShortsStories component — horizontal row of creator avatars.
 *
 * Props:
 * - activeCreator: string | null — username of the currently selected creator (highlighted)
 * - onCreatorSelect: (username: string) => void — called when a creator avatar is clicked
 *                    If not provided, defaults to navigating to /shorts?user=username
 * - compact: boolean — smaller avatars for the shorts player context
 * - hiddenOnMobile: boolean — hide the entire bar on mobile (for shorts player, where swipe is used instead)
 */
const ShortsStories = ({ activeCreator, onCreatorSelect, compact = false, hiddenOnMobile = false }) => {
  const { t } = useTranslation();
  const { authenticated, user } = useAppStore();
  const navigate = useNavigate();
  const scrollRef = useRef(null);
  const [showLeft, setShowLeft] = useState(false);
  const [showRight, setShowRight] = useState(false);
  const dragStartScrollLeft = useRef(null);
  const isDragging = useRef(false);

  const { creators, currentUserHasShort, isLoading } = useShortsStories();

  const checkScrollButtons = () => {
    if (scrollRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
      setShowLeft(scrollLeft > 10);
      setShowRight(scrollLeft < scrollWidth - clientWidth - 10);
    }
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      checkScrollButtons();
      el.addEventListener("scroll", checkScrollButtons);
      return () => el.removeEventListener("scroll", checkScrollButtons);
    }
  }, [creators, isLoading]);

  // Auto-scroll to active creator when it changes
  useEffect(() => {
    if (!activeCreator || !scrollRef.current) return;
    const container = scrollRef.current;
    const activeEl = container.querySelector(`[data-creator="${activeCreator}"]`);
    if (activeEl) {
      const containerRect = container.getBoundingClientRect();
      const elRect = activeEl.getBoundingClientRect();
      const offset = elRect.left - containerRect.left - containerRect.width / 2 + elRect.width / 2;
      container.scrollBy({ left: offset, behavior: "smooth" });
    }
  }, [activeCreator]);

  const scroll = (direction) => {
    if (scrollRef.current) {
      scrollRef.current.scrollBy({
        left: direction === "left" ? -200 : 200,
        behavior: "smooth",
      });
    }
  };

  // Track scroll-container drags so we can suppress clicks after dragging
  const onScrollPointerDown = useCallback(() => {
    dragStartScrollLeft.current = scrollRef.current?.scrollLeft ?? 0;
    isDragging.current = false;
  }, []);

  const onScrollPointerUp = useCallback(() => {
    const moved = Math.abs((scrollRef.current?.scrollLeft ?? 0) - (dragStartScrollLeft.current ?? 0));
    isDragging.current = moved > 5;
  }, []);

  const handleCreatorClick = useCallback((username) => {
    if (isDragging.current) return;
    if (onCreatorSelect) {
      onCreatorSelect(username);
    } else {
      navigate(`/shorts/stories?user=${username}`);
    }
  }, [onCreatorSelect, navigate]);

  const handleOwnAvatarClick = useCallback(() => {
    if (isDragging.current) return;
    navigate("/embed-studio?from=stories");
  }, [navigate]);

  // Don't render if no data and not loading
  if (!isLoading && creators.length === 0 && !authenticated) return null;

  const wrapperClass = [
    "shorts-stories",
    compact && "shorts-stories--compact",
    hiddenOnMobile && "shorts-stories--hidden-mobile",
  ].filter(Boolean).join(" ");

  return (
    <div className={wrapperClass}>
      <div className="stories-scroll-wrapper">
        {showLeft && (
          <button className="stories-scroll-btn left" onClick={() => scroll("left")}>
            <FaChevronLeft />
          </button>
        )}

        <div
          className="stories-scroll-container"
          ref={scrollRef}
          onPointerDown={onScrollPointerDown}
          onPointerUp={onScrollPointerUp}
        >
          {isLoading ? (
            <div className="stories-skeleton-row">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="story-item skeleton-story">
                  <div className="story-avatar-wrap">
                    <div className="skeleton story-avatar-skeleton" />
                  </div>
                  <div className="skeleton story-name-skeleton" />
                </div>
              ))}
            </div>
          ) : (
            <div className="stories-row">
              {/* Current user avatar — always first */}
              {authenticated && (
                <div className="story-item own-story" onClick={handleOwnAvatarClick}>
                  <div
                    className={`story-avatar-wrap ${
                      currentUserHasShort ? "border-foreground" : "border-primary"
                    }`}
                  >
                    <HiveAvatar
                      username={user}
                      size={null}
                      alt={user}
                      imgClassName="story-avatar"
                      onError={(e) => {
                        e.currentTarget.src = `https://ui-avatars.com/api/?name=${user}&background=dc2626&color=ffffff&size=150`;
                      }}
                      badgeSize={12}
                    />
                    <div className="add-badge">
                      <FaPlus />
                    </div>
                  </div>
                  <span className="story-username">{t("shorts.stories.you")}</span>
                </div>
              )}

              {/* Other creators */}
              {creators
                .filter((c) => c.username !== user)
                .map((creator) => {
                  const isActive = activeCreator === creator.username;
                  return (
                    <div
                      key={creator.username}
                      data-creator={creator.username}
                      className={`story-item${isActive ? " story-item--active" : ""}`}
                      onClick={() => handleCreatorClick(creator.username)}
                    >
                      <div
                        className={`story-avatar-wrap ${
                          creator.followed ? "border-primary" : "border-foreground"
                        }`}
                      >
                        <HiveAvatar
                          username={creator.username}
                          size={null}
                          alt={creator.username}
                          imgClassName="story-avatar"
                          onError={(e) => {
                            e.currentTarget.src = `https://ui-avatars.com/api/?name=${creator.username}&background=dc2626&color=ffffff&size=150`;
                          }}
                          badgeSize={12}
                        />
                        {creator.unseen_count > 1 && (
                          <div className="count-badge">{creator.unseen_count}</div>
                        )}
                      </div>
                      <span className="story-username">{creator.username}</span>
                    </div>
                  );
                })}
            </div>
          )}
        </div>

        {showRight && (
          <button className="stories-scroll-btn right" onClick={() => scroll("right")}>
            <FaChevronRight />
          </button>
        )}
      </div>
    </div>
  );
};

export default ShortsStories;
