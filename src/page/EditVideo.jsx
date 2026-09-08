import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Edit, Save } from 'lucide-react';
import "./EditVideo.scss";
import { toastIn } from '../utils/toast';
import { convert } from 'html-to-text';
import axios from 'axios';
import { API_URL_FROM_WEST, CHECKER_URL, CHECKER_API_KEY } from '../utils/config';
import { getHiveClient } from '../utils/hiveNode';
import { useAppStore } from '../lib/store';
import * as dhive from '@hiveio/dhive';
import MarkdownComposer from '../components/studio/MarkdownComposer';
import { broadcastWithAioha, isLoggedIn, KeyTypes } from '../hive-api/aioha';
import PromoteModal from '../components/Promote/PromoteModal';
import { Rocket } from 'lucide-react';
import { getPostBodyRenderer } from '../lib/hiveRenderer';
import { setChannelTrailer, fetchChannelTrailer, trailerMatches } from '../utils/channelTrailer';

// Every toast from this module is headed "Video"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Video');

const client = getHiveClient();

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
  const [listed, setListed] = useState(true);
  const initialListedRef = React.useRef(true);
  const [isNsfw, setIsNsfw] = useState(false);
  const initialNsfwRef = React.useRef(false);
  const [reusable, setReusable] = useState(true);
  const initialReusableRef = React.useRef(true);
  // Channel trailer. Landscape only (the Overview trailer frame is 16:9, the same
  // reason the uploader hides the option for shorts), and shown only once the
  // current value has actually been read — defaulting the switch to off after a
  // failed read would offer to "set" a trailer this video already is.
  const [isTrailer, setIsTrailer] = useState(false);
  const [trailerKnown, setTrailerKnown] = useState(false);
  const [isShort, setIsShort] = useState(false);
  const initialTrailerRef = React.useRef(false);
  const originalMetaRef = React.useRef(null);
  const [promoteOpen, setPromoteOpen] = useState(false);
  const [promotedUntil, setPromotedUntil] = useState(null);
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
      const isListed = video.listed_on_3speak !== false && video.unlisted !== true;
      setListed(isListed);
      initialListedRef.current = isListed;
      const tagList = Array.isArray(video.tags)
        ? video.tags
        : (typeof video.tags === 'string' ? video.tags.split(',').map(t => t.trim()) : []);
      const nsfw = video.isNsfwContent === true || tagList.some(t => String(t).toLowerCase() === 'nsfw');
      setIsNsfw(nsfw);
      initialNsfwRef.current = nsfw;
      setPromotedUntil(video.promotedUntil || null);
    } else {
      toast.error('Video not found');
    }
  }, [id, navigate, video]);

  // Render description with the async renderer
  useEffect(() => {
    if (description) {
      getPostBodyRenderer().then(render => {
        setRenderedHTML(render(description));
      }).catch(err => {
        console.error('Error rendering description:', err);
        setRenderedHTML(description);
      });
    }
  }, [description]);

  // Load the original on-chain json_metadata so we can PRESERVE it on save
  // (the old code rebuilt metadata from scratch, dropping `video`) and read the
  // current "Allow Remix/Clip" (json_metadata.video.reusable) flag.
  useEffect(() => {
    if (!user || !permlink) return;
    let cancelled = false;
    (async () => {
      try {
        const post = await client.call('condenser_api', 'get_content', [user, permlink]);
        if (cancelled || !post) return;
        let meta = {};
        try { meta = JSON.parse(post.json_metadata || '{}'); } catch (_) {}
        originalMetaRef.current = meta;
        const r = meta.video?.reusable !== false;
        setReusable(r);
        initialReusableRef.current = r;

        // Shorts are Hive comments carrying `video.short`; long-form posts are
        // top-level. Either marker is enough to keep the trailer row off them.
        const metaTags = Array.isArray(meta.tags) ? meta.tags.map((t) => String(t).toLowerCase()) : [];
        const short = !!post.parent_author
          || String(meta.video?.short) === 'true'
          || metaTags.includes('short');
        setIsShort(short);
        if (short) return;

        // What this creator has pinned right now, so the switch reflects reality
        // and can also UNPIN this video.
        try {
          const trailer = await fetchChannelTrailer(user);
          if (cancelled) return;
          const on = trailerMatches(trailer, user, permlink);
          setIsTrailer(on);
          initialTrailerRef.current = on;
          setTrailerKnown(true);
        } catch { /* couldn't read it — leave the row out entirely */ }
      } catch (_) { /* best-effort */ }
    })();
    return () => { cancelled = true; };
  }, [user, permlink]);

const handleSubmit = async (e) => {
  e.preventDefault();

  if (!isLoggedIn()) {
    toast.error("Please login to update the video");
    return;
  }

  const baseTags = tags.split(',').map(tag => tag.trim()).filter(Boolean)
    .filter(t => t.toLowerCase() !== 'nsfw');
  // Append/strip the canonical Hive `nsfw` tag based on the toggle.
  const tagsArray = isNsfw ? [...baseTags, 'nsfw'] : baseTags;

  // Convert description to HTML paragraphs
  const htmlDescription = description
    .split('\n\n')
    .map(paragraph => `<p>${paragraph.replace(/\n/g, ' ')}</p>`)
    .join('');

  // Preserve the original json_metadata (video info, etc.) and only update the
  // bits we control here: tags + the remix/clip flag.
  const origMeta = originalMetaRef.current || {};
  const metadata = {
    ...origMeta,
    tags: tagsArray,
    app: origMeta.app || '3speak/new-version',
    format: 'html',
    video: { ...(origMeta.video || { platform: '3speak' }), reusable },
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

    // Push the new thumbnail straight to the checker's MongoDB (Pancreas
    // API) so it reflects immediately instead of waiting for the
    // Hive→Mongo sync. Best-effort: a failure here doesn't fail the edit
    // (the sync reconciles it eventually). Skipped if no API key set.
    if (thumbnailUrl && CHECKER_API_KEY) {
      try {
        await axios.put(
          `${CHECKER_URL}/video/thumbnail`,
          { owner: user, permlink, thumbnail: thumbnailUrl },
          { headers: { Authorization: `Bearer ${CHECKER_API_KEY}` } },
        );
      } catch (thumbErr) {
        console.warn('Thumbnail Mongo update failed (will reconcile on sync):', thumbErr?.message);
        toast.info('Thumbnail saved on Hive — it may take a moment to refresh.');
      }
    }

    // NSFW — the `nsfw` Hive tag above is canonical; also set the checker's
    // isNsfwContent flag for immediate effect (before the Hive→Mongo sync).
    if (isNsfw !== initialNsfwRef.current && CHECKER_API_KEY) {
      try {
        await axios.put(
          `${CHECKER_URL}/video/nsfw`,
          { owner: user, permlink, nsfw: isNsfw },
          { headers: { Authorization: `Bearer ${CHECKER_API_KEY}` } },
        );
        initialNsfwRef.current = isNsfw;
      } catch (nsfwErr) {
        console.warn('NSFW flag update failed (will reconcile from the nsfw tag on sync):', nsfwErr?.message);
      }
    }

    // Listing (unlist / re-list) — only call the checker when it actually changed.
    if (listed !== initialListedRef.current && CHECKER_API_KEY) {
      try {
        await axios.put(
          `${CHECKER_URL}/video/listing`,
          { owner: user, permlink, listed },
          { headers: { Authorization: `Bearer ${CHECKER_API_KEY}` } },
        );
        initialListedRef.current = listed;
        toast.success(listed ? 'Video re-listed — it will show in feeds again.' : 'Video unlisted — hidden from feeds & search.');
      } catch (listErr) {
        console.warn('Listing update failed:', listErr?.message);
        toast.error('Could not update the listing — please try again.');
      }
    }

    // Channel trailer (pin / unpin on your own profile). Last, and best-effort:
    // it broadcasts an account_update2 of its own to mirror the choice on chain,
    // and a refused signature there must not read as the edit having failed.
    if (isTrailer !== initialTrailerRef.current) {
      try {
        await setChannelTrailer(user, isTrailer ? permlink : null, { author: user });
        initialTrailerRef.current = isTrailer;
        toast.success(isTrailer
          ? 'Set as your channel trailer.'
          : 'Removed as your channel trailer.');
      } catch (trailerErr) {
        console.warn('Channel trailer update failed:', trailerErr?.message);
        toast.error('Could not update your channel trailer.');
      }
    }

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
            
            <div className="form-group listing-toggle">
              <button
                type="button"
                role="switch"
                aria-checked={listed}
                className={`listing-switch${listed ? ' is-on' : ''}`}
                onClick={() => setListed(l => !l)}
              >
                <span className="listing-switch__track"><span className="listing-switch__thumb" /></span>
                <span className="listing-switch__label">
                  <strong>{listed ? 'Listed' : 'Unlisted'}</strong>
                  <small>
                    {listed
                      ? 'Shown in feeds, search and on your profile.'
                      : 'Hidden from feeds & search — still plays by direct link and stays on your profile (badged).'}
                  </small>
                </span>
              </button>
            </div>

            <div className="form-group listing-toggle">
              <button
                type="button"
                role="switch"
                aria-checked={reusable}
                className={`listing-switch${reusable ? ' is-on' : ''}`}
                onClick={() => setReusable(v => !v)}
              >
                <span className="listing-switch__track"><span className="listing-switch__thumb" /></span>
                <span className="listing-switch__label">
                  <strong>Allow Remix/Clip</strong>
                  <small>
                    {reusable
                      ? 'Others can create remixes/clips from this video; you are credited as original author.'
                      : 'Others cannot remix or clip this video.'}
                  </small>
                </span>
              </button>
            </div>

            <div className="form-group listing-toggle">
              <button
                type="button"
                role="switch"
                aria-checked={isNsfw}
                className={`listing-switch listing-switch--danger${isNsfw ? ' is-on' : ''}`}
                onClick={() => setIsNsfw(v => !v)}
              >
                <span className="listing-switch__track"><span className="listing-switch__thumb" /></span>
                <span className="listing-switch__label">
                  <strong>{isNsfw ? 'Adult / NSFW' : 'Not adult'}</strong>
                  <small>
                    {isNsfw
                      ? 'Marked adult — hidden from feeds & search unless the viewer enabled NSFW, and tagged nsfw on Hive.'
                      : 'Normal content, shown to everyone.'}
                  </small>
                </span>
              </button>
            </div>

            {/* Landscape only: the trailer frame on Overview is 16:9. */}
            {!isShort && trailerKnown && (
              <div className="form-group listing-toggle">
                <button
                  type="button"
                  role="switch"
                  aria-checked={isTrailer}
                  className={`listing-switch${isTrailer ? ' is-on' : ''}`}
                  onClick={() => setIsTrailer(v => !v)}
                >
                  <span className="listing-switch__track"><span className="listing-switch__thumb" /></span>
                  <span className="listing-switch__label">
                    <strong>Channel trailer</strong>
                    <small>
                      {isTrailer
                        ? 'Autoplays at the top of your profile\u2019s Overview tab, replacing any trailer you set before.'
                        : 'Make this the video that autoplays at the top of your profile\u2019s Overview tab.'}
                    </small>
                  </span>
                </button>
              </div>
            )}

            <div className="form-group form-actions">
              <button
                type="submit"
                className="btn btn--primary"
              >
                <Save />
                Update Video
              </button>
              <button
                type="button"
                className="btn btn--promote"
                onClick={() => setPromoteOpen(true)}
              >
                <Rocket size={18} />
                {promotedUntil && new Date(promotedUntil).getTime() > Date.now() ? 'Promoted' : 'Promote'}
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

      <PromoteModal
        open={promoteOpen}
        onClose={() => setPromoteOpen(false)}
        author={user}
        permlink={permlink}
        promotedUntil={promotedUntil}
        onPromoted={(until) => setPromotedUntil(until)}
      />
    </div>
  );
};

export default EditVideo;
