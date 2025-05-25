import React, { useEffect, useState } from "react";
import { renderPostBody } from "@ecency/render-helper";
import { getUersContent } from "../../utils/hiveUtils";
import "./BlogContent.scss";

const BlogContent = ({ author, permlink }) => {
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
      const postContent = await getPostDescription(author, permlink);
      if (postContent) {
        setContent(postContent);
      } else {
        setContent("No content available");
      }
    }

    fetchContent();
  }, [author, permlink]);

  useEffect(() => {
    if (content) {
      const contentString =
        typeof content === "string"
          ? content
          : Array.isArray(content)
          ? content.join("\n")
          : "";

      try {
        let renderedHTML = renderPostBody(contentString, false);
        // Clean the rendered HTML before setting it
        renderedHTML = cleanContent(renderedHTML);
        setRenderedContent(renderedHTML);
      } catch (error) {
        console.error("Error rendering post body:", error);
        setRenderedContent("Error processing content.");
      }
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