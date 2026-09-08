import { useState, useEffect, useMemo, useRef } from 'react';
import { getHiveClient } from '../../utils/hiveNode';
import { createPortal } from 'react-dom';
import { IoClose } from 'react-icons/io5';
import { MdImage, MdUpload } from 'react-icons/md';
import { toastIn } from '../../utils/toast';
import axios from 'axios';
import { Client } from '@hiveio/dhive';
import { HIVE_API_NODES, CHECKER_URL, CHECKER_API_KEY } from '../../utils/config';
import { commentWithAioha } from '../../hive-api/aioha';
import { uploadThumbnail } from '../../utils/uploadThumbnail';
import { uploadVideoAsset, probeVideoDuration, registerMediaReplacement, fetchReplaceTarget } from '../../utils/uploadVideoAsset';
import { setChannelTrailer, fetchChannelTrailer, trailerMatches } from '../../utils/channelTrailer';
import { useAppStore } from '../../lib/store';
import PromoteModal from '../Promote/PromoteModal';
import { Rocket } from 'lucide-react';
import './EditVideoModal.scss';

// Every toast from this module is headed "Video"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Video');

const hiveClient = getHiveClient();

const TITLE_MIN = 5;
const TITLE_MAX = 250;
const MAX_TAGS = 10;

/**
 * Split a 3Speak post body into three parts:
 *   header  — thumbnail image link + "▶️ Watch on 3Speak" + separator
 *   middle  — the user's actual description (what we let them edit)
 *   footer  — trailing separator + "▶️ [3Speak]" link
 *
 * If the body doesn't match the expected shape, we treat the whole thing as
 * editable middle with empty header/footer — editing then preserves everything.
 */
function splitPostBody(body) {
  if (typeof body !== 'string' || !body) {
    return { header: '', middle: '', footer: '' };
  }

  const src = body.replace(/\r\n/g, '\n');

  // Header pattern:
  //   [![](thumbUrl)](watchUrl)\n\n
  //   ▶️ [Watch on 3Speak](watchUrl)\n\n
  //   ---\n
  // We match leniently: any whitespace between the three pieces, "▶️" optional
  // variants, optional surrounding whitespace.
  const headerRe = new RegExp(
    '^\\s*' +
    // thumbnail image link: [![alt](thumb)](watch)
    '(?:\\[\\s*!\\[[^\\]]*\\]\\([^)]*\\)\\s*\\]\\([^)]*\\)\\s*\\n+)?' +
    // "Watch on 3Speak" line
    '(?:(?:▶️|â–¶ï¸|▶)?\\s*\\[\\s*Watch on 3Speak\\s*\\]\\([^)]*\\)\\s*\\n+)?' +
    // horizontal rule
    '(?:-{3,}\\s*\\n+)?',
    ''
  );

  // Footer pattern (at end of body):
  //   \n---\n\n▶️ [3Speak](watchUrl)\n
  const footerRe = new RegExp(
    '(?:\\n+-{3,}\\s*)?' +
    '\\n+(?:▶️|â–¶ï¸|▶)?\\s*\\[\\s*3Speak\\s*\\]\\([^)]*\\)\\s*$',
    ''
  );

  const headerMatch = src.match(headerRe);
  const header = headerMatch ? headerMatch[0] : '';
  const afterHeader = src.slice(header.length);

  const footerMatch = afterHeader.match(footerRe);
  const footer = footerMatch ? footerMatch[0] : '';
  const middle = footerMatch
    ? afterHeader.slice(0, afterHeader.length - footer.length)
    : afterHeader;

  // If neither header nor footer matched, expose the full body so the author
  // doesn't lose anything on save.
  if (!header && !footer) {
    return { header: '', middle: src, footer: '' };
  }

  return { header, middle: middle.trim(), footer };
}

function recombinePostBody(header, middle, footer) {
  const parts = [];
  if (header) parts.push(header.replace(/\s+$/, ''));
  parts.push((middle ?? '').trim());
  if (footer) parts.push(footer.replace(/^\s+/, ''));
  return parts.filter(Boolean).join('\n\n') + '\n';
}

/**
 * Modal for editing a video post on Hive.
 * Broadcasts a `comment` operation with the same author/permlink to replace
 * on-chain title, body and json_metadata. Video file itself is never touched.
 *
 * @param {boolean} isOpen
 * @param {() => void} onClose
 * @param {string} author          - video author (must equal logged-in user)
 * @param {string} permlink
 * @param {(changes: { title, body, tags, thumbnail }) => void} onSaved
 */
export default function EditVideoModal({ isOpen, onClose, author, permlink, onSaved, isShort = false }) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(null);

  // Original on-chain post — source of truth for round-trip fidelity.
  const [original, setOriginal] = useState(null);

  // Editable fields
  const [title, setTitle] = useState('');
  const [body, setBody] = useState(''); // middle section only — what the user edits
  const [bodyHeader, setBodyHeader] = useState(''); // 3Speak thumb+link header, rewrite thumb on save
  const [bodyFooter, setBodyFooter] = useState(''); // trailing 3Speak link
  const [tagsInput, setTagsInput] = useState('');
  // Auto-added taxonomy tags (3speak, the community/category, short) kept aside
  // so the editable tag count matches the uploader (which validates only the
  // user's own tags). Re-prepended on save.
  const [systemTags, setSystemTags] = useState([]);
  const [thumbnailUrl, setThumbnailUrl] = useState('');
  const [thumbUploading, setThumbUploading] = useState(false);
  // Replacing the video FILE. The post keeps its permlink, payout, votes and
  // comments; only the embed asset it points at changes. A replacement is always
  // a NEW asset (the embed service has no in-place swap, and minting a fresh one
  // means existing embeds of the old file elsewhere keep working).
  const [newVideoFile, setNewVideoFile] = useState(null);
  const [videoUploadPct, setVideoUploadPct] = useState(0);
  const [videoUploading, setVideoUploading] = useState(false);
  const [newAsset, setNewAsset] = useState(null); // { embedUrl, owner, permlink }
  const [newDuration, setNewDuration] = useState(0);
  // Which embed host the pool picked for this upload — shown while it runs, so a
  // misbehaving upload can be traced to an endpoint without opening devtools.
  const [uploadHost, setUploadHost] = useState('');
  const videoUploadRef = useRef(null);
  const thumbInputRef = useRef(null);

  // Listing / NSFW / promotion (checker-backed, same as the full Edit page)
  const [listed, setListed] = useState(true);
  const [isNsfw, setIsNsfw] = useState(false);
  const [reusable, setReusable] = useState(true);
  const [promotedUntil, setPromotedUntil] = useState(null);
  const [promoteOpen, setPromoteOpen] = useState(false);
  const initialListedRef = useRef(true);
  const initialNsfwRef = useRef(false);
  const initialReusableRef = useRef(true);
  const initialThumbRef = useRef(''); // loaded thumbnail baseline (for dirty check)

  // Channel trailer. Offered only for landscape videos — the Overview trailer
  // frame is 16:9, the same reason the uploader hides it for shorts — and only to
  // the creator themself, since it pins the video to THEIR profile.
  // `trailerKnown` gates the row on having actually read the current value: a
  // toggle that defaulted to off after a failed read would offer to "set" a
  // trailer that is already this video, or hide that another one is pinned.
  const loggedInUser = useAppStore((st) => st.user);
  const isOwner = !!loggedInUser
    && String(loggedInUser).toLowerCase() === String(author || '').toLowerCase();
  const [isTrailer, setIsTrailer] = useState(false);
  const [trailerKnown, setTrailerKnown] = useState(false);
  const initialTrailerRef = useRef(false);

  // Fetch original post when modal opens
  useEffect(() => {
    if (!isOpen || !author || !permlink) return;

    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    (async () => {
      try {
        const post = await hiveClient.call('condenser_api', 'get_content', [author, permlink]);
        if (cancelled) return;
        if (!post || !post.author) {
          setLoadError('Could not find this post on Hive.');
          setLoading(false);
          return;
        }

        let meta = {};
        try { meta = JSON.parse(post.json_metadata || '{}'); } catch (_) {}

        // Extract current thumbnail
        let currentThumb = '';
        const sourceMap = meta.video?.info?.sourceMap;
        if (Array.isArray(sourceMap)) {
          const thumbEntry = sourceMap.find((s) => s.type === 'thumbnail');
          if (thumbEntry?.url) currentThumb = thumbEntry.url;
        }
        if (!currentThumb && Array.isArray(meta.image) && meta.image[0]) {
          currentThumb = meta.image[0];
        }

        // Tags: prefer json_metadata.tags (that's what publishers use),
        // fall back to post.category + json_metadata.tags merge minus duplicates
        const metaTags = Array.isArray(meta.tags) ? meta.tags : [];

        const { header, middle, footer } = splitPostBody(post.body || '');

        setOriginal({ post, meta });
        setTitle(post.title || '');
        setBody(middle);
        setBodyHeader(header);
        setBodyFooter(footer);
        const tagNsfw = metaTags.some((t) => String(t).toLowerCase() === 'nsfw');
        // Separate the auto-added taxonomy (3speak, community/category, short)
        // and the nsfw flag from the user's own tags, so the count/limit here
        // matches the uploader (which validates only the user tags and prepends
        // the taxonomy). The taxonomy is preserved and re-added on save.
        const category = String(post.category || '').toLowerCase();
        const isSystemTag = (t) => {
          const lc = String(t).toLowerCase();
          return lc === '3speak' || lc === 'short' || lc === 'nsfw' || lc === category;
        };
        setSystemTags(metaTags.filter((t) => isSystemTag(t) && String(t).toLowerCase() !== 'nsfw'));
        setTagsInput(metaTags.filter((t) => !isSystemTag(t)).join(' '));
        setThumbnailUrl(currentThumb);
        initialThumbRef.current = currentThumb;
        const metaReusable = meta.video?.reusable !== false;
        setReusable(metaReusable);
        initialReusableRef.current = metaReusable;
        setLoading(false);

        // Pull checker-backed state (listing, NSFW flag, promotion) from the doc.
        try {
          const { data: doc } = await axios.get(`${CHECKER_URL}/videodetails/${author}/${permlink}`);
          if (!cancelled && doc) {
            const isListed = doc.listed_on_3speak !== false;
            const nsfw = doc.isNsfwContent === true || tagNsfw
              || (Array.isArray(doc.hive_tags) && doc.hive_tags.some((t) => String(t).toLowerCase() === 'nsfw'));
            setListed(isListed);
            setIsNsfw(nsfw);
            setPromotedUntil(doc.promotedUntil || null);
            initialListedRef.current = isListed;
            initialNsfwRef.current = nsfw;
            // Shorts store their thumbnail on the checker (not the video
            // sourceMap), so use it as the current thumbnail when none was found
            // in the post metadata.
            if (isShort && doc.thumbnail_url) {
              setThumbnailUrl((prev) => prev || doc.thumbnail_url);
              if (!initialThumbRef.current) initialThumbRef.current = doc.thumbnail_url;
            }
          } else if (!cancelled) {
            setIsNsfw(tagNsfw);
            initialNsfwRef.current = tagNsfw;
          }
        } catch (_) {
          if (!cancelled) { setIsNsfw(tagNsfw); initialNsfwRef.current = tagNsfw; }
        }

        // What is pinned as this creator's trailer right now, so the toggle
        // reflects reality and can also UNPIN this video.
        if (!isShort && isOwner) {
          try {
            const trailer = await fetchChannelTrailer(author);
            if (!cancelled) {
              const on = trailerMatches(trailer, author, permlink);
              setIsTrailer(on);
              initialTrailerRef.current = on;
              setTrailerKnown(true);
            }
          } catch { /* couldn't read it — leave the row out entirely */ }
        }
      } catch (err) {
        if (cancelled) return;
        console.error('Failed to load post for edit:', err);
        setLoadError('Failed to load post from Hive. Please try again.');
        setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [isOpen, author, permlink]);

  // Reset local state when the modal closes
  useEffect(() => {
    if (isOpen) return;
    setOriginal(null);
    setTitle('');
    setBody('');
    setBodyHeader('');
    setBodyFooter('');
    setTagsInput('');
    setSystemTags([]);
    setThumbnailUrl('');
    initialThumbRef.current = '';
    setLoadError(null);
    setSaving(false);
    setListed(true);
    setIsNsfw(false);
    setReusable(true);
    setPromotedUntil(null);
    setPromoteOpen(false);
    setIsTrailer(false);
    setTrailerKnown(false);
    initialListedRef.current = true;
    initialNsfwRef.current = false;
    initialReusableRef.current = true;
    initialTrailerRef.current = false;
  }, [isOpen]);

  // Parse tags input (space/comma separated, lowercased, deduplicated)
  const parsedTags = useMemo(() => {
    if (!tagsInput) return [];
    const raw = tagsInput
      .toLowerCase()
      .split(/[\s,]+/)
      .map((t) => t.trim())
      .filter(Boolean);
    return [...new Set(raw)];
  }, [tagsInput]);

  // Validation
  const titleLen = title.trim().length;
  // Shorts don't require a long title or any user tags (they carry a caption and
  // the fixed shorts taxonomy) — relax those minimums for shorts.
  const titleValid = titleLen <= TITLE_MAX && (isShort || titleLen >= TITLE_MIN);
  // The preserved taxonomy (community, short, …) counts toward the 10-tag limit,
  // so the user can add up to (10 − taxonomy) of their own — matching the uploader.
  const userTagLimit = Math.max(1, MAX_TAGS - systemTags.length);
  const tagsValid = parsedTags.length <= userTagLimit && (isShort || parsedTags.length > 0);
  const bodyValid = body.trim().length > 0;
  // Block Save while a replacement is still uploading — saving then would
  // broadcast the post still pointing at the OLD asset and silently discard the
  // upload in progress.
  const canSave = titleValid && tagsValid && bodyValid && !!original && !saving && !videoUploading;

  // Final on-chain tags = preserved taxonomy + the user's tags + the canonical
  // `nsfw` tag when marked adult (deduped, taxonomy first — same shape the
  // uploader produces).
  const finalTags = useMemo(() => {
    const sys = systemTags.filter((t) => String(t).toLowerCase() !== 'nsfw');
    const user = parsedTags.filter((t) => t !== 'nsfw');
    const combined = [...new Set([...sys, ...user])];
    return isNsfw ? [...combined, 'nsfw'] : combined;
  }, [systemTags, parsedTags, isNsfw]);

  // On-chain content change (needs a Hive broadcast). Includes the nsfw tag.
  const contentDirty = useMemo(() => {
    if (!original) return false;
    const origTags = Array.isArray(original.meta.tags) ? original.meta.tags : [];
    const origThumb = (() => {
      const sm = original.meta.video?.info?.sourceMap;
      if (Array.isArray(sm)) {
        const t = sm.find((s) => s.type === 'thumbnail');
        if (t?.url) return t.url;
      }
      return Array.isArray(original.meta.image) ? (original.meta.image[0] || '') : '';
    })();
    const { middle: origMiddle } = splitPostBody(original.post.body || '');
    const origReusable = original.meta.video?.reusable !== false;
    return (
      title.trim() !== (original.post.title || '').trim() ||
      body !== origMiddle ||
      finalTags.join(' ') !== origTags.join(' ') ||
      thumbnailUrl.trim() !== (origThumb || initialThumbRef.current || '').trim() ||
      reusable !== origReusable
    );
  }, [original, title, body, finalTags, thumbnailUrl, reusable]);

  const listingChanged = listed !== initialListedRef.current;
  const nsfwChanged = isNsfw !== initialNsfwRef.current;
  const trailerChanged = isTrailer !== initialTrailerRef.current;
  // A replaced video file is deliberately NOT part of contentDirty: the media is
  // swapped on the existing embed entry, so the post's json_metadata and body
  // keep pointing at the same URL and no Hive broadcast is needed for it.
  const videoDirty = !!newAsset;
  // Checker-only changes (listing) don't need a broadcast but should enable Save.
  const isDirty = contentDirty || listingChanged || videoDirty || trailerChanged;

  const handleThumbFilePick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file.');
      return;
    }
    // 10 MB cap — same ballpark as the uploader
    if (file.size > 10 * 1024 * 1024) {
      toast.error('Image too large (max 10 MB).');
      return;
    }
    setThumbUploading(true);
    try {
      const url = await uploadThumbnail(file);
      setThumbnailUrl(url);
      toast.success('Thumbnail uploaded.');
    } catch (err) {
      console.error('Thumbnail upload failed:', err);
      toast.error(err?.message || 'Thumbnail upload failed.');
    } finally {
      setThumbUploading(false);
    }
  };

  const handleVideoFilePick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (!file) return;
    if (!file.type.startsWith('video/')) {
      toast.error('Please select a video file.');
      return;
    }
    // Same 5GB ceiling the embed studio enforces (and the server enforces too).
    if (file.size > 5 * 1024 * 1024 * 1024) {
      toast.error('Video too large (max 5 GB).');
      return;
    }

    // Check the ORIGINAL is replaceable before uploading anything.
    //
    // Registration happens on save, long after the file has been uploaded and
    // encoded — so a post the service will refuse used to cost the creator a
    // full upload and leave behind an orphan asset (registration is also what
    // delists the carrier, so a refusal leaves it listed in their profile with
    // no Hive post). One request up front turns all of that into a sentence.
    const originalAssetPermlink = original?.meta?.video?.info?.permlink;
    if (!originalAssetPermlink) {
      toast.error("This post has no video entry to replace — its metadata doesn't reference one.");
      return;
    }
    const target = await fetchReplaceTarget(originalAssetPermlink);
    // `null` means no host could answer. That's a health problem, not a verdict
    // on this video, so don't block the upload on it.
    if (target?.found === false) {
      toast.error("This post's video is no longer in the library, so its file can't be replaced.");
      return;
    }
    if (target?.owner && target.owner !== author) {
      toast.error('You can only replace the file on your own video.');
      return;
    }

    setNewVideoFile(file);
    setNewAsset(null);
    setVideoUploadPct(0);
    setUploadHost('');
    setVideoUploading(true);
    try {
      const duration = await probeVideoDuration(file);
      setNewDuration(duration);
      const asset = await uploadVideoAsset(file, {
        owner: author,
        duration,
        onProgress: setVideoUploadPct,
        onStart: (u) => { videoUploadRef.current = u; },
        onEndpoint: setUploadHost,
      });
      setNewAsset(asset);
      toast.success('New video uploaded. Save to apply it to this post.');
    } catch (err) {
      console.error('Video replacement upload failed:', err);
      toast.error(err?.message || 'Video upload failed.');
      setNewVideoFile(null);
      setNewDuration(0);
    } finally {
      setVideoUploading(false);
      videoUploadRef.current = null;
    }
  };

  const cancelVideoReplacement = () => {
    try { videoUploadRef.current?.abort?.(); } catch { /* already finished */ }
    videoUploadRef.current = null;
    setNewVideoFile(null);
    setNewAsset(null);
    setNewDuration(0);
    setVideoUploadPct(0);
    setUploadHost('');
    setVideoUploading(false);
  };

  const handleSave = async (e) => {
    e?.preventDefault?.();
    if (!canSave) return;
    if (!isDirty) {
      toast.info('No changes to save.');
      return;
    }

    setSaving(true);
    try {
      const { post, meta } = original;

      // --- Video file replacement ------------------------------------------
      // Hand the freshly-uploaded asset to the embed service as a replacement
      // for this post's EXISTING asset. The service copies its manifest onto the
      // original entry once encoding finishes, so the entry keeps its permlink,
      // upload date, view count and feed position — and nothing on-chain moves.
      if (newAsset?.permlink) {
        const originalAssetPermlink = meta.video?.info?.permlink;
        if (!originalAssetPermlink) {
          throw new Error("This post has no embed video entry to replace — its metadata doesn't reference one.");
        }
        await registerMediaReplacement(newAsset.permlink, originalAssetPermlink);
        // A fresh, playable source means any "deleted"/unavailable shadow-ban no
        // longer applies — clear it so the badge drops. Best-effort + idempotent.
        if (CHECKER_API_KEY) {
          axios.post(
            `${CHECKER_URL}/video/reinstate`,
            { owner: author, permlink },
            { headers: { Authorization: `Bearer ${CHECKER_API_KEY}` } },
          ).catch((e) => console.warn('Reinstate (clear unavailable) failed:', e?.message));
        }
        // No toast here — the single success toast at the end carries the
        // encoding caveat, so a replacement doesn't fire two in a row.
      }
      const trimmedThumb = thumbnailUrl.trim();
      let finalBody = post.body || '';

      // Only broadcast to Hive when on-chain content actually changed (title,
      // body, tags incl. nsfw, or thumbnail). Listing is checker-only.
      if (contentDirty) {
        const newMeta = { ...meta };
        newMeta.tags = finalTags;
        // Allow Remix/Clip lives at json_metadata.video.reusable.
        newMeta.video = { ...(newMeta.video || { platform: '3speak' }), reusable };

        // Update thumbnail references in both `image` and `video.info.sourceMap`
        if (trimmedThumb) {
          newMeta.image = Array.isArray(newMeta.image)
            ? [trimmedThumb, ...newMeta.image.filter((u) => u !== trimmedThumb)]
            : [trimmedThumb];

          if (newMeta.video?.info?.sourceMap && Array.isArray(newMeta.video.info.sourceMap)) {
            const sm = newMeta.video.info.sourceMap.map((s) =>
              s.type === 'thumbnail' ? { ...s, url: trimmedThumb } : s
            );
            if (!sm.some((s) => s.type === 'thumbnail')) {
              sm.push({ type: 'thumbnail', url: trimmedThumb });
            }
            newMeta.video = { ...newMeta.video, info: { ...newMeta.video.info, sourceMap: sm } };
          }
        }

        // Rewrite the thumbnail URL inside the header's image-link, if present.
        let finalHeader = bodyHeader;
        if (trimmedThumb && finalHeader) {
          finalHeader = finalHeader.replace(
            /(\[\s*!\[[^\]]*\]\()[^)]*(\)\s*\]\([^)]*\))/,
            `$1${trimmedThumb}$2`
          );
        }

        finalBody = recombinePostBody(finalHeader, body, bodyFooter);

        const result = await commentWithAioha(
          post.parent_author || '',
          post.parent_permlink || '',
          permlink,
          title.trim(),
          finalBody,
          newMeta,
          null // don't touch comment_options on edit
        );
        if (!result?.success) {
          throw new Error(result?.error || 'Broadcast failed');
        }

        // Reflect the new thumbnail in Mongo immediately (best-effort).
        if (trimmedThumb && CHECKER_API_KEY) {
          try {
            await axios.put(
              `${CHECKER_URL}/video/thumbnail`,
              { owner: author, permlink, thumbnail: trimmedThumb },
              { headers: { Authorization: `Bearer ${CHECKER_API_KEY}` } },
            );
          } catch (thumbErr) {
            console.warn('Thumbnail Mongo update failed (will reconcile on sync):', thumbErr?.message);
          }
        }
      }

      // NSFW flag (immediate) — the nsfw tag above is canonical.
      if (nsfwChanged && CHECKER_API_KEY) {
        try {
          await axios.put(`${CHECKER_URL}/video/nsfw`, { owner: author, permlink, nsfw: isNsfw },
            { headers: { Authorization: `Bearer ${CHECKER_API_KEY}` } });
          initialNsfwRef.current = isNsfw;
        } catch (e) { console.warn('NSFW flag update failed:', e?.message); }
      }

      // Listing (unlist / re-list).
      if (listingChanged && CHECKER_API_KEY) {
        try {
          await axios.put(`${CHECKER_URL}/video/listing`, { owner: author, permlink, listed },
            { headers: { Authorization: `Bearer ${CHECKER_API_KEY}` } });
          initialListedRef.current = listed;
          toast.success(listed ? 'Video re-listed.' : 'Video unlisted.');
        } catch (e) {
          console.warn('Listing update failed:', e?.message);
          toast.error('Could not update the listing.');
        }
      }

      // Channel trailer (pin / unpin on the creator's own profile). Last, and
      // best-effort: it broadcasts an account_update2 of its own to mirror the
      // choice on chain, and a refused signature there must not read as the whole
      // edit having failed.
      if (trailerChanged) {
        try {
          await setChannelTrailer(author, isTrailer ? permlink : null, { author });
          initialTrailerRef.current = isTrailer;
          toast.success(isTrailer
            ? 'Set as your channel trailer.'
            : 'Removed as your channel trailer.');
        } catch (e) {
          console.warn('Channel trailer update failed:', e?.message);
          toast.error('Could not update your channel trailer.');
        }
      }

      // One success toast covering whatever actually changed. A replaced file
      // needs the encoding caveat: the save succeeded, but the new video will
      // not play for a few minutes yet — without saying so it reads as broken.
      if (videoDirty) {
        toast.success('Video updated! The new file needs a few moments to finish encoding.');
      } else if (contentDirty) {
        toast.success('Video updated!');
      }

      onSaved?.({
        title: title.trim(),
        body: finalBody,
        tags: finalTags,
        thumbnail: trimmedThumb,
      });
      onClose();
    } catch (err) {
      console.error('Edit save failed:', err);
      toast.error(err?.message || 'Failed to save changes.');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="edit-video-modal-overlay" onClick={onClose}>
      <div className="edit-video-modal-content" onClick={(e) => e.stopPropagation()}>
        <button className="edit-video-close-btn" onClick={onClose} aria-label="Close">
          <IoClose size={22} />
        </button>

        <h3 className="edit-video-title">Edit Video</h3>
        <p className="edit-video-subtitle">@{author}/{permlink}</p>

        {loading && (
          <div className="edit-video-loading">Loading current post…</div>
        )}

        {loadError && !loading && (
          <div className="edit-video-error">{loadError}</div>
        )}

        {!loading && !loadError && original && (
          <form className="edit-video-form" onSubmit={handleSave}>
            {/* Video file — swap the media without touching the post itself. */}
            <label className="edit-video-label">Video file</label>
            <div className="evm-video-replace">
              {!newVideoFile && (
                <>
                  <label className="evm-video-pick">
                    <MdUpload size={18} />
                    <span>Replace video</span>
                    <input
                      type="file"
                      accept="video/*"
                      hidden
                      onChange={handleVideoFilePick}
                    />
                  </label>
                  <p className="edit-video-hint">
                    Swaps the video file on this post. Everything else stays as it is: the
                    post keeps its likes, payout, comments, upload date and its place in
                    your profile. Leave this alone to keep the current video.
                  </p>
                </>
              )}

              {newVideoFile && (
                <div className="evm-video-staged">
                  <div className="evm-video-staged__name" title={newVideoFile.name}>
                    {newVideoFile.name}
                  </div>

                  {videoUploading && (
                    <>
                      <div className="evm-video-bar">
                        <div className="evm-video-bar__fill" style={{ width: `${videoUploadPct}%` }} />
                      </div>
                      <div className="evm-video-staged__status">
                        {uploadHost
                          ? <>Uploading to <b>{uploadHost}</b>… {videoUploadPct}%</>
                          : <>Choosing an upload server…</>}
                      </div>
                    </>
                  )}

                  {!videoUploading && newAsset && (
                    <div className="evm-video-staged__status evm-video-staged__status--ok">
                      Uploaded{uploadHost ? <> to <b>{uploadHost}</b></> : null}. Press Save to swap it in.
                    </div>
                  )}

                  <button
                    type="button"
                    className="evm-video-cancel"
                    onClick={cancelVideoReplacement}
                  >
                    {videoUploading ? 'Cancel upload' : 'Keep the current video'}
                  </button>

                  {!videoUploading && newAsset && (
                    <p className="edit-video-hint">
                      After you save it still needs a few minutes to encode, and the old
                      video keeps playing until it is ready. Your thumbnail is unchanged, so
                      update it above if it no longer matches.
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Thumbnail */}
            <label className="edit-video-label">Thumbnail</label>
            <div className="edit-video-thumb-row">
              {thumbnailUrl ? (
                <img
                  className="edit-video-thumb-preview"
                  src={thumbnailUrl}
                  alt="Thumbnail preview"
                  onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
                  onLoad={(e) => { e.currentTarget.style.visibility = 'visible'; }}
                />
              ) : (
                <div className="edit-video-thumb-placeholder"><MdImage size={32} /></div>
              )}
              <div className="edit-video-thumb-inputs">
                <input
                  type="url"
                  className="edit-video-input"
                  value={thumbnailUrl}
                  onChange={(e) => setThumbnailUrl(e.target.value)}
                  placeholder="https://..."
                  disabled={thumbUploading}
                />
                <button
                  type="button"
                  className="edit-video-upload-btn"
                  onClick={() => thumbInputRef.current?.click()}
                  disabled={thumbUploading || saving}
                  title="Upload an image"
                >
                  <MdUpload size={16} />
                  {thumbUploading ? 'Uploading…' : 'Upload'}
                </button>
                <input
                  ref={thumbInputRef}
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={handleThumbFilePick}
                />
              </div>
            </div>
            <span className="edit-video-hint">
              Upload an image or paste a direct URL. Leave unchanged to keep the current thumbnail.
            </span>

            {/* Title — hidden for shorts (they use their caption/description). */}
            {!isShort && <>
            <label className="edit-video-label">Title</label>
            <input
              type="text"
              className="edit-video-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={TITLE_MAX}
            />
            <span className={`edit-video-hint${!titleValid && title ? ' error' : ''}`}>
              {titleLen}/{TITLE_MAX}{isShort ? '' : ` · min ${TITLE_MIN}`}
            </span>
            </>}

            {/* Tags */}
            <label className="edit-video-label">Tags</label>
            <input
              type="text"
              className="edit-video-input"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="space-separated"
            />
            <div className="edit-video-tags-preview">
              {/* Auto-added taxonomy (community/category) — shown pinned and can't
                  be removed; it's always preserved on save. */}
              {systemTags.map((t) => (
                <span
                  key={`sys-${t}`}
                  className="tag--auto"
                  title="Added automatically — can't be removed"
                  style={{ opacity: 0.7, fontStyle: 'italic' }}
                >
                  {t}
                </span>
              ))}
              {parsedTags.map((t) => <span key={t}>{t}</span>)}
            </div>
            <span className={`edit-video-hint${!tagsValid && parsedTags.length ? ' error' : ''}`}>
              {parsedTags.length}/{userTagLimit} tags{isShort ? '' : ' · at least 1 required'}
            </span>

            {/* Body */}
            <label className="edit-video-label">Description</label>
            <textarea
              className="edit-video-textarea"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={10}
              placeholder="Tell viewers about your video…"
            />
            <span className="edit-video-hint">Supports markdown.</span>

            {/* Listing / Remix / NSFW toggles + Promote */}
            <div className="evm-toggle-row">
              <button
                type="button"
                role="switch"
                aria-checked={listed}
                className={`evm-switch${listed ? ' is-on' : ''}`}
                onClick={() => setListed((v) => !v)}
                disabled={saving}
              >
                <span className="evm-switch__track"><span className="evm-switch__thumb" /></span>
                <span className="evm-switch__label">
                  <strong>{listed ? 'Listed' : 'Unlisted'}</strong>
                  <small>{listed ? 'Shown in feeds, search and on your profile.' : 'Hidden from feeds & search — still plays by direct link, stays on your profile (badged).'}</small>
                </span>
              </button>

              {!isShort && (
              <button
                type="button"
                role="switch"
                aria-checked={reusable}
                className={`evm-switch${reusable ? ' is-on' : ''}`}
                onClick={() => setReusable((v) => !v)}
                disabled={saving}
              >
                <span className="evm-switch__track"><span className="evm-switch__thumb" /></span>
                <span className="evm-switch__label">
                  <strong>Allow Remix/Clip</strong>
                  <small>{reusable ? 'Others can create remixes/clips; you are credited as original author.' : 'Others cannot remix or clip this video.'}</small>
                </span>
              </button>
              )}

              {/* Landscape only: the trailer frame on Overview is 16:9. */}
              {!isShort && isOwner && trailerKnown && (
              <button
                type="button"
                role="switch"
                aria-checked={isTrailer}
                className={`evm-switch${isTrailer ? ' is-on' : ''}`}
                onClick={() => setIsTrailer((v) => !v)}
                disabled={saving}
              >
                <span className="evm-switch__track"><span className="evm-switch__thumb" /></span>
                <span className="evm-switch__label">
                  <strong>Channel trailer</strong>
                  <small>{isTrailer
                    ? 'Autoplays at the top of your profile\u2019s Overview tab, replacing any trailer you set before.'
                    : 'Make this the video that autoplays at the top of your profile\u2019s Overview tab.'}</small>
                </span>
              </button>
              )}

              <button
                type="button"
                role="switch"
                aria-checked={isNsfw}
                className={`evm-switch evm-switch--danger${isNsfw ? ' is-on' : ''}`}
                onClick={() => setIsNsfw((v) => !v)}
                disabled={saving}
              >
                <span className="evm-switch__track"><span className="evm-switch__thumb" /></span>
                <span className="evm-switch__label">
                  <strong>{isNsfw ? 'Adult / NSFW' : 'Not adult'}</strong>
                  <small>{isNsfw ? 'Hidden from feeds & search unless the viewer enabled NSFW; tagged nsfw on Hive.' : 'Normal content, shown to everyone.'}</small>
                </span>
              </button>

              {!isShort && (
              <button
                type="button"
                className="evm-promote-btn"
                onClick={() => setPromoteOpen(true)}
                disabled={saving}
              >
                <Rocket size={16} />
                {promotedUntil && new Date(promotedUntil).getTime() > Date.now() ? 'Promoted' : 'Promote video'}
              </button>
              )}
            </div>

            <div className="edit-video-actions">
              <button
                type="button"
                className="edit-video-btn-secondary"
                onClick={onClose}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="edit-video-btn-primary"
                disabled={!canSave || !isDirty}
              >
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </form>
        )}
      </div>

      <PromoteModal
        open={promoteOpen}
        onClose={() => setPromoteOpen(false)}
        author={author}
        permlink={permlink}
        promotedUntil={promotedUntil}
        onPromoted={(until) => setPromotedUntil(until)}
      />
    </div>,
    document.body
  );
}
