import React from "react";
import "./EditorPreview.scss";

const EditorPreview = ({ content }) => {
  // Parse markdown images to HTML if needed
  const parseContent = (html) => {
    if (!html) return "";
    
    // Convert markdown images to HTML img tags
    return html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" />');
  };

  const processedContent = parseContent(content);

  return (
    <div className="editor-preview">
      <div 
        className="preview-content"
        dangerouslySetInnerHTML={{ __html: processedContent }}
      />
    </div>
  );
};

export default EditorPreview;

