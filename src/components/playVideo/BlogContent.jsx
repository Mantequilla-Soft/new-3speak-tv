import React, { useEffect, useState } from "react";
import { getUersContent } from "../../utils/hiveUtils";
import "./BlogContent.scss";

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

const BlogContent = ({ author, permlink, description }) => {
  const [content, setContent] = useState("");
  const [renderedContent, setRenderedContent] = useState("");

  // Function to remove unwanted content
  const cleanContent = (htmlString) => {
    // Remove "testing video upload OOT" text with Uploaded using 3Speak
    let cleaned = htmlString.replace(
      /<sub>Uploaded using 3Speak Mobile App<\/sub>/g,
      ''
    );

    // Remove 3Speak video embed
    cleaned = cleaned.replace(
      /<p dir="auto"><a class="markdown-video-link markdown-video-link-speak" data-embed-src="https:\/\/3speak\.tv\/embed\?v=[^"]+"><img class="no-replace video-thumbnail" src="[^"]+" \/><span class="markdown-video-play"><\/span><\/a><\/p>/g,
      ''
    );

    // Remove any empty <p> tags left behind
    cleaned = cleaned.replace(/<p dir="auto"><\/p>/g, '');

    return cleaned;
  };

  async function getPostDescription(author, permlink) {
    const data = await getUersContent(author, permlink);
    return data.body;
  }

  useEffect(() => {
    async function fetchContent() {
      if (description) {
        // Use provided description (upload preview)
        setContent(description);
      } else if (author && permlink) {
        // Fallback: fetch from Hive
        const postContent = await getPostDescription(author, permlink);
        setContent(postContent || "No content available");
      }
    }

    fetchContent();
  }, [author, permlink, description]);

  useEffect(() => {
    if (content) {
      const contentString =
        typeof content === "string"
          ? content
          : Array.isArray(content)
          ? content.join("\n")
          : "";

      // Use async renderer
      getRenderer().then(renderer => {
        try {
          let renderedHTML = renderer.render(contentString);
          // Clean the rendered HTML before setting it
          renderedHTML = cleanContent(renderedHTML);
          setRenderedContent(renderedHTML);
        } catch (error) {
          console.error("Error rendering post body:", error);
          setRenderedContent("Error processing content.");
        }
      }).catch(error => {
        console.error("Error loading renderer:", error);
        setRenderedContent("Error loading renderer.");
      });
    }
  }, [content]);

  return (
    <div
      className="markdown-view"
      dangerouslySetInnerHTML={{ __html: renderedContent }}
    />
  );
};

export default BlogContent;