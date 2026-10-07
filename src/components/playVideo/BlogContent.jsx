import MarkdownView from '../common/MarkdownView';
import React, { useEffect, useMemo, useState, useRef } from "react";
import { createRoot } from "react-dom/client";
import { useTranslation } from "react-i18next";
import { getUersContent } from "../../utils/hiveUtils";
import "./BlogContent.scss";
import { FaChevronDown, FaChevronUp } from "react-icons/fa";
import { TailChase } from 'ldrs/react';
import AudioPlayerInline from "../AudioPlayerInline/AudioPlayerInline";
import { getPostBodyRenderer } from "../../lib/hiveRenderer";
import { linkifyTimestamps, handleTimestampClick } from "../../utils/timestamps";

const THRESHOLD_HEIGHT = 100;

// `duration` + `onSeek` (content seconds) turn timestamps in the text into links
// that seek the player. Without them, or before the duration is known, the text
// stays as written.
const BlogContent = ({ author, permlink, description, alwaysExpanded = false, duration = 0, onSeek = null }) => {
  const { t } = useTranslation();
  const [content, setContent] = useState("");
  const [renderedContent, setRenderedContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [isExpanded, setIsExpanded] = useState(alwaysExpanded);
  const [needsExpansion, setNeedsExpansion] = useState(false);
  const contentRef   = useRef(null);
  const audioUrlsRef = useRef([]);
  const audioRootsRef = useRef([]);

  // Strip the "this video, on 3Speak" boilerplate our own uploads and the other
  // Hive frontends put in the body. The page IS that video, so a link back to it
  // is noise. The renderer no longer turns any of these into players (see
  // lib/hiveRenderer) — they arrive as plain anchors, and we drop the ones that
  // are pure self-reference.
  const cleanContent = (htmlString) => {
    let cleaned = htmlString;

    // A paragraph that is JUST a bare 3Speak link — our uploads and OpenPods
    // announcements lead the body with `play.3speak.tv/embed?v=…`. Only when the
    // link text equals the URL, so a labelled link ("▶ Watch on 3speak.tv") and
    // links to OTHER 3Speak videos survive. The optional <span> is the wrapper
    // the renderer's linkifier puts around a rewritten text node.
    cleaned = cleaned.replace(
      /<p[^>]*>\s*(?:<span>\s*)?<a[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*(?:<\/span>\s*)?<\/p>/gi,
      (m, href, text) => {
        if (!/(?:\/\/|\.)3speak\.tv/i.test(href)) return m;
        const norm = (s) => String(s).trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
        return norm(text) === norm(href) ? '' : m;
      }
    );

    // Pattern 4: "Watch on 3Speak" link with play emoji (as paragraph)
    cleaned = cleaned.replace(
      /<p[^>]*>[\s]*[▶️]*[\s]*<a[^>]*href="https:\/\/3speak\.tv\/watch[^"]*"[^>]*>[\s]*Watch on 3Speak[\s]*<\/a>[\s]*<\/p>/gi,
      ''
    );

    // Pattern 5: Standalone "Watch on 3Speak" links with emoji
    cleaned = cleaned.replace(
      /▶️[\s]*<a[^>]*href="https:\/\/3speak\.tv\/watch[^"]*"[^>]*>[^<]*<\/a>/gi,
      ''
    );

    // Pattern 6: Thumbnail image linking to 3speak watch page
    cleaned = cleaned.replace(
      /<a[^>]*href="https:\/\/3speak\.tv\/watch[^"]*"[^>]*>[\s]*<img[^>]*>[\s]*<\/a>/gi,
      ''
    );

    // Remove leading <hr> separating header from content
    cleaned = cleaned.replace(/^[\s]*<hr[^>]*\/?>/i, '');
    cleaned = cleaned.replace(/^[\s]*<hr[^>]*\/?>/i, '');

    cleaned = cleaned.replace(/<sub>[\s]*Uploaded using 3Speak[^<]*<\/sub>/gi, '');
    // Paragraphs the removals above hollowed out — a lone <br> or <span> counts
    // as empty, since that's what's left once the link inside is gone.
    cleaned = cleaned.replace(/<p[^>]*>(?:\s|<br[^>]*\/?>|<span>\s*<\/span>)*<\/p>/gi, '');
    cleaned = cleaned.replace(/<center>[\s]*<\/center>/gi, '');
    // …and the separator that used to sit above that boilerplate, now dangling
    // at the end of the post.
    cleaned = cleaned.replace(/(?:\s|<hr[^>]*\/?>)+$/i, '');
    cleaned = cleaned.trim();

    return cleaned;
  };

  async function getPostDescription(author, permlink) {
    const data = await getUersContent(author, permlink);
    return data?.body;
  }

  useEffect(() => {
    async function fetchContent() {
      setLoading(true);
      try {
        if (description) {
          setContent(description);
        } else if (author && permlink) {
          const postContent = await getPostDescription(author, permlink);
          setContent(postContent || t('comments.blog.noContent'));
        }
      } catch (err) {
        console.error('Failed fetching post content:', err);
        setContent(t('comments.blog.loadError'));
      }
    }
    fetchContent();
  }, [author, permlink, description, t]);

  useEffect(() => {
    if (!content) return;
    setLoading(true);

    const contentString =
      typeof content === "string"
        ? content
        : Array.isArray(content)
        ? content.join("\n")
        : "";

    getPostBodyRenderer()
      .then((render) => {
        try {
          let renderedHTML = render(contentString);
          renderedHTML = cleanContent(renderedHTML);

          // Extract audio.3speak.tv containers and replace with React mount slots
          const urls = [];
          renderedHTML = renderedHTML.replace(
            /<div class="audio-container">[\s\S]*?<\/div>/gi,
            (match) => {
              const srcMatch = match.match(/src="([^"]+)"/i);
              if (!srcMatch || !srcMatch[1].includes('audio.3speak.tv')) return match;
              const idx = urls.length;
              urls.push(srcMatch[1]);
              return `<div class="audio-player-slot" data-idx="${idx}"></div>`;
            }
          );
          audioUrlsRef.current = urls;
          setRenderedContent(renderedHTML);
        } catch (error) {
          console.error("Error rendering post body:", error);
          setRenderedContent(t('comments.blog.processError'));
        }
      })
      .catch((error) => {
        console.error("Error loading renderer:", error);
        setRenderedContent(t('comments.blog.rendererError'));
      })
      .finally(() => setLoading(false));
  }, [content, t]);

  // Mount native React audio players into the slots left by the renderer
  useEffect(() => {
    audioRootsRef.current.forEach(r => r.unmount());
    audioRootsRef.current = [];

    if (!contentRef.current || !audioUrlsRef.current.length) return;

    const slots = contentRef.current.querySelectorAll('.audio-player-slot');
    slots.forEach((slot) => {
      const idx = parseInt(slot.dataset.idx, 10);
      const url = audioUrlsRef.current[idx];
      if (url) {
        const root = createRoot(slot);
        root.render(<AudioPlayerInline src={url} />);
        audioRootsRef.current.push(root);
      }
    });

    return () => {
      audioRootsRef.current.forEach(r => r.unmount());
      audioRootsRef.current = [];
    };
  }, [renderedContent]);

  // Check if content needs expansion after rendering
  useEffect(() => {
    if (alwaysExpanded) return;
    if (contentRef.current && renderedContent) {
      requestAnimationFrame(() => {
        const contentHeight = contentRef.current?.scrollHeight || 0;
        setNeedsExpansion(contentHeight > THRESHOLD_HEIGHT);
      });
    }
  }, [renderedContent, alwaysExpanded]);

  const toggleExpand = () => setIsExpanded(!isExpanded);

  // Floored so the HTML only changes when a whole second is added to the video,
  // which is never during ordinary playback.
  const durationSec = onSeek ? Math.floor(duration || 0) : 0;
  const linkedContent = useMemo(
    () => linkifyTimestamps(renderedContent, durationSec),
    [renderedContent, durationSec],
  );

  return (
    <div className="blog-content-container">
      <div
        className={`content-wrapper ${needsExpansion && !isExpanded ? 'collapsed' : 'expanded'}`}
        ref={contentRef}
      >
        {loading ? (
          <div className="blog-loading">
            <div className="loader-center">
              <TailChase size={16} speed={1.5} color="var(--accent-primary)" />
            </div>
          </div>
        ) : (
          <MarkdownView
            html={linkedContent}
            onClick={(e) => handleTimestampClick(e, onSeek)}
          />
        )}
        {needsExpansion && !isExpanded && <div className="fade-overlay" />}
      </div>

      {needsExpansion && (
        <div className="expand-toggle" onClick={toggleExpand}>
          <span>{isExpanded ? t('common.actions.showLess') : t('common.actions.showMore')}</span>
          {isExpanded ? <FaChevronUp /> : <FaChevronDown />}
        </div>
      )}
    </div>
  );
};

export default BlogContent;
