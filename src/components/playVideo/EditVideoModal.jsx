import { useState, useEffect, useMemo, useRef } from 'react';
import { getHiveClient } from '../../utils/hiveNode';
import { createPortal } from 'react-dom';
import { useTranslation, Trans } from 'react-i18next';
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
import { Rocket, FileText, Image as ImageIcon, ListOrdered, SlidersHorizontal } from 'lucide-react';
import TimelineEditor, { withTimelineKeys, chapterIssues } from '../timeline/TimelineEditor';
import { readTimeline, withTimeline, applyTimelineToBody, chaptersFromText } from '../../utils/videoTimeline';
import { fetchPlaySource } from '../../lib/videoData';
import { fetchCreatorAdPrefs, syncVideoAdChoice } from '../../lib/advertiseData';
import { adsEnabledFor } from '../../utils/config';
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

/**
 * The timeline as the creator is editing it, for the change check. Raw, not
 * normalised: a half-made chapter (no title yet) normalises away, and it must
 * still count as a change, or its error badge and the Save guard never show.
 */
function timelineSnapshot(chapters, links) {
  return JSON.stringify([
    (chapters || []).map((c) => [c.start, c.title]),
    // eslint-disable-next-line no-unused-vars
    (links || []).map(({ _k, _thumb, ...rest }) => rest),
  ]);
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
  const { t } = useTranslation();
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

  // Ads on THIS video, stored in the post (json_metadata["3speak"]: `ads: false`
  // = none, `rolls: false` = banners and tickers only) and mirrored by the
  // checker. Offered only when the account carries ads (and the rolls switch only
  // when it carries rolls), the same rule as the uploader's Details step.
  const [videoAds, setVideoAds] = useState(true);
  const [videoRolls, setVideoRolls] = useState(true);
  const [accountAds, setAccountAds] = useState({ ads: false, rolls: false });

  // ⏱️ Timeline (long-form only): chapters + link toasters, the same editor as
  // the upload wizard's Timeline step. Previewed against the published stream
  // (HLS via play.3speak.tv), fetched only once the section is opened.
  const [tlChapters, setTlChapters] = useState([]);
  const [tlLinks, setTlLinks] = useState([]);
  // Visited, not "open": set the first time the Chapters & links tab is shown,
  // which is what asks for the published stream. Stays set until the dialog closes.
  const [tlOpen, setTlOpen] = useState(false);
  // Which tab is showing. Every opening starts on Details.
  const [tab, setTab] = useState('details');
  const [tlSrc, setTlSrc] = useState(null);
  const [tlSrcState, setTlSrcState] = useState('idle'); // idle | loading | done
  const [tlDuration, setTlDuration] = useState(0);
  const tlBaselineRef = useRef('');

  // The account's own ad setting decides which per-video switches mean anything.
  // Hidden until a definite answer, like the uploader: a failed read must not
  // offer a switch that would do nothing.
  useEffect(() => {
    if (!isOpen || !isOwner || !adsEnabledFor(author)) return undefined;
    let alive = true;
    fetchCreatorAdPrefs(author)
      .then((p) => {
        if (!alive) return;
        const ads = p?.adsEnabled === true;
        setAccountAds({ ads, rolls: ads && p?.rollsEnabled !== false });
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [isOpen, isOwner, author]);

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
          setLoadError(t('watch.edit.errors.notFound'));
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
        const tagNsfw = metaTags.some((tag) => String(tag).toLowerCase() === 'nsfw');
        // Separate the auto-added taxonomy (3speak, community/category, short)
        // and the nsfw flag from the user's own tags, so the count/limit here
        // matches the uploader (which validates only the user tags and prepends
        // the taxonomy). The taxonomy is preserved and re-added on save.
        const category = String(post.category || '').toLowerCase();
        const isSystemTag = (tag) => {
          const lc = String(tag).toLowerCase();
          return lc === '3speak' || lc === 'short' || lc === 'nsfw' || lc === category;
        };
        setSystemTags(metaTags.filter((tag) => isSystemTag(tag) && String(tag).toLowerCase() !== 'nsfw'));
        setTagsInput(metaTags.filter((tag) => !isSystemTag(tag)).join(' '));
        setThumbnailUrl(currentThumb);
        initialThumbRef.current = currentThumb;
        const metaReusable = meta.video?.reusable !== false;
        setReusable(metaReusable);
        initialReusableRef.current = metaReusable;
        const adNs = meta['3speak'] && typeof meta['3speak'] === 'object' ? meta['3speak'] : {};
        setVideoAds(adNs.ads !== false);
        setVideoRolls(adNs.ads === false || adNs.rolls !== false);
        // Timeline: the stored one, or (none yet) chapters already typed into
        // the description, so the editor starts from what viewers see today.
        const metaDuration = Number(meta.video?.info?.duration) || 0;
        const tl = readTimeline(meta);
        const startChapters = tl.chapters.length ? tl.chapters : chaptersFromText(middle);
        setTlDuration(metaDuration);
        setTlChapters(withTimelineKeys(startChapters));
        setTlLinks(withTimelineKeys(tl.links));
        tlBaselineRef.current = timelineSnapshot(startChapters, tl.links);
        setLoading(false);

        // Pull checker-backed state (listing, NSFW flag, promotion) from the doc.
        try {
          const { data: doc } = await axios.get(`${CHECKER_URL}/videodetails/${author}/${permlink}`);
          if (!cancelled && doc) {
            const isListed = doc.listed_on_3speak !== false;
            const nsfw = doc.isNsfwContent === true || tagNsfw
              || (Array.isArray(doc.hive_tags) && doc.hive_tags.some((tag) => String(tag).toLowerCase() === 'nsfw'));
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
        setLoadError(t('watch.edit.errors.loadFailed'));
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
    setVideoAds(true);
    setVideoRolls(true);
    setAccountAds({ ads: false, rolls: false });
    initialListedRef.current = true;
    initialNsfwRef.current = false;
    initialReusableRef.current = true;
    initialTrailerRef.current = false;
    setTlChapters([]);
    setTlLinks([]);
    setTlOpen(false);
    setTab('details');
    setTlSrc(null);
    setTlSrcState('idle');
    setTlDuration(0);
    tlBaselineRef.current = '';
    tlSrcAskedRef.current = false;
  }, [isOpen]);

  // The published stream for the timeline preview, asked for when the section
  // opens. No source (a gated video, a missing asset) leaves manual times only.
  const tlSrcAskedRef = useRef(false);
  useEffect(() => {
    if (!isOpen || !tlOpen || tlSrcAskedRef.current || !author || !permlink) return undefined;
    tlSrcAskedRef.current = true;
    let alive = true;
    let finished = false;
    setTlSrcState('loading');
    fetchPlaySource(author, permlink)
      .then((src) => {
        if (!alive) return;
        setTlSrc(src?.play_url || null);
        if (src?.duration > 0) setTlDuration((d) => d || src.duration);
      })
      .catch(() => {})
      .finally(() => { finished = true; if (alive) setTlSrcState('done'); });
    return () => {
      alive = false;
      // Closed before it answered: ask again next time it opens.
      if (!finished) { tlSrcAskedRef.current = false; setTlSrcState('idle'); }
    };
  }, [isOpen, tlOpen, author, permlink]);

  // Parse tags input (space/comma separated, lowercased, deduplicated)
  const parsedTags = useMemo(() => {
    if (!tagsInput) return [];
    const raw = tagsInput
      .toLowerCase()
      .split(/[\s,]+/)
      .map((tag) => tag.trim())
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
  // The timeline lives in json_metadata, which contentDirty does not look at.
  const timelineDirty = !isShort && !!original
    && timelineSnapshot(tlChapters, tlLinks) !== tlBaselineRef.current;
  const timelineIssues = timelineDirty ? chapterIssues(tlChapters, tlDuration) : [];
  // Block Save while a replacement is still uploading: saving then would
  // broadcast the post still pointing at the OLD asset and silently discard the
  // upload in progress.
  const canSave = titleValid && tagsValid && bodyValid && !!original && !saving && !videoUploading
    && !timelineIssues.length;

  // Final on-chain tags = preserved taxonomy + the user's tags + the canonical
  // `nsfw` tag when marked adult (deduped, taxonomy first — same shape the
  // uploader produces).
  const finalTags = useMemo(() => {
    const sys = systemTags.filter((tag) => String(tag).toLowerCase() !== 'nsfw');
    const user = parsedTags.filter((tag) => tag !== 'nsfw');
    const combined = [...new Set([...sys, ...user])];
    return isNsfw ? [...combined, 'nsfw'] : combined;
  }, [systemTags, parsedTags, isNsfw]);

  // What the post said when the dialog opened, for the change checks below.
  const orig = useMemo(() => {
    if (!original) return null;
    const sm = original.meta.video?.info?.sourceMap;
    const smThumb = Array.isArray(sm) ? sm.find((s) => s.type === 'thumbnail')?.url : '';
    return {
      title: (original.post.title || '').trim(),
      middle: splitPostBody(original.post.body || '').middle,
      tags: Array.isArray(original.meta.tags) ? original.meta.tags : [],
      thumb: smThumb || (Array.isArray(original.meta.image) ? (original.meta.image[0] || '') : ''),
      reusable: original.meta.video?.reusable !== false,
      ads: original.meta['3speak']?.ads !== false,
      rolls: original.meta['3speak']?.ads === false || original.meta['3speak']?.rolls !== false,
    };
  }, [original]);

  // Per field, so each tab can say whether IT has unsaved changes.
  const titleDirty = !!orig && title.trim() !== orig.title;
  const bodyDirty = !!orig && body !== orig.middle;
  const tagsDirty = !!orig && finalTags.join(' ') !== orig.tags.join(' ');   // includes the nsfw tag
  const userTagsDirty = !!orig && finalTags.filter((x) => x !== 'nsfw').join(' ') !== orig.tags.filter((x) => x !== 'nsfw').join(' ');
  const thumbDirty = !!orig && thumbnailUrl.trim() !== (orig.thumb || initialThumbRef.current || '').trim();
  const reusableDirty = !!orig && reusable !== orig.reusable;
  // Rolls only count while ads are on: with ads off the rolls switch is hidden.
  const adsDirty = !!orig && (videoAds !== orig.ads || (videoAds && videoRolls !== orig.rolls));

  // On-chain content change (needs a Hive broadcast). Includes the nsfw tag.
  const contentDirty = titleDirty || bodyDirty || tagsDirty || thumbDirty || reusableDirty || adsDirty;

  const listingChanged = listed !== initialListedRef.current;
  const nsfwChanged = isNsfw !== initialNsfwRef.current;
  const trailerChanged = isTrailer !== initialTrailerRef.current;
  // A replaced video file is deliberately NOT part of contentDirty: the media is
  // swapped on the existing embed entry, so the post's json_metadata and body
  // keep pointing at the same URL and no Hive broadcast is needed for it.
  const videoDirty = !!newAsset;
  // Checker-only changes (listing) don't need a broadcast but should enable Save.
  const isDirty = contentDirty || listingChanged || videoDirty || trailerChanged || timelineDirty;

  // Tab indicators: a dot for unsaved changes, a badge for something to fix.
  const detailsDirty = titleDirty || bodyDirty || userTagsDirty;
  const mediaDirty = thumbDirty || !!newVideoFile;
  const settingsDirty = listingChanged || nsfwChanged || reusableDirty || trailerChanged || adsDirty;
  const detailsError = !!original && (!titleValid || !tagsValid || !bodyValid);
  // The first tab Save would trip over, in tab order.
  const errorTab = detailsError ? 'details' : (timelineIssues.length ? 'timeline' : null);

  const selectTab = (id) => {
    if (id === 'timeline') {
      if (isShort) return;
      setTlOpen(true);
    }
    setTab(id);
  };

  // Save from any tab. With something to fix, it goes to that tab instead.
  const trySave = (e) => {
    e?.preventDefault?.();
    if (!original || saving || videoUploading) return;
    if (errorTab) {
      selectTab(errorTab);
      toast.error(t('watch.edit.fixErrors'));
      return;
    }
    handleSave();
  };

  // Esc closes, unless a dialog of its own is open on top (the link form of the
  // timeline editor, or Promote): that one takes the key.
  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (promoteOpen || document.querySelector('.tle-sheet')) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, promoteOpen, onClose]);

  const handleThumbFilePick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error(t('watch.edit.errors.notImage'));
      return;
    }
    // 10 MB cap — same ballpark as the uploader
    if (file.size > 10 * 1024 * 1024) {
      toast.error(t('watch.edit.errors.imageTooLarge'));
      return;
    }
    setThumbUploading(true);
    try {
      const url = await uploadThumbnail(file);
      setThumbnailUrl(url);
      toast.success(t('watch.edit.thumbUploaded'));
    } catch (err) {
      console.error('Thumbnail upload failed:', err);
      toast.error(err?.message || t('watch.edit.errors.thumbUploadFailed'));
    } finally {
      setThumbUploading(false);
    }
  };

  const handleVideoFilePick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (!file) return;
    if (!file.type.startsWith('video/')) {
      toast.error(t('watch.edit.errors.notVideo'));
      return;
    }
    // Same 5GB ceiling the embed studio enforces (and the server enforces too).
    if (file.size > 5 * 1024 * 1024 * 1024) {
      toast.error(t('watch.edit.errors.videoTooLarge'));
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
      toast.error(t('watch.edit.errors.noVideoEntry'));
      return;
    }
    const target = await fetchReplaceTarget(originalAssetPermlink);
    // `null` means no host could answer. That's a health problem, not a verdict
    // on this video, so don't block the upload on it.
    if (target?.found === false) {
      toast.error(t('watch.edit.errors.notInLibrary'));
      return;
    }
    if (target?.owner && target.owner !== author) {
      toast.error(t('watch.edit.errors.notOwner'));
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
      toast.success(t('watch.edit.videoUploaded'));
    } catch (err) {
      console.error('Video replacement upload failed:', err);
      toast.error(err?.message || t('watch.edit.errors.videoUploadFailed'));
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
      toast.info(t('watch.edit.noChanges'));
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
          throw new Error(t('watch.edit.errors.noEmbedEntry'));
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
      let savedMeta = null;

      // Only broadcast to Hive when on-chain content actually changed (title,
      // body, tags incl. nsfw, thumbnail, or the timeline). Listing is checker-only.
      if (contentDirty || timelineDirty) {
        const newMeta = { ...meta };
        newMeta.tags = finalTags;
        // Allow Remix/Clip lives at json_metadata.video.reusable.
        newMeta.video = { ...(newMeta.video || { platform: '3speak' }), reusable };
        // Ads on this video. Only the two keys this owns are touched, so anything
        // else some app keeps under "3speak" survives; an empty block is dropped.
        if (adsDirty) {
          const adNs = { ...(newMeta['3speak'] && typeof newMeta['3speak'] === 'object' ? newMeta['3speak'] : {}) };
          delete adNs.ads;
          delete adNs.rolls;
          if (!videoAds) adNs.ads = false;
          else if (!videoRolls) adNs.rolls = false;
          if (Object.keys(adNs).length) newMeta['3speak'] = adNs;
          else delete newMeta['3speak'];
        }
        // ⏱️ Timeline: rewritten only when it was edited, so an edit of something
        // else never touches (or re-normalises) what is stored.
        if (timelineDirty) {
          newMeta.video = withTimeline(newMeta.video, tlChapters, tlLinks, { duration: tlDuration });
        }

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

        // Chapters and links also go into the description under "Video Chapters"
        // (3+ from 0:00, times linked to that moment on 3speak.tv) and "Video
        // Links" headings, replacing the old sections, so other Hive apps show them.
        const editedBody = timelineDirty
          ? applyTimelineToBody(body, withTimeline({}, tlChapters, tlLinks, { duration: tlDuration }), { author, permlink })
          : body;
        finalBody = recombinePostBody(finalHeader, editedBody, bodyFooter);
        savedMeta = newMeta;

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
          throw new Error(result?.error || t('watch.edit.errors.broadcastFailed'));
        }

        // The checker mirrors the choice from the chain, so it waits for the edit
        // to be readable there. In the background: the save itself is done, and a
        // failure is said out loud because ads would keep playing as before.
        if (adsDirty) {
          const mode = !videoAds ? 'off' : (videoRolls ? 'on' : 'no-rolls');
          syncVideoAdChoice(author, permlink, mode)
            .catch((e) => {
              console.warn('Per-video ad setting sync failed:', e?.message);
              toast.error(t('watch.edit.errors.adsSyncFailed'));
            });
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
          toast.success(listed ? t('watch.edit.relisted') : t('watch.edit.unlisted'));
        } catch (e) {
          console.warn('Listing update failed:', e?.message);
          toast.error(t('watch.edit.errors.listingFailed'));
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
            ? t('watch.edit.trailerSet')
            : t('watch.edit.trailerRemoved'));
        } catch (e) {
          console.warn('Channel trailer update failed:', e?.message);
          toast.error(t('watch.edit.errors.trailerFailed'));
        }
      }

      // One success toast covering whatever actually changed. A replaced file
      // needs the encoding caveat: the save succeeded, but the new video will
      // not play for a few minutes yet — without saying so it reads as broken.
      if (videoDirty) {
        toast.success(t('watch.edit.updatedEncoding'));
      } else if (contentDirty || timelineDirty) {
        toast.success(t('watch.edit.updated'));
      }

      onSaved?.({
        title: title.trim(),
        body: finalBody,
        tags: finalTags,
        thumbnail: trimmedThumb,
        // The metadata as broadcast (null when nothing on chain changed), so the
        // watch page picks the new timeline up without waiting for the indexer.
        json_metadata: savedMeta,
      });
      onClose();
    } catch (err) {
      console.error('Edit save failed:', err);
      toast.error(err?.message || t('watch.edit.errors.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  const tabs = [
    { id: 'details', icon: FileText, label: t('watch.edit.tabs.details'), dirty: detailsDirty, error: detailsError },
    { id: 'media', icon: ImageIcon, label: t('watch.edit.tabs.media'), dirty: mediaDirty, error: false },
    ...(!isShort ? [{ id: 'timeline', icon: ListOrdered, label: t('watch.edit.timeline'), dirty: timelineDirty, error: timelineIssues.length > 0 }] : []),
    { id: 'settings', icon: SlidersHorizontal, label: t('watch.edit.tabs.settings'), dirty: settingsDirty, error: false },
  ];

  // Arrow keys move between tabs (and select them), Home/End jump to the ends.
  const onTabKey = (e) => {
    const i = tabs.findIndex((x) => x.id === tab);
    let next = null;
    if (e.key === 'ArrowRight') next = tabs[(i + 1) % tabs.length];
    else if (e.key === 'ArrowLeft') next = tabs[(i - 1 + tabs.length) % tabs.length];
    else if (e.key === 'Home') next = tabs[0];
    else if (e.key === 'End') next = tabs[tabs.length - 1];
    if (!next) return;
    e.preventDefault();
    selectTab(next.id);
    requestAnimationFrame(() => document.getElementById(`evm-tab-${next.id}`)?.focus());
  };

  const ready = !loading && !loadError && !!original;

  return createPortal(
    <div className="edit-video-modal-overlay" onClick={onClose}>
      <form
        className="edit-video-modal-content"
        onClick={(e) => e.stopPropagation()}
        onSubmit={trySave}
        role="dialog"
        aria-modal="true"
        aria-labelledby="evm-title"
        noValidate
      >
        <header className="evm-header">
          <div className="evm-header__text">
            <h3 className="edit-video-title" id="evm-title">{t('watch.edit.title')}</h3>
            <p className="edit-video-subtitle">@{author}/{permlink}</p>
          </div>
          <button type="button" className="edit-video-close-btn" onClick={onClose} aria-label={t('common.actions.close')}>
            <IoClose size={22} />
          </button>
        </header>

        <div className="evm-tabs" role="tablist" aria-label={t('watch.edit.tabs.label')} onKeyDown={onTabKey}>
          {tabs.map(({ id, icon: Icon, label, dirty, error }) => (
            <button
              key={id}
              id={`evm-tab-${id}`}
              type="button"
              role="tab"
              aria-selected={tab === id}
              aria-controls={`evm-panel-${id}`}
              tabIndex={tab === id ? 0 : -1}
              className={`evm-tab${tab === id ? ' is-active' : ''}${error ? ' has-error' : ''}`}
              onClick={() => selectTab(id)}
              disabled={!ready}
            >
              <Icon size={16} aria-hidden="true" />
              <span className="evm-tab__label">{label}</span>
              {error ? (
                <span className="evm-tab__badge" title={t('watch.edit.tabs.hasErrors')} aria-label={t('watch.edit.tabs.hasErrors')}>!</span>
              ) : dirty ? (
                <span className="evm-tab__dot" title={t('watch.edit.tabs.unsaved')} aria-label={t('watch.edit.tabs.unsaved')} />
              ) : null}
            </button>
          ))}
        </div>

        <div className="evm-body">
          {loading && (
            <div className="edit-video-loading">{t('watch.edit.loading')}</div>
          )}

          {loadError && !loading && (
            <div className="edit-video-error">{loadError}</div>
          )}

          {ready && tab === 'details' && (
            <div className="evm-panel" role="tabpanel" id="evm-panel-details" aria-labelledby="evm-tab-details">
              {/* Title: hidden for shorts (they use their caption/description). */}
              {!isShort && (
                <div className="evm-field">
                  <label className="edit-video-label" htmlFor="evm-title-input">{t('watch.edit.titleLabel')}</label>
                  <input
                    id="evm-title-input"
                    type="text"
                    className="edit-video-input"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    maxLength={TITLE_MAX}
                  />
                  <span className={`edit-video-hint${!titleValid && title ? ' error' : ''}`}>
                    {titleLen}/{TITLE_MAX} · {t('watch.edit.titleMin', { min: TITLE_MIN })}
                  </span>
                </div>
              )}

              <div className="evm-field">
                <label className="edit-video-label" htmlFor="evm-body-input">{t('watch.edit.description')}</label>
                <textarea
                  id="evm-body-input"
                  className="edit-video-textarea"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={10}
                  placeholder={t('watch.edit.descriptionPlaceholder')}
                />
                <span className={`edit-video-hint${!bodyValid ? ' error' : ''}`}>{t('watch.edit.markdownHint')}</span>
                {!isShort && (
                  <p className="evm-note">
                    {t('watch.edit.chaptersNote')}{' '}
                    <button type="button" className="evm-linkbtn" onClick={() => selectTab('timeline')}>
                      {t('watch.edit.editChapters')}
                    </button>
                  </p>
                )}
              </div>

              <div className="evm-field">
                <label className="edit-video-label" htmlFor="evm-tags-input">{t('watch.edit.tags')}</label>
                <input
                  id="evm-tags-input"
                  type="text"
                  className="edit-video-input"
                  value={tagsInput}
                  onChange={(e) => setTagsInput(e.target.value)}
                  placeholder={t('watch.edit.tagsPlaceholder')}
                />
                <div className="edit-video-tags-preview">
                  {/* Auto-added taxonomy (community/category): shown pinned and
                      can't be removed; it's always preserved on save. */}
                  {systemTags.map((tag) => (
                    <span key={`sys-${tag}`} className="tag--auto" title={t('watch.edit.autoTag')}>
                      {tag}
                    </span>
                  ))}
                  {parsedTags.map((tag) => <span key={tag}>{tag}</span>)}
                </div>
                <span className={`edit-video-hint${!tagsValid ? ' error' : ''}`}>
                  {isShort ? t('watch.edit.tagCount', { count: parsedTags.length, max: userTagLimit }) : t('watch.edit.tagCountRequired', { count: parsedTags.length, max: userTagLimit })}
                </span>
              </div>
            </div>
          )}

          {ready && tab === 'media' && (
            <div className="evm-panel" role="tabpanel" id="evm-panel-media" aria-labelledby="evm-tab-media">
              <section className="evm-group">
                <h4 className="evm-group__title">{t('watch.edit.thumbnail')}</h4>
                <div className="edit-video-thumb-row">
                  {thumbnailUrl ? (
                    <img
                      className="edit-video-thumb-preview"
                      src={thumbnailUrl}
                      alt={t('watch.edit.thumbPreviewAlt')}
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
                      aria-label={t('watch.edit.thumbnail')}
                    />
                    <button
                      type="button"
                      className="edit-video-upload-btn"
                      onClick={() => thumbInputRef.current?.click()}
                      disabled={thumbUploading || saving}
                      title={t('watch.edit.uploadImage')}
                    >
                      <MdUpload size={16} />
                      {thumbUploading ? t('watch.edit.uploading') : t('common.actions.upload')}
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
                <span className="edit-video-hint">{t('watch.edit.thumbHint')}</span>
              </section>

              {/* Video file: swap the media without touching the post itself. */}
              <section className="evm-group">
                <h4 className="evm-group__title">{t('watch.edit.videoFile')}</h4>
                <div className="evm-video-replace">
                  {!newVideoFile && (
                    <>
                      <label className="evm-video-pick">
                        <MdUpload size={18} />
                        <span>{t('watch.edit.replaceVideo')}</span>
                        <input
                          type="file"
                          accept="video/*"
                          hidden
                          onChange={handleVideoFilePick}
                        />
                      </label>
                      <p className="edit-video-hint">{t('watch.edit.replaceHint')}</p>
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
                              ? <Trans i18nKey="watch.edit.uploadingTo" values={{ host: uploadHost, pct: videoUploadPct }} components={{ b: <b /> }} />
                              : t('watch.edit.choosingServer')}
                          </div>
                        </>
                      )}

                      {!videoUploading && newAsset && (
                        <div className="evm-video-staged__status evm-video-staged__status--ok">
                          {uploadHost
                            ? <Trans i18nKey="watch.edit.uploadedTo" values={{ host: uploadHost }} components={{ b: <b /> }} />
                            : t('watch.edit.uploaded')}
                        </div>
                      )}

                      <button type="button" className="evm-video-cancel" onClick={cancelVideoReplacement}>
                        {videoUploading ? t('watch.edit.cancelUpload') : t('watch.edit.keepCurrent')}
                      </button>

                      {!videoUploading && newAsset && (
                        <p className="edit-video-hint">{t('watch.edit.encodeHint')}</p>
                      )}
                    </div>
                  )}
                </div>
              </section>
            </div>
          )}

          {/* ⏱️ Chapters + link toasters (long-form only). The published stream
              for its preview is fetched the first time this tab opens. */}
          {ready && tab === 'timeline' && !isShort && (
            <div className="evm-panel" role="tabpanel" id="evm-panel-timeline" aria-labelledby="evm-tab-timeline">
              <p className="edit-video-hint evm-panel__intro">{t('watch.edit.timelineHint')}</p>
              {tlSrcState === 'loading' ? (
                <p className="edit-video-hint">{t('watch.edit.timelineLoadingVideo')}</p>
              ) : (
                <TimelineEditor
                  src={tlSrc}
                  hls
                  poster={thumbnailUrl || null}
                  duration={tlDuration}
                  chapters={tlChapters}
                  links={tlLinks}
                  onChaptersChange={setTlChapters}
                  onLinksChange={setTlLinks}
                />
              )}
            </div>
          )}

          {ready && tab === 'settings' && (
            <div className="evm-panel" role="tabpanel" id="evm-panel-settings" aria-labelledby="evm-tab-settings">
              <section className="evm-group">
                <h4 className="evm-group__title">{t('watch.edit.sections.visibility')}</h4>
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
                      <strong>{listed ? t('watch.edit.listed') : t('watch.edit.unlistedLabel')}</strong>
                      <small>{listed ? t('watch.edit.listedHint') : t('watch.edit.unlistedHint')}</small>
                    </span>
                  </button>

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
                        <strong>{t('watch.edit.trailer')}</strong>
                        <small>{isTrailer ? t('watch.edit.trailerOn') : t('watch.edit.trailerOff')}</small>
                      </span>
                    </button>
                  )}
                </div>
              </section>

              <section className="evm-group">
                <h4 className="evm-group__title">{t('watch.edit.sections.content')}</h4>
                <div className="evm-toggle-row">
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
                      <strong>{isNsfw ? t('watch.edit.nsfw') : t('watch.edit.notNsfw')}</strong>
                      <small>{isNsfw ? t('watch.edit.nsfwHint') : t('watch.edit.notNsfwHint')}</small>
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
                        <strong>{t('watch.edit.allowRemix')}</strong>
                        <small>{reusable ? t('watch.edit.remixOn') : t('watch.edit.remixOff')}</small>
                      </span>
                    </button>
                  )}
                </div>
              </section>

              {isOwner && accountAds.ads && (
                <section className="evm-group">
                  <h4 className="evm-group__title">{t('watch.edit.sections.ads')}</h4>
                  <div className="evm-toggle-row">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={videoAds}
                      className={`evm-switch${videoAds ? ' is-on' : ''}`}
                      onClick={() => setVideoAds((v) => !v)}
                      disabled={saving}
                    >
                      <span className="evm-switch__track"><span className="evm-switch__thumb" /></span>
                      <span className="evm-switch__label">
                        <strong>{t('watch.edit.adsOnVideo')}</strong>
                        <small>{videoAds ? t('watch.edit.adsOnHint') : t('watch.edit.adsOffHint')}</small>
                      </span>
                    </button>

                    {accountAds.rolls && videoAds && (
                      <button
                        type="button"
                        role="switch"
                        aria-checked={videoRolls}
                        className={`evm-switch${videoRolls ? ' is-on' : ''}`}
                        onClick={() => setVideoRolls((v) => !v)}
                        disabled={saving}
                      >
                        <span className="evm-switch__track"><span className="evm-switch__thumb" /></span>
                        <span className="evm-switch__label">
                          <strong>{t('watch.edit.rollsOnVideo')}</strong>
                          <small>{videoRolls ? t('watch.edit.rollsOnHint') : t('watch.edit.rollsOffHint')}</small>
                        </span>
                      </button>
                    )}
                  </div>
                </section>
              )}

              {!isShort && (
                <section className="evm-group">
                  <h4 className="evm-group__title">{t('watch.edit.sections.promotion')}</h4>
                  <button
                    type="button"
                    className="evm-promote-btn"
                    onClick={() => setPromoteOpen(true)}
                    disabled={saving}
                  >
                    <Rocket size={16} />
                    {promotedUntil && new Date(promotedUntil).getTime() > Date.now() ? t('watch.edit.promoted') : t('watch.edit.promote')}
                  </button>
                </section>
              )}
            </div>
          )}
        </div>

        {/* One Save for every tab, as before: only what changed is written. */}
        <footer className="evm-footer">
          <button
            type="button"
            className="edit-video-btn-secondary"
            onClick={onClose}
            disabled={saving}
          >
            {t('common.actions.cancel')}
          </button>
          <button
            type="submit"
            className={`edit-video-btn-primary${errorTab ? ' is-blocked' : ''}`}
            disabled={!ready || !isDirty || saving || videoUploading}
            aria-disabled={errorTab ? 'true' : undefined}
          >
            {saving ? t('common.actions.saving') : t('watch.edit.saveChanges')}
          </button>
        </footer>
      </form>

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
