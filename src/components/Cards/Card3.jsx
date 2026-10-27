import PayoutAmount from "../PayoutAmount/PayoutAmount";
import { bodyToPlaintext } from '../../hive-api/hiveApi';
import { useDeadVideos } from '../../lib/deadVideos';
import UpvoteCount from "../UpvoteCount/UpvoteCount";
import CommentCount from "../CommentCount/CommentCount";
import { getCategoryOf, getTagLabel } from "../../utils/tagsV2";
import ViewCount from "../ViewCount/ViewCount";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import { IoCalendarOutline } from "react-icons/io5";
dayjs.extend(utc);
import { MdDelete, MdError, MdPhoneIphone, MdVisibilityOff } from "react-icons/md";
import { FaCog, FaFileAlt } from "react-icons/fa";
import { IoChevronBack, IoChevronForward, IoExpandOutline, IoContractOutline } from "react-icons/io5";
import { Leaf } from "lucide-react";
import CardOptionsMenu from "../CardOptionsMenu/CardOptionsMenu";
import TimeAgo from "../TimeAgo/TimeAgo";
import { Link, useNavigate } from "react-router-dom";
import PropTypes from "prop-types";
import "./Cards.scss";
import { useState, useMemo, memo, useCallback, useRef, useEffect } from "react";
import img from "../../assets/image/speak.jpg";
import CardThumbnail from "./CardThumbnail";
import { SpotlightSkeleton } from "./GridSkeleton";
import { fixVideoThumbnail, LANDSCAPE_LARGE } from "../../utils/fixThumbnails";
import AuthorBadge from "../AuthorBadge/AuthorBadge";
import ProfileModal from "../modal/ProfileModal";
import useHoverPreview from "../../hooks/useHoverPreview";
import { useCardWindowing, useWindowedCard } from "../../hooks/useCardWindowing";
import { AiPill } from "../AiBadge/AiBadge";
import { aiKey, isAiFlagged, useAiFlags } from "../../utils/aiFlags";
import { useAppStore } from "../../lib/store";
import { useTranslation } from "react-i18next";
import { formatDate } from "../../i18n";
import { watchPath } from '../../utils/urls';
import { shortHeading } from '../../utils/shortTitle';


/**
 * Splice extra nodes into the card grid after every `every` cards — used by the
 * Discover tab to drop a shorts rail between video rows.
 *
 * The inserted node must span the whole grid (`grid-column: 1 / -1`, see
 * ShortsRow.scss) or it would just occupy one cell and shove the row out of
 * alignment. `every` is computed from the LIVE column count, not guessed, so the
 * rail always lands on a row boundary at any breakpoint.
 */
// Supports MULTIPLE full-width interleave streams (e.g. shorts rails + community
// posts), each `{ every, render, key }`. Both can land after the same card.
// `offset` shifts the count when the first card is not one cell wide (the featured
// card), so every rail still lands on a row boundary.
function withInterleave(cards, channels, offset = 0) {
  const active = (channels || []).filter((c) => c && c.every >= 1 && typeof c.render === 'function');
  if (!active.length) return cards;
  const out = [];
  cards.forEach((card, i) => {
    out.push(card);
    if (i + 1 >= cards.length) return; // never append after the last card
    const n = i + 1 + offset;
    if (n < 1) return;
    active.forEach((ch) => {
      if (n % ch.every !== 0) return;
      const slot = n / ch.every - 1;
      const node = ch.render(slot);
      if (node) out.push(<div className="card-interleave" key={`${ch.key || 'il'}-${slot}`}>{node}</div>);
    });
  });
  return out;
}

// Hover hint for a shorts card. Shorts are Hive COMMENTS, so they have no real
// title — the caption lives in the body (same source the shorts viewer and the
// watch-page rail use). Feeds hand us either an already-flattened caption (the
// profile tabs map it into `title`) or the raw `hive_body`, so accept both.
const SHORT_HINT_MAX = 70;
function shortsHint(video) {
  const raw = (
    // The creator's `## Title` first line wins (utils/shortTitle.js).
    video.heading
    || shortHeading(video.hive_body)
    || video.caption
    || bodyToPlaintext(video.hive_body || '')
    || video.title
    || ''
  ).trim();
  if (!raw) return undefined;
  return raw.length > SHORT_HINT_MAX ? `${raw.slice(0, SHORT_HINT_MAX).trimEnd()}…` : raw;
}

// A card that is a short, in a grid that is NOT all shorts. `shortsGrid` makes
// the WHOLE grid portrait, which is right for a shorts row and wrong for a mixed
// feed: a profile with two shorts and a video should show each in its own shape
// rather than force one of them into the other's. Cards opt in with `_short`, so
// every existing caller is unaffected.
const isShortCard = (video, shortsGrid) => !!(shortsGrid || video?._short);

// Same key the grid uses for each card (and callers use for featuredKey).
const cardKeyOf = (v) => `${v.author?.username || v.author || v.owner}/${v.permlink}`;

// AI flag lookup keys for a card. The card is addressed by its hive author, but a
// short can carry the ASSET permlink with an owner who is not the hive author, so
// the owner pair is asked too. Live tiles are rooms, not videos.
const cardAuthorOf = (v) => v.author?.username || v.author || v.owner;
const aiKeysFor = (v) => (v._liveStream ? [] : [
  aiKey(cardAuthorOf(v), v.permlink),
  v.owner && v.owner !== cardAuthorOf(v) ? aiKey(v.owner, v.permlink) : null,
].filter(Boolean));
const isAiCard = (v) => !v._liveStream
  && (isAiFlagged(cardAuthorOf(v), v.permlink) || (!!v.owner && isAiFlagged(v.owner, v.permlink)));

// One card's link. Far from the viewport (windowed grids only) it renders as an
// empty slot of its last height; `render` draws the card's content otherwise.
function CardLink({ windowing, cardKey, index, cardProps, render, ...linkProps }) {
  const { ref: ownRef, ...restCardProps } = cardProps;
  const { ref, hiddenHeight } = useWindowedCard(windowing, cardKey, index, ownRef);
  if (hiddenHeight != null) {
    return <Link {...linkProps} {...restCardProps} ref={ref} style={{ height: hiddenHeight }} tabIndex={-1} aria-hidden="true" />;
  }
  return <Link {...linkProps} {...restCardProps} ref={ref}>{render()}</Link>;
}

// The rest of the featured line-up under the big card: five across, the others a
// sideways scroll away. A mouse wheel scrolls it sideways while over it (there is
// no other way to reach the hidden ones without a trackpad); at either end the
// wheel goes back to scrolling the page. Registered by hand because React's wheel
// listener is passive and cannot stop the page from scrolling.
function FeaturedStrip({ items, index, onPick }) {
  const { t } = useTranslation();
  const ref = useRef(null);
  // Which arrows to show: each hides at its end of the list
  const [ends, setEnds] = useState({ left: false, right: false });
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const update = () => {
      const max = el.scrollWidth - el.clientWidth;
      setEnds((prev) => {
        const next = { left: el.scrollLeft > 1, right: el.scrollLeft < max - 1 };
        return prev.left === next.left && prev.right === next.right ? prev : next;
      });
    };
    const onWheel = (e) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      const max = el.scrollWidth - el.clientWidth;
      if (max <= 0) return;
      if ((e.deltaY < 0 && el.scrollLeft <= 0) || (e.deltaY > 0 && el.scrollLeft >= max - 1)) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    update();
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('scroll', update, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    ro?.observe(el);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('scroll', update);
      ro?.disconnect();
    };
  }, [items, index]);
  // One page (the five in view) per click. Inside the card's link: never open it.
  const page = (e, dir) => {
    e.preventDefault();
    e.stopPropagation();
    const el = ref.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth, behavior: 'smooth' });
  };
  return (
    <div className="featured-strip-wrap">
      {ends.left && (
        <button type="button" className="featured-strip-arrow featured-strip-arrow--prev" aria-label={t('feeds.scrollLeft')} onClick={(e) => page(e, -1)}>
          <IoChevronBack aria-hidden="true" />
        </button>
      )}
      <div className="featured-strip" ref={ref}>
        {items.map((item, i) => (i === index ? null : (
          <button
            type="button"
            key={cardKeyOf(item)}
            className="featured-strip-item"
            title={item.title}
            aria-label={item.title}
            onClick={(e) => onPick(e, i)}
          >
            <img src={fixVideoThumbnail(item)} alt="" loading="lazy" decoding="async" />
          </button>
        )))}
      </div>
      {ends.right && (
        <button type="button" className="featured-strip-arrow featured-strip-arrow--next" aria-label={t('feeds.scrollRight')} onClick={(e) => page(e, 1)}>
          <IoChevronForward aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

// A video card opens /@author/permlink; other prefixes (/shorts) keep their ?v= form.
const cardHref = (linkPrefix, author, permlink, query) => (linkPrefix === '/watch'
  ? watchPath(author, permlink, query)
  : `${linkPrefix}?v=${author}/${permlink}${query}`);

function Card3({ videos = [], loading = false, error = null, interleaveEvery = 0, renderInterleave = null, communityEvery = 0, renderCommunity = null, creatorsEvery = 0, renderCreators = null, getContentForVideo = null, isWatched = null, getViewCount = null, isNew = null, linkPrefix = '/watch', linkQuery = '', shortTimeAgo = true, shortsGrid = false, priority = false, hideWatched = false, watchedVersion = 0, renderFooter = null, windowed = false, featuredKey = null, featuredLayout = null, featuredNav = null, featuredPending = false }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [modalUser, setModalUser] = useState(null);

  // Locally dismissed content ("not interested" / hidden creator). The checker
  // filters these out server-side, but only from the NEXT feed fetch — so we drop
  // the cards here immediately, and put them back if the user hits Undo.
  const [dismissed, setDismissed] = useState({ videos: new Set(), creators: new Set() });

  const handleDismiss = useCallback((kind, { owner, permlink } = {}) => {
    const key = `${String(owner).toLowerCase()}/${permlink}`;
    const creator = String(owner).toLowerCase();
    setDismissed((prev) => {
      const next = { videos: new Set(prev.videos), creators: new Set(prev.creators) };
      if (kind === "video") next.videos.add(key);
      else if (kind === "undo-video") next.videos.delete(key);
      else if (kind === "creator") next.creators.add(creator);
      else if (kind === "undo-creator") next.creators.delete(creator);
      return next;
    });
  }, []);

  // Hover-to-play preview (single reused player overlay) — shared with other grids.
  // On hover-capable devices the options menu is rendered INSIDE the preview
  // overlay: `.card:hover` sets a transform, which makes the card its own stacking
  // context, so a menu rendered in the card is always painted under the overlay.
  // Not for the Spotlight card: its menu sits in the SPOTLIGHT label row instead
  // (that card has no hover zoom, so the row already draws above the preview).
  const renderCardControls = useCallback(({ author, permlink, title, setLock }) => (
    featuredKey && `${author}/${permlink}` === featuredKey ? null : (
      <CardOptionsMenu
        author={author}
        permlink={permlink}
        title={title}
        onDismiss={handleDismiss}
        onOpenChange={setLock}
      />
    )
  ), [handleDismiss, featuredKey]);

  const { containerProps, getCardProps, overlay, canHover, startPreview } = useHoverPreview({
    renderControls: renderCardControls,
  });

  const formatViewCount = (views) => {
    if (views === null || views === undefined) return null;
    if (views >= 1000000) return `${(views / 1000000).toFixed(1)}M`;
    if (views >= 1000) return `${(views / 1000).toFixed(1)}K`;
    return views.toLocaleString();
  };

  // Videos the checker has confirmed are dead (404 on EVERY gateway). Cards preload
  // their own manifest, so a dead one is usually found while it's still on screen —
  // drop it right away instead of leaving a card that plays nothing until the next
  // feed fetch. Empty on the normal path, so this costs nothing.
  const deadVideos = useDeadVideos();

  // AI-generated flags: one batched lookup for the whole grid. Drives the AI pill
  // on each card and, with "Hide AI-generated" on, drops flagged cards. Like the
  // dead-video filter above it is client-side, so it covers every feed that
  // renders through Card3 without each checker route having to know about it. A
  // flagged card can show for a moment before its answer lands and it goes.
  const hideAi = useAppStore((s) => s.hideAi);
  const aiKeys = useMemo(() => videos.flatMap(aiKeysFor), [videos]);
  const aiVersion = useAiFlags(aiKeys);

  // Memoize video processing to prevent re-computing thumbnails on every render
  const processedVideos = useMemo(() => {
    const ownerOf = (v) => String(v.author?.username || v.author || v.owner || "").toLowerCase();
    return videos
      .filter((v) => !dismissed.creators.has(ownerOf(v)))
      .filter((v) => !dismissed.videos.has(`${ownerOf(v)}/${v.permlink}`))
      .filter((v) => !deadVideos.has(`${ownerOf(v)}/${v.permlink}`))
      .filter((v) => !(hideAi && isAiCard(v)))
      // Already-watched: same reason as `dismissed` above — the checker only drops
      // watched videos from the NEXT feed fetch, so a just-watched one lingers in the
      // cached feed until then. When the caller opts in (feeds with "Hide watched"
      // on), drop it here immediately. Opt-in so profiles/playlists/related — which
      // pass isWatched only to BADGE — keep showing watched videos.
      //
      // NOTE the author here is the NON-lowercased `video.author?.username || …`,
      // matching exactly how useWatchHistory keys its map and how the badge below
      // calls isWatched (vcAuthor) — `ownerOf` lowercases and would miss.
      // watchedVersion is in the deps so this recomputes when watch data arrives
      // (isWatched is a stable ref-reader and wouldn't trigger it alone).
      .filter((v) => !(hideWatched && isWatched
        && isWatched(v.author?.username || v.author || v.owner, v.permlink) === true))
      .map((video, i) => ({
        ...video,
        _featured: i === 0 && !!featuredLayout && featuredKey === cardKeyOf(video),
        // Portrait resize for a portrait card, whether the whole grid is shorts
        // or just this one is: asking for a 340x191 crop of a 9:16 source is
        // what makes a mixed grid look like a row of letterboxed accidents.
        _processedThumbnail: video._liveStream
          ? video.thumbnail
          : fixVideoThumbnail(video, isShortCard(video, shortsGrid),
            i === 0 && !!featuredLayout && featuredKey === cardKeyOf(video) ? LANDSCAPE_LARGE : null)
      }));
    // aiVersion: isAiFlagged reads a module cache, so the counter is what makes
    // this recompute when answers arrive.
  }, [videos, shortsGrid, dismissed, deadVideos, hideWatched, isWatched, watchedVersion, hideAi, aiVersion, featuredKey, featuredLayout]);

  // A mixed grid (shorts beside videos) sizes each card's WIDTH from its content
  // on desktop, so an empty slot would collapse. It is only ever a short profile
  // list, so it simply isn't windowed.
  const mixed = !shortsGrid && processedVideos.some((v) => v._short);
  const windowing = useCardWindowing(windowed && !mixed);

  // The featured card's arrows and strip step through featuredNav.items. They sit
  // inside the card's link, so a click must not also open the video.
  const featuredBrowsable = featuredLayout?.rows > 1 && featuredNav?.items?.length > 1;
  // The video a click just chose: once it is the big card, its preview starts by
  // itself (below), without waiting for a hover.
  const pendingPreviewRef = useRef(null);
  const selectFeatured = (e, i) => {
    e.preventDefault();
    e.stopPropagation();
    const n = featuredNav.items.length;
    const next = ((i % n) + n) % n;
    pendingPreviewRef.current = cardKeyOf(featuredNav.items[next]);
    featuredNav.onSelect(next);
  };
  const featuredFirst = processedVideos[0]?._featured ? processedVideos[0] : null;
  // Its block, held by a skeleton while the featured videos are still on the way
  const featuredPlaceholder = featuredPending && !!featuredLayout && !featuredFirst
    ? <SpotlightSkeleton key="featured-skeleton" layout={featuredLayout} />
    : null;
  const featuredFirstKey = featuredFirst ? cardKeyOf(featuredFirst) : null;
  useEffect(() => {
    if (!featuredFirstKey || pendingPreviewRef.current !== featuredFirstKey) return;
    pendingPreviewRef.current = null;
    startPreview(featuredFirstKey, featuredFirst.title);
    // Only when the big card changes; startPreview and the card are read fresh then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [featuredFirstKey]);

  if (loading && videos.length === 0) return <div>{t('cards.loading')}</div>;
  if (error) return <div>{t('cards.error', { error })}</div>;

  return (
    <div
      className={`card-container${shortsGrid ? ' card-container--shorts' : ''}${
        mixed ? ' card-container--mixed' : ''
      }`}
      {...containerProps}
    >
      {withInterleave([...(featuredPlaceholder ? [featuredPlaceholder] : []), ...processedVideos.map((video, index) => {
        const postKey = `${video.author?.username || video.author || video.owner}/${
          video.permlink
        }`;

        const cardAuthor = video.author?.username || video.author || video.owner;

        return (
          <CardLink
            windowing={windowing}
            cardKey={postKey}
            index={index}
            to={video._liveStream
              ? (video._openpodRoom ? `/openpods/${video.roomName}` : `/watch/${video.roomName}`)
              : cardHref(linkPrefix, cardAuthor, video.permlink,
                `${linkQuery}${video._scheduled ? '&scheduled=1' : ''}`)}
            className={`card${!shortsGrid && video._short ? ' card--short' : ''}${video._featured ? ` card--featured${featuredLayout.rows > 1 ? ' card--featured-tall' : ''}` : ''}`}
            style={video._featured
              ? { gridColumn: `span ${featuredLayout.span}`, gridRow: `span ${featuredLayout.rows}` }
              : undefined}
            key={postKey}
            data-vidkey={postKey}
            cardProps={video._liveStream
              ? {}
              : getCardProps(postKey, cardAuthor, video.permlink, video._processedThumbnail, video.status, video.title)}
            {...(isShortCard(video, shortsGrid) ? { title: shortsHint(video) } : {})}
            render={() => (<>
            {/* Thumbnail — fast fallback so a dead image host can't leave the
                card blank for ~a minute (see CardThumbnail). */}
            <div className="img-wrap">
              <CardThumbnail
                src={video._processedThumbnail}
                fallback={img}
                eager={priority && index < 6}
              />
              {video._featured && (
                <div className="card-spotlight">
                  <span className="card-spotlight-badge">{t('cards.badges.spotlight')}</span>
                  {featuredNav?.size && featuredLayout?.rows > 1 && (
                    <button
                      type="button"
                      className="card-spotlight-size"
                      title={`${t('cards.spotlightSize.label')}: ${t(`cards.spotlightSize.${featuredNav.size}`)}`}
                      aria-label={`${t('cards.spotlightSize.label')}: ${t(`cards.spotlightSize.${featuredNav.size}`)}`}
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); featuredNav.onCycleSize(); }}
                    >
                      {/* Shows what a click does: grow while small, shrink while medium */}
                      {featuredNav.size === 'medium'
                        ? <IoContractOutline aria-hidden="true" />
                        : <IoExpandOutline aria-hidden="true" />}
                    </button>
                  )}
                  {/* The card menu, next to the size button */}
                  <CardOptionsMenu
                    author={cardAuthor}
                    permlink={video.permlink}
                    title={video.title}
                    onDismiss={handleDismiss}
                    className="card-options-btn--spotlight"
                  />
                </div>
              )}
              {video._featured && featuredBrowsable && (
                <>
                  <button
                    type="button"
                    className="featured-arrow featured-arrow--prev"
                    aria-label={t('player.playlist.previous')}
                    onClick={(e) => selectFeatured(e, featuredNav.index - 1)}
                  >
                    <IoChevronBack aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="featured-arrow featured-arrow--next"
                    aria-label={t('player.playlist.next')}
                    onClick={(e) => selectFeatured(e, featuredNav.index + 1)}
                  >
                    <IoChevronForward aria-hidden="true" />
                  </button>
                </>
              )}
              {!isShortCard(video, shortsGrid) && !video._liveStream && (
                <div className="wrap">
                  <span className="play">
                    {Math.floor((video.spkvideo?.duration || video.duration) / 60)}:
                    {Math.floor((video.spkvideo?.duration || video.duration) % 60)
                      .toString()
                      .padStart(2, "0")}
                  </span>
                </div>
              )}

              {/* 🔐 Supporters-only tile → lock badge (top-left, so it never
                  collides with the live badge or the options menu on the right).
                  Presentation only: the gate re-checks entitlement on every
                  manifest and key request, so hiding this badge would not grant
                  anyone access. Shorts are never gated. */}
              {video.gated && !isShortCard(video, shortsGrid) && (
                <div className="card-gated-badge" title={t('cards.badges.gatedTitle')}>
                  <span aria-hidden="true">🔒</span> {t('cards.badges.pro')}
                </div>
              )}

              {/* New since the viewer's last visit (community pages pass isNew).
                  Top-left like the PRO badge, and below it when both apply. */}
              {isNew?.(video) && (
                <div className={`card-new-badge${video.gated && !isShortCard(video, shortsGrid) ? ' card-new-badge--below' : ''}`}>
                  {t('cards.badges.new')}
                </div>
              )}

              {/* AI-generated → small pill, bottom-left of the thumbnail. */}
              {isAiCard(video) && <AiPill className="ai-badge--on-thumb" />}

              {/* Live tile → badge (top-right). A group-chat (conference) room
                  reads "LIVE CHAT"; a standalone stream reads "LIVE". */}
              {video._liveStream && (
                <div className="card-live-badge">{video._openpodRoom ? t('cards.badges.liveChat') : t('cards.badges.live')}</div>
              )}

              {/* Options menu (playlist / not interested / hide creator).
                  Hover-capable devices get it inside the preview overlay instead —
                  see renderCardControls above. Touch devices never get the
                  `.card:hover` transform, so rendering here works for them. */}
              {!canHover && !video._featured && (
                <CardOptionsMenu
                  author={video.author?.username || video.author || video.owner}
                  permlink={video.permlink}
                  title={video.title}
                  onDismiss={handleDismiss}
                />
              )}

              {/* Status Badges */}
              {video.status === 'scheduled' && video.publish_type === 'schedule' && (
                <div className="status-badge scheduled">
                  <IoCalendarOutline size={18} />
                  <span>
                    {video.publish_data
                      ? formatDate(typeof video.publish_data === 'number' ? video.publish_data * 1000 : video.publish_data, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
                      : t('cards.status.scheduled')}
                  </span>
                </div>
              )}

              {video.publish_type === 'publish_manual' && (
                <div className="status-badge manual" title={t('cards.status.mobileTitle')}>
                  <MdPhoneIphone size={18} />
                  <span>{t('cards.status.mobile')}</span>
                </div>
              )}

              {video.status === 'encoding' && (
                <div className="status-badge encoding" title={t('cards.status.processingTitle')}>
                  <FaCog size={16} className="spin-icon" />
                  <span>{t('cards.status.processing')}</span>
                </div>
              )}

              {video.status === 'draft' && (
                <div className="status-badge draft" title={t('cards.status.draftTitle')}>
                  <FaFileAlt size={16} />
                  <span>{t('cards.status.draft')}</span>
                </div>
              )}

              {video.status === 'deleted' && (
                <div className="status-badge deleted" title={t('cards.status.deletedTitle')}>
                  <MdDelete size={18} />
                  <span>{t('cards.status.deleted')}</span>
                </div>
              )}

              {video.status === 'failed' && (
                <div className="status-badge failed" title={t('cards.status.failedTitle')}>
                  <MdError size={18} />
                  <span>{t('cards.status.failed')}</span>
                </div>
              )}

              {video.unlisted && (
                <div className="status-badge unlisted" title={t('cards.status.unlistedTitle')}>
                  <MdVisibilityOff size={18} />
                  <span>{t('cards.status.unlisted')}</span>
                </div>
              )}
            </div>

            {/* Title */}
            <h2>{video.title}</h2>

            {/* Author */}
            <div className="profile-view-wrap">
              {video._incubation ? (
                /* A warm-up user (on 3Speak, not on Hive yet): a leaf next to the
                   name, its hint the same title + line the old "new on 3Speak"
                   section used as its heading. Next to the author, not on the
                   thumbnail, because the hover preview covers the thumbnail and
                   would hide the hint. */
                <span className="card-author-group">
                  <AuthorBadge author={cardAuthor} noLink compact offChainAuthor />
                  <span
                    className="card-incubation-leaf"
                    role="img"
                    aria-label={t('incubation.rail.aria')}
                    title={`${t('incubation.rail.title')}\n${t('incubation.rail.body')}`}
                  >
                    <Leaf size={14} aria-hidden="true" />
                  </span>
                </span>
              ) : (
                <AuthorBadge
                  author={video.author?.username || video.author || video.owner}
                  noLink
                  compact
                />
              )}
              {/* 1st-level v2 tag (the category the auto-tag rolls up to), left of
                  the view count. Visibility is CSS-driven (see .card-topic-chip):
                  shown on desktop whatever the layout, and on large cards
                  everywhere — hidden only on small cards on a phone. */}
              {(() => {
                const cat = getCategoryOf(video.tag_v2);
                if (!cat) return null;
                return (
                  <span className="card-topic-chip" title={t('cards.topicTitle', { topic: getTagLabel(cat) })}>
                    {getTagLabel(cat)}
                  </span>
                );
              })()}
              {(() => {
                const vcAuthor = video.author?.username || video.author || video.owner;
                // Prefer the count already in the feed payload (the only source that
                // resolves embed videos — /views can't look them up by hive permlink).
                // Fall back to the batched /views fetch for legacy videos.
                const feedViews = video.views ?? video.stats?.num_views;
                const fetchedViews = getViewCount?.(vcAuthor, video.permlink);
                const resolvedViews = feedViews != null ? feedViews : fetchedViews;
                if (resolvedViews == null) return null;
                return (
                  <ViewCount
                    views={resolvedViews}
                    watched={!video._liveStream && isWatched?.(vcAuthor, video.permlink) === true}
                    formatViews={formatViewCount}
                    /* On a live tile the same slot counts people watching RIGHT
                       NOW, not lifetime views — say so on hover, since the bare
                       number next to a LIVE badge reads as either. */
                    title={video._liveStream
                      ? t('cards.watchingNow', { count: resolvedViews })
                      : undefined}
                  />
                );
              })()}
            </div>

            {/* Bottom actions */}
            <div className="bottom-action">
              <div className="wrap-left">
                {/* An off-chain post has no payout and never will until it is
                    republished to Hive, so the slot is omitted rather than left
                    showing a placeholder that reads as "still loading". */}
                {!video._incubation && <PayoutAmount
                  amount={(() => {
                    const author = video.author?.username || video.author || video.owner;
                    const content = getContentForVideo?.(author, video.permlink);
                    const val = content?.payout ?? video.stats?.total_hive_reward;
                    return val != null ? Number(val) : null;
                  })()}
                />}
                <UpvoteCount
                  count={(() => {
                    const author = video.author?.username || video.author || video.owner;
                    const content = getContentForVideo?.(author, video.permlink);
                    return content?.voters ?? video.stats?.num_votes ?? null;
                  })()}
                />
                <CommentCount
                  count={(() => {
                    const author = video.author?.username || video.author || video.owner;
                    // Fall back to the feed's cached count (video-stats), same as
                    // payout/votes above — feed items have has_stats:true so the
                    // client-side content batch skips them and children is absent.
                    return getContentForVideo?.(author, video.permlink)?.children ?? video.stats?.num_comments ?? null;
                  })()}
                />
              </div>
              <p><TimeAgo date={video.created_at || video.created} short={shortTimeAgo} /></p>
            </div>

            {/* The rest of the featured line-up, small, at the bottom of the card. */}
            {video._featured && featuredBrowsable && (
              <FeaturedStrip items={featuredNav.items} index={featuredNav.index} onPick={selectFeatured} />
            )}

            {/* Caller-specific line under the card (watch history: when it was
                watched, and its remove button). Anything clickable in it must
                stop the event, or the click also follows the card's link. */}
            {renderFooter?.(video)}
            </>)}
          />
        );
      })], [
        { every: interleaveEvery, render: renderInterleave, key: 'shorts' },
        { every: communityEvery, render: renderCommunity, key: 'community' },
        { every: creatorsEvery, render: renderCreators, key: 'creators' },
      ], featuredFirst || featuredPlaceholder ? featuredLayout.weight - 1 : 0)}
      {modalUser && (
        <ProfileModal
          username={modalUser}
          onClose={() => setModalUser(null)}
        />
      )}

      {overlay}
    </div>
  );
}

Card3.propTypes = {
  videos: PropTypes.array.isRequired,
  loading: PropTypes.bool,
  error: PropTypes.string,
  getContentForVideo: PropTypes.func,
  isWatched: PropTypes.func,
  isNew: PropTypes.func,             // (video) => true badges the card NEW
  hideWatched: PropTypes.bool,       // opt-in: drop (not just badge) already-watched videos
  watchedVersion: PropTypes.number,  // bump from useWatchHistory so the filter reacts to new data
  getViewCount: PropTypes.func,
  linkPrefix: PropTypes.string,
  renderFooter: PropTypes.func,      // (video) => node drawn under the card's bottom row
  windowed: PropTypes.bool,
  featuredKey: PropTypes.string,     // "author/permlink" of a first card to draw large
  featuredPending: PropTypes.bool,   // hold that block with a skeleton until the card is there
  featuredNav: PropTypes.shape({      // the featured line-up the card's arrows / strip step through
    items: PropTypes.array, index: PropTypes.number, onSelect: PropTypes.func,
    size: PropTypes.string,          // 'small' | 'medium', null = no size toggle
    onCycleSize: PropTypes.func,
  }),
  featuredLayout: PropTypes.shape({  // its size in grid cells; weight = cells it counts as for the rails
    span: PropTypes.number, rows: PropTypes.number, weight: PropTypes.number,
  }),          // long feeds: far-off cards render as empty slots (see useCardWindowing)
};

export default memo(Card3);
