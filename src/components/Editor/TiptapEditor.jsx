import React, { useEffect, useState, useRef } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TextAlign } from "@tiptap/extension-text-align";
import { Color } from "@tiptap/extension-color";
import { TextStyle } from "@tiptap/extension-text-style";
import { Image } from "@tiptap/extension-image";
import { Mention } from "@tiptap/extension-mention";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import Strike from "@tiptap/extension-strike";
import Highlight from "@tiptap/extension-highlight";
import Link from "@tiptap/extension-link";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { AiOutlineHighlight } from "react-icons/ai";
import { HiMiniListBullet } from "react-icons/hi2";
import { GoListOrdered } from "react-icons/go";
import { GoTasklist } from "react-icons/go";
import {Markdown} from "@tiptap/markdown";

import EmojiPicker from "./EmojiPicker";

import {
  FaAlignCenter,
  FaAlignJustify,
  FaAlignLeft,
  FaAlignRight,
  FaBars,
  FaBold,
  FaListOl,
  FaListUl
} from "react-icons/fa";
import { PiTextItalicFill } from "react-icons/pi";
import { TbH2 } from "react-icons/tb";
import { BsEmojiSmile, BsImage, BsThreeDots } from "react-icons/bs";

import "./editor.scss";
import { uploadImageToHive } from "./uploadImageToHiv";
import { Plugin, PluginKey } from "prosemirror-state";
import { FaListCheck } from "react-icons/fa6";
import { MdFormatUnderlined, MdOutlineStrikethroughS } from "react-icons/md";

// Custom extension to hide images in editor but keep them in HTML
const ImageAsLink = Image.extend({
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('span');
      dom.textContent = node.attrs.src;
      dom.style.color = '#0066cc';
      dom.style.textDecoration = 'underline';
      dom.style.cursor = 'pointer';
      dom.className = 'image-link-display';
      return { dom };
    };
  },
});

// Markdown image paste plugin
const MarkdownImagePaste = {
  name: 'markdownImagePaste',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('markdownImagePaste'),
        props: {
          transformPastedHTML(html) {
            return html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" />');
          },
          transformPastedText(text) {
            return text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" />');
          }
        }
      })
    ];
  }
};

// Helper to parse markdown images
const parseMarkdownImages = (content) => {
  if (!content) return content;
  if (/<[^>]+>/.test(content)) return content.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" />');
  return content.split('\n').map(line => line.trim() ? line.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" />') : '').join('');
};

export default function TiptapEditor({ value, onChange }) {

  const [showEmoji, setShowEmoji] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showHeadingDropdown, setShowHeadingDropdown] = useState(false);
  const [showFormatDropdown, setShowFormatDropdown] = useState(false);

  const fileInputRef = useRef(null);
  const headingDropdownRef = useRef(null);
  const formatDropdownRef = useRef(null);
  const emojiRef = useRef(null);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Markdown,
      TextStyle,
      Color,
      ImageAsLink, // Use custom image extension
      Underline,
      Strike,
      Highlight,
      Link,
      TaskList,
      TaskItem,
      Placeholder.configure({ placeholder: "Write your content here..." }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Mention.configure({ HTMLAttributes: { class: "mention-tag" } }),
      MarkdownImagePaste,
    ],
    content: '',
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: {
      handlePaste: (view, event) => {
        const text = event.clipboardData?.getData('text/plain');
        if (text && /!\[([^\]]*)\]\(([^)]+)\)/.test(text)) {
          const html = parseMarkdownImages(text);
          editor.chain().focus().insertContent(html).run();
          return true;
        }
        return false;
      }
    }
  });

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (headingDropdownRef.current && !headingDropdownRef.current.contains(event.target)) {
        setShowHeadingDropdown(false);
      }
      if (formatDropdownRef.current && !formatDropdownRef.current.contains(event.target)) {
        setShowFormatDropdown(false);
      }
      if (emojiRef.current && !emojiRef.current.contains(event.target)) {
        setShowEmoji(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  useEffect(() => {
    if (editor && value !== undefined) {
      const parsedContent = parseMarkdownImages(value);
      if (parsedContent !== editor.getHTML()) editor.commands.setContent(parsedContent, false);
    }
  }, [value, editor]);

  const insertEmoji = (emoji) => {
    editor.chain().focus().insertContent(emoji).run();
    setShowEmoji(false);
  };

  const handleImageUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadImageToHive(file);
      editor.chain().focus().setImage({ src: url }).run();
    } catch (err) {
      console.error("Upload failed:", err);
      alert(`Upload failed: ${err.message}`);
    } finally {
      setUploading(false);
    }
  };

  // Handler to close other dropdowns when opening one
  const handleHeadingDropdownToggle = () => {
    setShowFormatDropdown(false);
    setShowEmoji(false);
    setShowHeadingDropdown(!showHeadingDropdown);
  };

  const handleFormatDropdownToggle = () => {
    setShowHeadingDropdown(false);
    setShowEmoji(false);
    setShowFormatDropdown(!showFormatDropdown);
  };

  const handleEmojiToggle = () => {
    setShowHeadingDropdown(false);
    setShowFormatDropdown(false);
    setShowEmoji(!showEmoji);
  };

  return (
    <div className="editor-wrapper">

      <div className="editor-toolbar">

        {/* Alignment */}
        <button onClick={() => editor.chain().focus().setTextAlign("left").run()}><FaBars /></button>
        <button onClick={() => editor.chain().focus().setTextAlign("center").run()}><FaAlignCenter /></button>
        <button onClick={() => editor.chain().focus().setTextAlign("right").run()}><FaAlignRight /></button>

        {/* Headings Dropdown */}
        <div className="heading-dropdown" style={{ position: "relative" }} ref={headingDropdownRef}>
          <button
            onClick={handleHeadingDropdownToggle}
            className="heading-btn"
          >
            H ▾
          </button>
          
          {showHeadingDropdown && (
            <div className="dropdown-menu" style={{
              position: "absolute",
              top: "100%",
              left: 0,
              background: "white",
              border: "1px solid #ccc",
              borderRadius: "4px",
              zIndex: 1000,
              padding: "5px 0",
              minWidth: "50px"
            }}>
              {[1, 2, 3, 4, 5, 6].map(level => (
                <button
                  key={level}
                  onClick={() => {
                    editor.chain().focus().toggleHeading({ level }).run();
                    setShowHeadingDropdown(false);
                  }}
                  className={editor?.isActive("heading", { level }) ? "active" : ""}
                  style={{
                    display: "block",
                    width: "100%",
                    padding: "5px 10px",
                    textAlign: "left",
                    background: "none",
                    border: "none",
                    cursor: "pointer"
                  }}
                >
                  H{level}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Text formatting */}
        <button onClick={() => editor.chain().focus().toggleBold().run()} className={editor?.isActive("bold") ? "active" : ""}><FaBold /></button>
        <button onClick={() => editor.chain().focus().toggleItalic().run()} className={editor?.isActive("italic") ? "active" : ""}><PiTextItalicFill size={22} /></button>

        {/* FORMAT DROPDOWN */}
        <div className="format-dropdown" style={{ position: "relative" }} ref={formatDropdownRef}>
          <button
            onClick={handleFormatDropdownToggle}
            className="format-btn"
          >
            <BsThreeDots />
          </button>

          {showFormatDropdown && (
            <div className="dropdown-menu" style={{
              position: "absolute",
              top: "100%",
              left: -50,
              background: "white",
              border: "1px solid #ccc",
              borderRadius: "4px",
              zIndex: 1000,
              padding: "5px 0",
              minWidth: "140px"
            }}>

              {/* Underline */}
              <button
                onClick={() => {
                  editor.chain().focus().toggleUnderline().run();
                  setShowFormatDropdown(false);
                }}
                className={editor?.isActive("underline") ? "active" : ""}
              >
              <span className="wrap-in-btn"><MdFormatUnderlined />  <span>Underline</span></span>
              </button>

              {/* Strike */}
              <button
                onClick={() => {
                  editor.chain().focus().toggleStrike().run();
                  setShowFormatDropdown(false);
                }}
                className={editor?.isActive("strike") ? "active" : ""}
              >
                <span className="wrap-in-btn"><MdOutlineStrikethroughS />  <span>Strike</span></span>
              </button>

              {/* Highlight */}
              <button
                onClick={() => {
                  editor.chain().focus().toggleHighlight({ color: "#FFFF00" }).run();
                  setShowFormatDropdown(false);
                }}
                className={editor?.isActive("highlight") ? "active" : ""}
              >
                <span className="wrap-in-btn"><AiOutlineHighlight />  <span>Highlight</span></span>
              </button>

              {/* Bullet List */}
              <button
                onClick={() => {
                  editor.chain().focus().toggleBulletList().run();
                  setShowFormatDropdown(false);
                }}
                className={editor?.isActive("bulletList") ? "active" : ""}
              >
                <span className="wrap-in-btn"><HiMiniListBullet />  <span>Bullet List</span></span>
              </button>

              {/* Ordered List */}
              <button
                onClick={() => {
                  editor.chain().focus().toggleOrderedList().run();
                  setShowFormatDropdown(false);
                }}
                className={editor?.isActive("orderedList") ? "active" : ""}
              >
                <span className="wrap-in-btn"><GoListOrdered />  <span>Ordered List</span></span>
              </button>

              {/* Task List */}
              <button
                onClick={() => {
                  editor.chain().focus().toggleTaskList().run();
                  setShowFormatDropdown(false);
                }}
                className={editor?.isActive("taskList") ? "active" : ""}
              >
                <span className="wrap-in-btn"><GoTasklist />  <span>Task List</span></span>
              </button>

            </div>
          )}
        </div>

        {/* Image & Emoji */}
        <button onClick={() => fileInputRef.current.click()}><BsImage /></button>
        <div ref={emojiRef} style={{ position: "relative" }}>
          <button onClick={handleEmojiToggle}><BsEmojiSmile /></button>
          {showEmoji && <EmojiPicker onSelect={insertEmoji} />}
        </div>

      </div>

      {uploading && <div className="uploading">Uploading image...</div>}

    
        <EditorContent editor={editor} className="editor-content" />
    
    
    
      <input
        type="file"
        accept="image/*"
        ref={fileInputRef}
        style={{ display: "none" }}
        onChange={handleImageUpload}
      />
    </div>
  );
}