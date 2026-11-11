import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Icon } from "../v2/Icon";
import HiveAvatar from "../HiveAvatar/HiveAvatar";
import AddToPlaylistModal from "../AddToPlaylistModal/AddToPlaylistModal";
import ShareChooserModal from "../Chat/ShareChooserModal";
import { fixVideoThumbnail } from "../../utils/fixThumbnails";
import { watchPath } from "../../utils/urls";
import { getPostDetails } from "../../hive-api/hiveApi";
import { getFollowers } from "../../hive-api/api";
import { formatNumber } from "../../i18n";
import "./HomeHero.scss";

// The picture behind the hero is drawn full width, so it asks for a big crop.
const HERO_SIZE = { w: 1280, h: 720 };

const clock = (sec) => {
  const n = Math.floor(Number(sec) || 0);
  if (!n) return null;
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const s = String(n % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
};

/**
 * The Spotlight hero at the top of Home (20a): the featured video's picture
 * full width behind the top bar, fading into the page; a cyan chip naming the
 * community it was posted in, the title at 64/900, the creator with their
 * follower count, then Play (an ink slab) and Save / Share tiles.
 *
 * `video` is the featured video (HomeGrouped picks it). While it is on its way
 * (`pending`) the hero holds its space with the striped placeholder.
 */
export default function HomeHero({ video, pending = false }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [saveOpen, setSaveOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  const author = video ? (video.author?.username || video.author || video.owner) : null;
  const permlink = video?.permlink || null;

  // The community the post sits in and the creator's follower count: one read
  // each, for this one video (the feed payload carries neither).
  const { data: post } = useQuery({
    queryKey: ["hero-post", author, permlink],
    queryFn: () => getPostDetails(author, permlink),
    enabled: !!author && !!permlink,
    staleTime: 10 * 60 * 1000,
  });
  const { data: follow } = useQuery({
    queryKey: ["hero-followers", author],
    queryFn: () => getFollowers(author),
    enabled: !!author,
    staleTime: 10 * 60 * 1000,
  });

  // Let the phone top bar go see-through while the hero is under it (nav.scss).
  const shown = !!video || pending;
  useEffect(() => {
    if (!shown) return undefined;
    document.documentElement.setAttribute("data-home-hero", "");
    return () => document.documentElement.removeAttribute("data-home-hero");
  }, [shown]);

  if (!shown) return null;

  if (!video) {
    return (
      <section className="home-hero is-pending" aria-busy="true">
        <div className="home-hero__bg" aria-hidden="true" />
        <div className="home-hero__body">
          <span className="home-hero__ph is-chip" />
          <span className="home-hero__ph is-title" />
          <span className="home-hero__ph is-title is-short" />
          <span className="home-hero__ph is-play" />
        </div>
      </section>
    );
  }

  const href = watchPath(author, permlink);
  const thumb = fixVideoThumbnail(video, false, HERO_SIZE);
  const duration = clock(video.spkvideo?.duration || video.duration);
  const community = post?.community_title || null;
  const followers = follow?.follower_count;
  const followersLabel = followers != null
    ? t("common.units.followers", { count: followers }).replace(String(followers), formatNumber(followers))
    : null;
  const openCreator = () => navigate(`/@${author}`);

  return (
    <section className="home-hero" aria-label={t("cards.badges.spotlight")}>
      <div className="home-hero__bg" aria-hidden="true">
        {thumb && <img src={thumb} alt="" decoding="async" fetchpriority="high" />}
      </div>

      <div className="home-hero__body">
        <div className="home-hero__chip">
          <span className="home-hero__chip-tile" aria-hidden="true">
            {(community || t("cards.badges.spotlight")).slice(0, 1).toUpperCase()}
          </span>
          <span className="home-hero__chip-text is-wide">
            {community ? t("feeds.home.hero.spotlightIn", { community }) : t("cards.badges.spotlight")}
          </span>
          <span className="home-hero__chip-text is-narrow">{community || t("cards.badges.spotlight")}</span>
          {duration && <span className="home-hero__chip-time">· {duration}</span>}
        </div>

        <h2 className="home-hero__title">
          <Link to={href}>{video.title}</Link>
        </h2>

        <div className="home-hero__creator">
          <button type="button" className="home-hero__avatar" onClick={openCreator} aria-label={`@${author}`}>
            <HiveAvatar username={author} size="small" alt="" />
          </button>
          <button type="button" className="home-hero__name" onClick={openCreator}>{author}</button>
          {followersLabel && <span className="home-hero__followers">· {followersLabel}</span>}
        </div>

        <div className="home-hero__actions">
          <Link to={href} className="home-hero__play">
            <span>{t("common.actions.play")}</span>
            <Icon name="play_arrow" size={32} fill />
          </Link>
          <button type="button" className="home-hero__tile" onClick={() => setSaveOpen(true)} aria-label={t("common.actions.save")}>
            <Icon name="bookmark" size={24} />
            <span>{t("common.actions.save")}</span>
          </button>
          <button type="button" className="home-hero__tile" onClick={() => setShareOpen(true)} aria-label={t("common.actions.share")}>
            <Icon name="ios_share" size={24} />
            <span>{t("common.actions.share")}</span>
          </button>
        </div>
      </div>

      <AddToPlaylistModal
        isOpen={saveOpen}
        onClose={() => setSaveOpen(false)}
        author={author}
        permlink={permlink}
        videoTitle={video.title}
        thumbnail={thumb}
      />
      <ShareChooserModal
        open={shareOpen}
        url={`${window.location.origin}/@${author}/${permlink}`}
        title={video.title}
        embed={{ author, permlink }}
        hivePost={{ author, permlink }}
        onClose={() => setShareOpen(false)}
        onGeneralShare={() => {
          const url = `${window.location.origin}/@${author}/${permlink}`;
          if (navigator.share) navigator.share({ title: video.title, url }).catch(() => {});
          else navigator.clipboard?.writeText(url).catch(() => {});
        }}
      />
    </section>
  );
}
