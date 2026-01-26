import React, { useEffect, useState, useRef } from "react";
import { getUersContent } from "../../utils/hiveUtils";
import "./BlogContent.scss";
import { FaChevronDown, FaChevronUp } from "react-icons/fa";
import { ImSpinner9 } from 'react-icons/im';
import { TailChase } from 'ldrs/react';

// Lazy-loaded renderer to avoid Node.js polyfill issues at bundle time
let rendererPromise = null;
const getRenderer = async () => {
  if (!rendererPromise) {
    rendererPromise = import('@snapie/renderer').then(({ createHiveRenderer }) => {
      return createHiveRenderer({
        ipfsGateway: 'https://ipfs-3speak.b-cdn.net',
        ipfsFallbackGateways: [
          'https://ipfs.skatehive.app',
          'https://cloudflare-ipfs.com',
          'https://ipfs.io'
        ],
        convertHiveUrls: true,
        internalUrlPrefix: '',
        usertagUrlFn: (account) => `/p/${account}`,
        hashtagUrlFn: (tag) => `/t/${tag}`,
      });
    });
  }
  return rendererPromise;
};

const THRESHOLD_HEIGHT = 100;

const BlogContent = ({ author, permlink, description }) => {
  const [content, setContent] = useState("");
  const [renderedContent, setRenderedContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [needsExpansion, setNeedsExpansion] = useState(false);
  const contentRef = useRef(null);

  // Function to remove 3Speak video header from post body
  // Posts typically start with: <center>thumbnail + Watch on 3Speak link</center>---
  const cleanContent = (htmlString) => {
    let cleaned = htmlString;

    // Remove the 3Speak header block (multiple patterns to catch variations)
    // Pattern 1: The rendered video embed (iframe from @snapie/renderer)
    cleaned = cleaned.replace(
      /<div[^>]*class="[^"]*video-container[^"]*"[^>]*>[\s\S]*?<iframe[^>]*src="[^"]*3speak\.tv[^"]*"[^>]*>[\s\S]*?<\/iframe>[\s\S]*?<\/div>/gi,
      ''
    );

    // Pattern 2: Direct iframe embeds for 3speak
    cleaned = cleaned.replace(
      /<iframe[^>]*src="[^"]*3speak\.tv[^"]*"[^>]*>[\s\S]*?<\/iframe>/gi,
      ''
    );

    // Pattern 3: The rendered video embed link with thumbnail
    cleaned = cleaned.replace(
      /<p[^>]*>[\s]*<a[^>]*class="[^"]*markdown-video-link[^"]*"[^>]*data-embed-src="https:\/\/3speak\.tv\/embed[^"]*"[^>]*>[\s\S]*?<\/a>[\s]*<\/p>/gi,
      ''
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

    // Pattern 7: Remove leading <hr> (---) that separates header from content
    cleaned = cleaned.replace(/^[\s]*<hr[^>]*\/?>/i, '');

    // Also remove <hr> right after we stripped the header
    cleaned = cleaned.replace(/^[\s]*<hr[^>]*\/?>/i, '');

    // Remove "Uploaded using 3Speak Mobile App" footer
    cleaned = cleaned.replace(
      /<sub>[\s]*Uploaded using 3Speak[^<]*<\/sub>/gi,
      ''
    );

    // Remove any orphaned empty paragraphs
    cleaned = cleaned.replace(/<p[^>]*>[\s]*<\/p>/g, '');

    // Remove empty center tags
    cleaned = cleaned.replace(/<center>[\s]*<\/center>/gi, '');

    // Trim leading/trailing whitespace
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
          // Use provided description (upload preview)
          setContent(description);
        } else if (author && permlink) {
          // Fallback: fetch from Hive
          const postContent = await getPostDescription(author, permlink);
          setContent(postContent || "No content available");
        }
      } catch (err) {
        console.error('Failed fetching post content:', err);
        setContent('Error loading content.');
      }
    }

    fetchContent();
  }, [author, permlink, description]);

  useEffect(() => {
    if (content) {
      setLoading(true);
      const contentString =
        typeof content === "string"
          ? content
          : Array.isArray(content)
          ? content.join("\n")
          : "";

      // Use async renderer (createHiveRenderer returns a function directly)
      getRenderer()
        .then((render) => {
          try {
            let renderedHTML = render(contentString);
            // Clean the rendered HTML before setting it
            renderedHTML = cleanContent(renderedHTML);
            setRenderedContent(renderedHTML);
          } catch (error) {
            console.error("Error rendering post body:", error);
            setRenderedContent("Error processing content.");
          }
        })
        .catch((error) => {
          console.error("Error loading renderer:", error);
          setRenderedContent("Error loading renderer.");
        })
        .finally(() => setLoading(false));
    }
  }, [content]);

  // Check if content needs expansion after rendering
  useEffect(() => {
    if (contentRef.current && renderedContent) {
      // Use requestAnimationFrame to ensure DOM has updated
      requestAnimationFrame(() => {
        const contentHeight = contentRef.current?.scrollHeight || 0;
        setNeedsExpansion(contentHeight > THRESHOLD_HEIGHT);
      });
    }
  }, [renderedContent]);

  const toggleExpand = () => {
    setIsExpanded(!isExpanded);
  };

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
          <div
            className="markdown-view"
            dangerouslySetInnerHTML={{ __html: renderedContent }}
          />
        )}
        {needsExpansion && !isExpanded && <div className="fade-overlay" />}
      </div>

      {needsExpansion && (
        <div className="expand-toggle" onClick={toggleExpand}>
          <span>{isExpanded ? "Show less" : "Show more"}</span>
          {isExpanded ? <FaChevronUp /> : <FaChevronDown />}
        </div>
      )}
    </div>
  );
};

export default BlogContent;
