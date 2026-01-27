import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Edit, Save } from 'lucide-react';
import "./EditVideo.scss";
import {  toast } from 'sonner'
import { convert } from 'html-to-text';
import axios from 'axios';
import { API_URL_FROM_WEST } from '../utils/config';
import TextEditor from '../components/studio/TextEditor';
import { useAppStore } from '../lib/store';
import * as dhive from '@hiveio/dhive';
import MarkdownComposer from '../components/studio/MarkdownComposer';
import { broadcastWithAioha, isLoggedIn, KeyTypes } from '../hive-api/aioha';
const client = new dhive.Client(['https://api.hive.blog']);

// Lazy-loaded renderer to avoid Node.js polyfill issues at bundle time
let rendererPromise = null;
const getRenderer = async () => {
  if (!rendererPromise) {
    rendererPromise = import('@snapie/renderer').then(({ createHiveRenderer }) => {
      return createHiveRenderer({
        ipfsGateway: 'https://ipfs-3speak.b-cdn.net',
        convertHiveUrls: true,
        usertagUrlFn: (account) => `/p/${account}`,
        hashtagUrlFn: (tag) => `/t/${tag}`,
      });
    });
  }
  return rendererPromise;
};

const EditVideo = () => {
  const location = useLocation();
  const {user} = useAppStore()
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [thumbnailUrl, setThumbnailUrl] = useState('');
  const [date, setDate] = useState('');
  const [permlink, setPermlink] = useState("")
  const [ id, setId ] = useState("");
  const [renderedHTML, setRenderedHTML] = useState('');
  const accessToken = localStorage.getItem("access_token");

  const video = location.state?.video;
  console.log(id)
  console.log(video)

  useEffect(() => {
    if (video) {
      setTitle(video.title);

      const plainText = convert(video.description, {
        wordwrap: false,
        selectors: [
          { selector: 'br', format: 'block' },
          { selector: 'p', format: 'block' },
          { selector: 'sub', format: 'inline' }
        ]
      });

      setDescription(plainText.trim());
      setTags(video.tags);
      setThumbnailUrl(video.thumbUrl);
      setDate(video.created);
      setPermlink(video.permlink)
      setId(video._id)
    } else {
      toast.error('Video not found');
    }
  }, [id, navigate, video]);

  // Render description with the async renderer
  useEffect(() => {
    if (description) {
      getRenderer().then(render => {
        setRenderedHTML(render(description));
      }).catch(err => {
        console.error('Error rendering description:', err);
        setRenderedHTML(description);
      });
    }
  }, [description]);

  console.log(permlink)
  console.log(id)



const handleSubmit = async (e) => {
  e.preventDefault();

  if (!isLoggedIn()) {
    toast.error("Please login to update the video");
    return;
  }

  const tagsArray = tags.split(',').map(tag => tag.trim()).filter(Boolean);

  // Convert description to HTML paragraphs
  const htmlDescription = description
    .split('\n\n')
    .map(paragraph => `<p>${paragraph.replace(/\n/g, ' ')}</p>`)
    .join('');

  const metadata = {
    tags: tagsArray,
    app: '3speak/new-version',
    format: 'html',
  };

  const jsonMetadata = JSON.stringify(metadata);

  const commentOp = [
    'comment',
    {
      parent_author: '',
      parent_permlink: tagsArray[0] || 'video',
      author: user,
      permlink: permlink,
      title: title,
      body: htmlDescription,
      json_metadata: jsonMetadata,
    },
  ];

  try {
    await broadcastWithAioha([commentOp], KeyTypes.Posting);
    toast.success("Post successfully updated on Hive!");
    navigate("/draft");
  } catch (error) {
    toast.error(`Failed to update post: ${error.message}`);
    console.error("Update error:", error);
  }
};


  // renderedHTML is now handled via useEffect above

  if (loading) {
    return (
      <div className="page-loading">
        <div className="spinner"></div>
        <p>Loading video details...</p>
      </div>
    );
  }

  return (
    <div className="edit-page">
      <div className="header">
        <h1>
          <Edit className="edit-icon" />
          Edit Video
        </h1>
      </div>

      <div className="content">
        <div className="form-container">
          <form className="edit-form" onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="title">Title</label>
              <input 
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Video title"
                className="form-input"
                required
              />
            </div>
            
            <div className="form-group">
              <label htmlFor="description">Description</label>
              {/* <textarea 
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Video description"
                className="form-textarea"
                rows={8}
              /> */}
              {/* <TextEditor description={description} setDescription={setDescription} style={{ height: "100%", }} /> */}
              <MarkdownComposer value={description} onChange={setDescription} placeholder="Write your video description here... Supports markdown formatting!" show={true} />
            </div>
            
            <div className="form-group tap-sp">
              <label htmlFor="tags">Tags (comma separated)</label>
              <input
                id="tags"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="tag1,tag2,tag3"
                className="form-input"
              />
            </div>
            
            <div className="form-group form-actions">
              <button 
                type="submit" 
                className="btn btn--primary"
              >
                <Save />
                Update Video
              </button>
            </div>
          </form>
        </div>

        <div className="preview">
          <h2>Preview</h2>
          <div className="video-preview">
            <div className="thumbnail">
              <img src={thumbnailUrl} alt="thumbnail" />
            </div>
            <div className="content-pre">
              <h3 className="title">{title}</h3>
              <div
                className="markdown-view"
                dangerouslySetInnerHTML={{ __html: renderedHTML }}
              />
              {tags && (
                <div className="tags">
                  {tags.split(',').map((tag, index) => (
                    <span key={index} className="tag">
                      {tag.trim()}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EditVideo;
