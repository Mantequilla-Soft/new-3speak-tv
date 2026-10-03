import React, { useMemo, useState, useEffect } from "react";
import { getPostBodyRenderer } from '../../lib/hiveRenderer';
import "./EditorPreview.scss";
import { useTranslation } from "react-i18next";

const EditorPreview = ({ content }) => {
  const { t } = useTranslation();
  const [renderedContent, setRenderedContent] = useState("");

  useEffect(() => {
    if (!content) {
      setRenderedContent("");
      return;
    }
    
    getPostBodyRenderer().then(render => {
      try {
        setRenderedContent(render(content));
      } catch (error) {
        console.error("Error rendering content:", error);
        setRenderedContent(`<p>${t("editor.preview.renderError")}</p>`);
      }
    });
  }, [content, t]);

  return (
    <div className="editor-preview">
      <div 
        className="preview-content markdown-view"
        dangerouslySetInnerHTML={{ __html: renderedContent }}
      />
    </div>
  );
};

export default EditorPreview;

