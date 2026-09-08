import React, { createContext, useContext, useState, useRef, useEffect, useCallback } from 'react';
import { resolveSnapsContainer } from '../utils/snapsContainer';
import { getCreatorSettings, isUploadBlocked } from '../utils/creatorSettings';
import { useSupportBlock } from '../lib/supportBlockStore';
import { useNavigate } from 'react-router-dom';
import * as tus from 'tus-js-client';
import { toastIn } from '../utils/toast';
import { EMBED_UPLOAD_URL, EMBED_API_URL, EMBED_API_KEY, HIVE_API_URL, EMBED_DEBUG, CHECKER_API_KEY } from '../utils/config';
import { uploadThumbnail } from '../utils/uploadThumbnail';
import { pickEmbedEndpoint } from '../utils/embedEndpoints';
import { reloadIfStale } from '../utils/checkLatestVersion';
import { commentWithAioha, broadcastWithAioha, signMessageWithAioha, isLoggedIn, getCurrentProvider, Providers, broadcastViaThreespeak, KeyTypes } from '../hive-api/aioha';
import { hasThreespeakPostingAuth, addThreespeakToPostingAuth } from '../utils/postingAuthority';
import { useAppStore } from '../lib/store';
import { usePremiumStatus } from '../hooks/usePremiumStatus';
import { setChannelTrailer } from '../utils/channelTrailer';
import { enforceLockedBeneficiaries, getLockedBeneficiaries, chargesEncoder, LOCKED_FUND_ACCOUNT, LOCKED_ENCODER_ACCOUNT } from '../utils/beneficiaries';
import { oaEnvelope, threespeakVideo, probeVideoOrientation, OA_ARTICLE, OA_MICROPOST, OA_COMMENT } from '../utils/openAttribute';
import axios from 'axios';
import { isWeakLinkForced } from '../utils/uploadFaults';

// Every toast from this module is headed "Upload"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Upload');

// Hosts that support TUS resume (tusd-backed). The legacy embed.3speak.tv origin
// does NOT — a leftover fingerprint there fails with "invalid or missing length
// value" — so cross-session resume must stay OFF for it.
const NON_RESUMABLE_UPLOAD_RX = /(^|\/\/)embed\.3speak\.tv\b/i;
function endpointSupportsResume(endpoint) {
  return !NON_RESUMABLE_UPLOAD_RX.test(endpoint || '');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// sleep(), but a tab coming back to the foreground cuts it short. Android Chrome
// suspends timers in background tabs, so a chunk that failed just before the user
// switched away would otherwise sit on a backoff that never fires: one real upload
// lost 23 minutes in a single gap that way, with zero requests reaching the server.
// Waking on visibilitychange turns that dead time back into a retry.
const sleepUntilVisible = (ms) => new Promise((resolve) => {
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    try { document.removeEventListener('visibilitychange', onVis); } catch { /* ignore */ }
    resolve();
  };
  const onVis = () => { if (document.visibilityState === 'visible') finish(); };
  const timer = setTimeout(finish, ms);
  try { document.addEventListener('visibilitychange', onVis); } catch { /* ignore */ }
});

// Browser connection hint. On a thin/flaky/metered uplink we shrink to small
// SEQUENTIAL chunks: big parallel chunks contend for bandwidth and trip tusd's
// ~60s body-read timeout (the ERR_READ_TIMEOUT / ERR_UPLOAD_INTERRUPTED cascade
// that loses uploads on bad connections).
function getConnectionProfile() {
  // Test override (badadib only): the weak profile cannot be reached on a healthy
  // line, so without this the multi-worker path could only be exercised by
  // finding a genuinely bad mobile connection. See utils/uploadFaults.
  if (isWeakLinkForced()) return { weak: true, effectiveType: 'forced', forced: true };
  const c = (typeof navigator !== 'undefined' &&
    (navigator.connection || navigator.mozConnection || navigator.webkitConnection)) || null;
  // No Network Information API (Firefox/Safari) → we can't measure the link, so
  // be conservative and treat it as weak. Parallel multi-part uploads strand at
  // 0% on slow/flaky mobile links, and we'd rather a reliable sequential upload
  // than an aggressive one that never gets a byte through.
  if (!c) return { weak: true, effectiveType: 'unknown' };
  const et = String(c.effectiveType || '');
  const dl = Number(c.downlink);        // Mbps (optimistic estimate)
  const rtt = Number(c.rtt);            // ms
  // downlink/effectiveType read optimistically on mobile (a flaky 4G still says
  // "4g"), so lean toward "weak": anything below 4g, < 3 Mbps, high latency, or
  // Data Saver on.
  const weak =
    /(slow-2g|2g|3g)/i.test(et) ||
    (Number.isFinite(dl) && dl > 0 && dl < 3) ||
    (Number.isFinite(rtt) && rtt > 400) ||
    !!c.saveData;
  return { weak, effectiveType: et, downlink: dl, rtt, saveData: !!c.saveData };
}

const EmbedUploadContext = createContext(null);

export function useEmbedUpload() {
  const ctx = useContext(EmbedUploadContext);
  if (!ctx) throw new Error('useEmbedUpload must be used within EmbedUploadProvider');
  return ctx;
}

export function EmbedUploadProvider({ children }) {
  const { user } = useAppStore();
  const navigate = useNavigate();
  // Pro subscribers skip the threespeakfund 10% — their sub fee
  // covers what that split normally funds. Remix attribution to the
  // original creator stays for both tiers (handled in the publish path).
  const premiumStatus = usePremiumStatus(user);
  const isPremium = !!premiumStatus?.premium;

  // Step tracking
  // 🔧 TEMPORARY DEV HACK — remove before this ships.
  // `?devstep=3` drops straight onto the details/description step so the form
  // can be styled without clicking through upload and thumbnail every reload.
  // Nothing is uploaded, so publishing from a jumped-to step will not work.
  const [step, setStep] = useState(() => {
    if (typeof window === 'undefined') return 1;
    const forced = parseInt(new URLSearchParams(window.location.search).get('devstep') || '', 10);
    if (Number.isInteger(forced) && forced >= 1 && forced <= 4) {
      console.warn(`[dev] jumping to wizard step ${forced} via ?devstep — remove this hack before release`);
      return forced;
    }
    return 1;
  });

  // Video file state
  const [videoFile, setVideoFile] = useState(null);
  const [prevVideoFile, setPrevVideoFile] = useState(null);
  const [videoDuration, setVideoDuration] = useState(0);
  // Which studio mode the currently-selected video was picked under: 'shorts' | 'longform' | null.
  // Used to clear a stale selection when the studio is reopened in the other mode.
  const [videoMode, setVideoMode] = useState(null);

  // Thumbnail state
  const [generatedThumbnail, setGeneratedThumbnail] = useState([]);
  const [selectedThumbnail, setSelectedThumbnail] = useState(null);
  const [thumbnailFile, setThumbnailFile] = useState(null);
  const [selectedIndex, setSelectedIndex] = useState(null);

  // Details state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tagsInputValue, setTagsInputValue] = useState('');
  const [tagsPreview, setTagsPreview] = useState([]);
  const [community, setCommunity] = useState('hive-181335');
  const [beneficiaries, setBeneficiaries] = useState([]);
  const [declineRewards, SetDeclineRewards] = useState(false);
  const [rewardPowerup, setRewardPowerup] = useState(false);
  const [isNsfw, setIsNsfw] = useState(false);
  // "Mark as channel trailer" — pinned to the creator's profile after publish.
  const [isChannelTrailer, setIsChannelTrailer] = useState(false);
  const [isScheduled, setIsScheduled] = useState(false);
  const [scheduleDateTime, setScheduleDateTime] = useState('');

  // Community data
  const [communitiesData, setCommunitiesData] = useState([]);

  // Modal state
  const [isOpen, setIsOpen] = useState(false);
  const [benficaryOpen, setBeneficiaryOpen] = useState(false);
  const [BeneficiaryList, setBeneficiaryList] = useState([]);
  // Initial UI list — show the locked threespeakfund (10%) + encoder.pay (1%)
  // splits only for non-premium users. Both are locked: the modal renders
  // them without a delete control and won't let them drop below minPercent.
  // Premium users (or remix flows) get an updated list pushed in by the
  // relevant pre-fill code paths.
  const [list, setList] = useState([
    { account: LOCKED_FUND_ACCOUNT, percent: 10, locked: true, minPercent: 10 },
    { account: LOCKED_ENCODER_ACCOUNT, percent: 1, locked: true, minPercent: 1 },
  ]);
  const [remaingPercent, setRemaingPercent] = useState(89);

  // Premium status lands asynchronously (1 network call). When it flips
  // to true we drop the locked threespeakfund row (and the encoder.pay row,
  // UNLESS this Pro holder is grandfathered into still paying it) from the
  // UI so it matches what the publish path actually broadcasts. Guarded by a
  // ref so it prunes exactly once even if the effect re-runs. Non-Pro stays.
  const prunedLockedRef = useRef(false);
  useEffect(() => {
    if (!isPremium || prunedLockedRef.current) return;
    prunedLockedRef.current = true;
    const keepEncoder = chargesEncoder({ isPremium, username: user, includeEncoder: true });
    setList((prev) => prev.filter(
      (b) => b.account !== LOCKED_FUND_ACCOUNT
        && (keepEncoder || b.account !== LOCKED_ENCODER_ACCOUNT),
    ));
    // Always reclaim the 10% fund; reclaim the 1% encoder only when dropped.
    setRemaingPercent((prev) => Math.min(100, prev + (keepEncoder ? 10 : 11)));
  }, [isPremium, user]);

  // Entry origin (stories → "Share a Short", default → "Share a Video")
  const [fromStories, setFromStories] = useState(false);
  // 🔐 Gated (paid) upload. Only offered to 3Speak Pro users, and only ever
  // honoured because the embed backend re-checks Pro status when it mints the
  // upload token — this flag is a UI intent, not an authorisation.
  const [gated, setGated] = useState(false);
  // 🔐 Named accounts that may watch a gated video without 3Speak Pro. Sent with
  // the upload token, stored server-side, and deliberately NOT written into the
  // Hive post: post metadata is public and permanent, so an on-chain list would
  // publish who the video was sent to, forever.
  const [gatedAllowlist, setGatedAllowlist] = useState([]);

  // Original video attribution (for remix/clip)
  const [originalAuthor, setOriginalAuthor] = useState(null);
  const [originalPermlink, setOriginalPermlink] = useState(null);
  const [originalShortPermlink, setOriginalShortPermlink] = useState(null);

  // Reusable flag (allow others to remix/clip this video)
  const [reusable, setReusable] = useState(true);

  // Publish state
  const [uploading, setUploading] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [statusText, setStatusText] = useState('');
  // Structured detail for the progress bar's diagnostics line. The percentage
  // alone cannot distinguish "slow" from "wedged", which is the whole problem
  // with an upload that sits at 0%: the user needs to see WHICH method is in
  // play, WHAT it is waiting on, and whether bytes are actually moving.
  //   method:  'resumable' (TUS) | 'reliable' (chunked fallback)
  //   phase:   short human label for the current step
  //   sent/total, chunksDone/chunksTotal: byte + chunk counters (may be absent)
  //   attempt/attempts: retry position, when retrying
  //   chunkBytes/workers: the settled transport shape
  //   probeBps: measured uplink, 0 when the probe could not get through
  //   link/linkDown/linkRtt/saveData: what the browser claims about the link
  //   retries/lastError/lastStatus: cumulative failures and the most recent one
  //   fileBytes/startedAt: for a screenshot to be readable without other context
  const [uploadDetail, setUploadDetail] = useState(null);
  const patchUploadDetail = useCallback((patch) => {
    setUploadDetail((prev) => ({ ...(prev || {}), ...patch }));
  }, []);
  const [statusMessages, setStatusMessages] = useState([]);
  const [embedUrl, setEmbedUrl] = useState('');
  // Hive permlink of the just-published post — used by the success screen to
  // offer promotion of the new video.
  const [publishedPermlink, setPublishedPermlink] = useState('');

  // Prefilled state — set when arriving from an external upload (e.g. Hangouts
  // server-side recording) that already pushed a video to the embed service.
  // When prefilled, the publish flow skips the TUS upload and goes straight to
  // thumbnail + Hive post + link, using the captured embed URL.
  const [prefilled, setPrefilled] = useState(false);
  const [prefilledPermlink, setPrefilledPermlink] = useState('');
  const [prefilledOwner, setPrefilledOwner] = useState('');
  const [prefilledEmbedUrl, setPrefilledEmbedUrl] = useState('');

  const setPrefilledFromQuery = ({ permlink, owner, embedUrl: url }) => {
    setPrefilled(true);
    setPrefilledPermlink(permlink || '');
    setPrefilledOwner(owner || '');
    setPrefilledEmbedUrl(url || '');
    setEmbedUrl(url || '');
  };

  const tusUploadRef = useRef(null);
  // In-flight chunked-upload XHRs (there can be several in parallel), so an
  // explicit reset can abort them — tusUploadRef only tracks the TUS upload.
  const uploadXhrsRef = useRef(new Set());
  // Once PATCH is detected blocked this session, stick to the chunked fallback
  // for every subsequent attempt instead of re-probing TUS each time.
  const sessionForcedReliableRef = useRef(false);
  // The file the user explicitly cancelled. startEarlyUpload refuses to restart
  // this exact File, so cancelling actually stops instead of being undone by the
  // details-step effect on its next run.
  const cancelledFileRef = useRef(null);

  // Early/background video upload — the TUS upload starts while the user is still
  // on the "Add details" step (instead of only at final publish), so by the time
  // they finish the video is usually already up. State drives the progress bar;
  // refs hold the captured URL + in-flight promise so publishToEmbed can reuse
  // (and await) it without stale-closure issues.
  // videoUploadStatus: 'idle' | 'uploading' | 'done' | 'error'
  const [videoUploadStatus, setVideoUploadStatus] = useState('idle');
  // The embed host chosen for the current upload (reactive copy of
  // chosenEmbedBaseRef, for display under the progress bar).
  const [selectedEndpoint, setSelectedEndpoint] = useState('');
  const earlyEmbedUrlRef = useRef('');
  // 🔐 Deferred encoding. The embed backend can hold the encode until publish so
  // the gated choice can still be made after the upload has started — which it
  // must be, because the upload begins the moment this step opens and the gated
  // toggle lives on that very screen. Absent on an instance that predates it,
  // in which case gating still has to be settled before the first byte.
  //
  // The deferral is deliberately NOT held in a ref. It used to be, and because
  // one slot was shared by all three upload paths, an attempt started while an
  // earlier one was still running would overwrite it — publish then commissioned
  // the encode against the abandoned permlink and got a 409, while the upload
  // that actually landed sat pinned at awaiting_encode and never encoded. It now
  // travels as a value, returned by each uploader with the URL it produced.
  const earlyUploadPromiseRef = useRef(null);
  // The deferral belonging to the background upload specifically, so publish can
  // still find it when the upload finished before the user pressed the button.
  const earlyDeferralRef = useRef(null);
  const earlyUploadStartedRef = useRef(false);
  const earlyUploadedFileRef = useRef(null); // which file the background upload used
  // The embed server chosen for this upload. Sticky for the whole lifecycle so
  // the post-upload /video/*/hive + /thumbnail writes hit the same host as the
  // bytes (works whether or not the servers share a MongoDB).
  const chosenEmbedBaseRef = useRef('');

  const addMessage = (msg, type = 'info') => {
    setStatusMessages(prev => [...prev, {
      time: new Date().toLocaleTimeString(),
      message: msg,
      type,
    }]);
  };

  // Clear only the selected video + its derived thumbnails (not the whole form).
  // Used when the studio is reopened in a different mode than the video was picked in.
  const clearVideoSelection = () => {
    setVideoFile(null);
    setPrevVideoFile(null);
    setVideoDuration(0);
    setGeneratedThumbnail([]);
    setSelectedThumbnail(null);
    setThumbnailFile(null);
    setSelectedIndex(null);
    setVideoMode(null);
    resetEarlyUpload();
  };

  const resetUploadState = () => {
    // Abort any in-progress TUS upload and clear cached fingerprints
    if (tusUploadRef.current) {
      try { tusUploadRef.current.abort(); } catch { }
      tusUploadRef.current = null;
    }
    // Clear TUS fingerprints from localStorage to prevent resume of old uploads
    try {
      Object.keys(localStorage).forEach(key => {
        if (key.startsWith('tus::')) localStorage.removeItem(key);
      });
    } catch { }

    setStep(1);
    setVideoFile(null);
    setPrevVideoFile(null);
    setVideoDuration(0);
    setGeneratedThumbnail([]);
    setSelectedThumbnail(null);
    setThumbnailFile(null);
    setSelectedIndex(null);
    setVideoMode(null);
    setTitle('');
    setDescription('');
    setTagsInputValue('');
    setTagsPreview([]);
    setCommunity('hive-181335');
    setBeneficiaries([]);
    setIsNsfw(false);
    setIsChannelTrailer(false);
    SetDeclineRewards(false);
    setRewardPowerup(false);
    setIsScheduled(false);
    setScheduleDateTime('');
    setFromStories(false);
    setOriginalAuthor(null);
    setOriginalPermlink(null);
    setOriginalShortPermlink(null);
    setReusable(true);
    setUploading(false);
    setCompleted(false);
    setUploadProgress(0);
    setStatusText('');
    setUploadDetail(null);
    setStatusMessages([]);
    setEmbedUrl('');
    setPublishedPermlink('');
    setBeneficiaryList([]);
    // Re-seed the LOCKED rows instead of emptying the list. Emptying left a
    // non-Pro user looking like they had no splits at all after their first
    // upload (this reset runs on re-entering the studio once one completed),
    // while the publish path went on applying them — the UI just stopped
    // saying so. Seeded from the CURRENT Pro status, so Pro still gets none.
    const lockedOnReset = getLockedBeneficiaries({
      isPremium,
      username: user,
      includeEncoder: true,
    });
    setList(lockedOnReset);
    setRemaingPercent(100 - lockedOnReset.reduce((sum, b) => sum + b.percent, 0));
    setPrefilled(false);
    setPrefilledPermlink('');
    setPrefilledOwner('');
    setPrefilledEmbedUrl('');
    resetEarlyUpload();
  };

  // Forget any background upload so a newly-selected/replaced video re-uploads.
  // This is an EXPLICIT user reset (Replace Video / pick another), so it must
  // also discard any resumable state — terminate the partial on the server and
  // clear stored TUS fingerprints — otherwise re-picking the same file would
  // silently resume when the user wanted a clean start. (A crash/reload, by
  // contrast, leaves the fingerprint in place so resume still works there.)
  const resetEarlyUpload = useCallback(() => {
    if (tusUploadRef.current) {
      // abort(true) sends a DELETE to terminate the upload + drops its fingerprint.
      try { Promise.resolve(tusUploadRef.current.abort(true)).catch(() => {}); } catch { /* ignore */ }
      tusUploadRef.current = null;
    }
    // Abort any in-flight chunked-upload requests too.
    if (uploadXhrsRef.current.size) {
      for (const xhr of uploadXhrsRef.current) { try { xhr.abort(); } catch { /* ignore */ } }
      uploadXhrsRef.current.clear();
    }
    // Belt-and-suspenders: clear any leftover resume state synchronously so the
    // next selection can't resume a stale partial (only one upload at a time).
    // `chunked::` is the fallback's equivalent of a TUS fingerprint — it was
    // missing here, so replacing a video silently resumed the old chunk session
    // against the new selection instead of starting clean.
    try {
      Object.keys(localStorage).forEach((key) => {
        if (key.startsWith('tus::') || key.startsWith('chunked::')) localStorage.removeItem(key);
      });
    } catch { /* ignore */ }
    earlyEmbedUrlRef.current = '';
    earlyUploadPromiseRef.current = null;
    earlyDeferralRef.current = null;
    earlyUploadStartedRef.current = false;
    earlyUploadedFileRef.current = null;
    chosenEmbedBaseRef.current = '';
    setSelectedEndpoint('');
    setVideoUploadStatus('idle');
  }, []);

  // The user's way out of a background upload that is going nowhere. Until this
  // existed the progress bar was display-only: an upload that could not move a
  // byte retried silently and forever, with nothing on screen to stop it.
  //
  // Everything resetEarlyUpload does, plus clearing the readout and remembering
  // WHICH file was cancelled, so the details-step effect does not simply start it
  // again on its next run. Pressing publish still re-runs the upload inline, so
  // cancelling stops the background attempt without stranding the video.
  const cancelEarlyUpload = useCallback(() => {
    cancelledFileRef.current = videoFile || null;
    sessionForcedReliableRef.current = false;
    resetEarlyUpload();
    setUploadProgress(0);
    setStatusText('');
    setUploadDetail(null);
    toast.message('Upload cancelled.');
  }, [videoFile, resetEarlyUpload]);

  // The raw TUS upload of `videoFile` to the embed service. Shared by the
  // background (early) upload and the publish fallback. `uploadEndpoint` is the
  // chosen server's /uploads URL (defaults to the single configured host).
  // Returns the embed URL.
  /**
   * Record whether this upload's encode was deferred.
   *
   * A backend that supports it echoes `defer_encode: true` and hands back a
   * finalize token; one that does not simply omits both, and the gated decision
   * stays frozen at whatever the token was minted with. Publishing checks this,
   * so the difference surfaces as a refusal rather than as a supporters-only
   * video quietly going out in the clear.
   */
  const captureDeferral = useCallback((data) => {
    const deferred = data?.defer_encode === true && !!data?.finalize_token;
    return {
      finalizeToken: deferred ? data.finalize_token : null,
      permlink: deferred ? (data.permlink || '') : '',
      gated: data?.gated === true,
    };
  }, []);

  const runTusUpload = useCallback(async (generatedPermlink, uploadEndpoint = EMBED_UPLOAD_URL) => {
    // Clear stale TUS fingerprints — embed.3speak.tv can't resume, so a leftover
    // fingerprint causes "invalid or missing length value" errors.
    try {
      Object.keys(localStorage).forEach((key) => {
        if (key.startsWith('tus::') && key.includes('embed.3speak.tv')) {
          localStorage.removeItem(key);
        }
      });
    } catch { /* ignore */ }

    // Mint an upload token so this upload can defer its encode.
    //
    // The API-key path cannot defer: deferring is a signed claim, because the
    // embed API key ships inside this bundle and an API-key caller must not be
    // able to park uploads with no encode. Without a token here, TUS — the
    // default path for almost every upload — would queue the encode as soon as
    // the bytes land, and the gated toggle on the details step would already be
    // too late.
    //
    // Minted against the host that will receive the upload, not the configured
    // API base: the two can be different deployments with different signing
    // keys. A failure here is not fatal, it just means no deferral, and publish
    // refuses rather than guessing if gating was wanted.
    const tokenBase = uploadEndpoint.replace(/\/uploads\/?$/, '').replace(/\/+$/, '');
    let tusToken = null;
    let tokenEmbedUrl = '';
    // Assigned on both the success and the mint-failure path below.
    let deferral;
    try {
      const tokenRes = await axios.post(
        `${tokenBase}/uploads/token`,
        {
          owner: user,
          frontend_app: '3speak-tv',
          short: !!fromStories,
          gated: !!gated,
          defer_encode: true,
          ...(gated && gatedAllowlist.length ? { allowlist: gatedAllowlist } : {}),
        },
        { headers: { 'X-API-Key': EMBED_API_KEY, 'Content-Type': 'application/json' } },
      );
      deferral = captureDeferral(tokenRes.data);
      tusToken = tokenRes.data?.token || null;
      tokenEmbedUrl = tokenRes.data?.embed_url || '';
    } catch (tokenErr) {
      console.warn('Upload token mint failed — falling back to API-key upload (no deferral)', tokenErr);
      deferral = captureDeferral(null);
    }

    const MB = 1024 * 1024;
    const sizeBytes = videoFile.size || 0;
    const conn = getConnectionProfile();
    // chunkSize is a RETRY UNIT, not a throughput knob. tus re-sends the whole
    // chunk from the server's offset on every retry, so the unit is what a flaky
    // link has to carry in one unbroken request — and the LAST chunk is the one
    // that decides whether the upload finishes at all. A 636MB upload sized from
    // navigator.connection ("4g dl10") took 16MB chunks, reached 97.8%, then spent
    // ten minutes re-sending the same final 14MB chunk and never landed it.
    //
    // So do NOT size this from navigator.connection. That API reports
    // optimistically on mobile — a dying carrier link still answers "4g", and the
    // same phone reported dl0.05 and dl10 on two attempts minutes apart. This is
    // the same trap the chunked tier was taken off in 1.78.51; the weak hint now
    // only decides whether we open a second stream, never how big a bite we take.
    // 4MB is the largest unit that still re-sends cheaply on a bad link, and it
    // is bounded by the uplink, not by us: throughput comes from the pipe.
    const chunkSize = 4 * MB;
    // Parallel multi-part uploads split the uplink N ways and each part is a
    // separate upload that can strand — great on a fat pipe, fragile otherwise.
    // Cap at 2 and only where there is real work to split.
    const parallelUploads = (!conn.weak && sizeBytes > 50 * MB) ? 2 : 1;
    patchUploadDetail({ chunkBytes: chunkSize, workers: parallelUploads });

    // Cross-session resume only on tusd-backed hosts (see endpointSupportsResume).
    const resumable = endpointSupportsResume(uploadEndpoint);

    let capturedEmbedUrl = tokenEmbedUrl;
    let resolveDone, rejectDone;
    const done = new Promise((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });

    // PATCH-blocked detector. The failure signature we're catching is: create
    // (POST) + HEAD succeed, but not a single PATCH is acknowledged — the server
    // offset never advances (some carriers/WebViews drop the PATCH method or its
    // application/offset+octet-stream body). If no chunk is server-acked within
    // WATCHDOG_MS, we abort and let the caller fall back to the chunked path.
    // A false positive is cheap: the chunked fallback is also resumable.
    const WATCHDOG_MS = 15000;
    let firstAck = false;
    // Server-confirmed offset per PARTIAL upload, keyed by that partial's own URL.
    // tus fires onChunkComplete on each partial with no way to tell them apart, so
    // summing there is impossible and the old code just showed whichever partial
    // reported last AS IF it were the whole upload: a 636MB upload that genuinely
    // had 652,084,181 bytes on the server displayed "304 MB confirmed" — the exact
    // number that makes a healthy upload look like it lost half its data. The
    // request URL is the identity the callback lacks.
    const ackedByPart = new Map();
    const totalAcked = () => {
      let sum = 0;
      for (const v of ackedByPart.values()) sum += v;
      return Math.min(sum, videoFile.size || sum);
    };
    let watchdog = setTimeout(() => {
      if (!firstAck) {
        try { upload.abort(); } catch { /* ignore */ }
        rejectDone(Object.assign(new Error('PATCH appears blocked (no chunk acknowledged)'), { code: 'PATCH_BLOCKED' }));
      }
    }, WATCHDOG_MS);
    const clearWatchdog = () => { if (watchdog) { clearTimeout(watchdog); watchdog = null; } };

    const upload = new tus.Upload(videoFile, {
      endpoint: uploadEndpoint,
      chunkSize,
      parallelUploads,
      // ~2 min of backoff so transient drops recover instead of hard-failing.
      // Each retry HEADs the upload and continues from the server's offset.
      retryDelays: [0, 3000, 5000, 10000, 20000, 30000, 60000],
      storeFingerprintForResuming: resumable,
      removeFingerprintOnSuccess: true,
      // Retry network drops + the transient 5xx tusd returns for stalled/
      // interrupted bodies (ERR_READ_TIMEOUT / EOF / lock); never retry auth/4xx.
      onShouldRetry: (err) => {
        const status = err?.originalResponse?.getStatus?.() ?? 0;
        const willRetry = status === 0 || status === 409 || status === 423 ||
          status === 429 || status >= 500;
        if (willRetry) setStatusText('Connection unstable — retrying…');
        return willRetry;
      },
      headers: tusToken
        // Never both: the server checks X-API-Key first and would ignore the
        // token, losing the deferral along with it.
        ? { Authorization: `Bearer ${tusToken}` }
        : { ...(EMBED_API_KEY ? { 'X-API-Key': EMBED_API_KEY } : {}) },
      metadata: {
        filename: videoFile.name,
        filetype: videoFile.type,
        frontend_app: '3speak-tv',
        owner: user,
        short: fromStories ? 'true' : 'false',
        duration: String(Math.round(videoDuration)),
        ...(generatedPermlink ? { permlink: generatedPermlink } : {}),
      },
      onError: (err) => {
        clearWatchdog();
        console.error('TUS upload error:', err);
        rejectDone(err);
      },
      // Fires when the server ACKNOWLEDGES received bytes (bytesAccepted) — the
      // reliable "a PATCH actually landed" signal. onProgress alone isn't enough:
      // it reflects bytes the browser pushed into the socket, which a proxy can
      // accept and then black-hole. First ack ⇒ PATCH works ⇒ disarm the watchdog.
      onChunkComplete: (_partChunkSize, bytesAccepted) => {
        if (bytesAccepted > 0 && !firstAck) { firstAck = true; clearWatchdog(); }
        // Server-confirmed bytes, summed across partials (see ackedByPart).
        // Distinct from onProgress below, which is only "pushed into the socket" —
        // the gap between the two is exactly what a black-holing proxy looks like,
        // so show both.
        patchUploadDetail({ acked: totalAcked(), phase: 'Uploading' });
      },
      onProgress: (bytesUploaded, bytesTotal) => {
        const pct = Math.round((bytesUploaded / bytesTotal) * 100);
        setUploadProgress(pct);
        setStatusText(`Uploading video... ${pct}%`);
        patchUploadDetail({
          method: 'resumable',
          phase: firstAck ? 'Uploading' : 'Waiting for first server ack…',
          // Keep the spinner up through the pre-ack window even though bytes are
          // leaving: that gap is exactly where a PATCH-eating proxy hides, so
          // "sending, nothing acknowledged" must not look like healthy progress.
          waitingOn: firstAck ? undefined : 'first server ack — 15s watchdog',
          sent: bytesUploaded,
          total: bytesTotal,
        });
      },
      onSuccess: () => { clearWatchdog(); resolveDone(); },
      onAfterResponse: (req, res) => {
        const header = res.getHeader('X-Embed-URL') || res.getHeader('x-embed-url');
        if (header) capturedEmbedUrl = header;
        try {
          // HEAD as well as PATCH: on a resume the partials already hold bytes we
          // never sent this session, and tus HEADs each one to find its offset.
          // Without it a resumed 652MB upload would read "0 confirmed" until the
          // first chunk of the session landed. The final concatenated upload can
          // get a HEAD too, but its offset is the full size and totalAcked()
          // clamps to the file, so it can only ever read correct-and-complete.
          const m = req.getMethod();
          if (m === 'PATCH' || m === 'HEAD') {
            const off = parseInt(res.getHeader('Upload-Offset') || '', 10);
            if (Number.isFinite(off)) {
              ackedByPart.set(req.getURL(), off);
              patchUploadDetail({ acked: totalAcked() });
            }
          }
        } catch { /* header shapes vary by stack — never break the upload for a counter */ }
      },
    });
    tusUploadRef.current = upload;
    // Resume an interrupted upload from a previous session if one exists for this
    // file on a resumable host — picks up where the dropped connection left off
    // instead of restarting at 0%.
    if (resumable) {
      try {
        const prev = await upload.findPreviousUploads();
        if (prev && prev.length) upload.resumeFromPreviousUpload(prev[0]);
      } catch { /* no resumable upload — start fresh */ }
    }
    upload.start();
    await done;
    return { embedUrl: capturedEmbedUrl, deferral };
  }, [videoFile, user, fromStories, videoDuration, gated, gatedAllowlist, captureDeferral]);

  // Preflight-free multipart POST helper for the chunked protocol. No custom
  // request headers (FormData sets multipart/form-data itself) so the browser
  // skips the CORS preflight — the whole point of the fallback. Tracks the XHR
  // so an explicit reset can abort it; resolves the parsed JSON body, rejects
  // with an Error carrying { status, body } on non-2xx.
  //
  // Three things here are what make the fallback survivable, and all three were
  // missing — which is why a fallback upload could sit at 0% forever:
  //
  //  - onProgress: without xhr.upload.onprogress the caller can only move the bar
  //    when a WHOLE chunk lands. On the slow links this fallback exists for, that
  //    is minutes of a frozen bar, and if the first chunk never lands the bar
  //    never moves at all.
  //
  //  - stallMs: a NO-BYTES-MOVED watchdog. The exact failure this fallback is for
  //    is a network that accepts the request and then black-holes it — no error,
  //    no response, forever. An XHR in that state never fires load/error/timeout,
  //    so the promise never settles and the retry loop below never runs. We watch
  //    the upload's own progress events and abort if nothing moves. Crucially this
  //    is byte-based, NOT wall-clock: a slow-but-moving upload keeps ticking and is
  //    never killed.
  //
  //  - timeoutMs: a hard backstop kept just UNDER nginx's client_body_timeout
  //    (300s) so a too-slow chunk fails as OUR retryable timeout instead of coming
  //    back as an opaque 408 after the fact (24 of those yesterday, ~all Android).
  const postForm = useCallback((url, fields, files, opts = {}) => {
    return new Promise((resolve, reject) => {
      const form = new FormData();
      Object.entries(fields || {}).forEach(([k, v]) => form.append(k, v));
      // File/blob parts LAST so the server reads the metadata fields first.
      Object.entries(files || {}).forEach(([k, v]) => form.append(k, v, (v && v.name) || k));

      const xhr = new XMLHttpRequest();
      uploadXhrsRef.current.add(xhr);

      // Distinguishes OUR abort (retryable) from the user hitting reset (fatal).
      let selfAborted = null;
      let lastByteAt = Date.now();
      let stallTimer = null;
      let deadlineTimer = null;
      const done = () => {
        if (stallTimer) { clearInterval(stallTimer); stallTimer = null; }
        if (deadlineTimer) { clearTimeout(deadlineTimer); deadlineTimer = null; }
        uploadXhrsRef.current.delete(xhr);
      };

      if (xhr.upload) {
        xhr.upload.onprogress = (e) => {
          lastByteAt = Date.now();
          if (opts.onProgress && e.lengthComputable) opts.onProgress(e.loaded, e.total);
        };
      }
      if (opts.stallMs) {
        stallTimer = setInterval(() => {
          if (Date.now() - lastByteAt > opts.stallMs) {
            selfAborted = 'STALLED';
            try { xhr.abort(); } catch { /* already gone */ }
            // Settle directly, same reasoning as the deadline below: a swallowed
            // request may never dispatch ANY event, so the watchdog cannot depend
            // on abort() producing one.
            done();
            reject(Object.assign(new Error('Upload stalled — no data moved'), { code: 'STALLED', retryable: true }));
          }
        }, 2000);
      }

      xhr.open('POST', url);
      if (opts.timeoutMs) {
        xhr.timeout = opts.timeoutMs;
        xhr.ontimeout = () => {
          done();
          reject(Object.assign(new Error('Request timed out'), { code: 'TIMEOUT', retryable: true }));
        };
        // `xhr.timeout` only starts counting once send() actually dispatches the
        // request. A middlebox that swallows the request whole never lets it get
        // that far, so ontimeout never fires and the promise hangs forever — the
        // "stuck at 0%, upload never starts" report. Own the deadline ourselves so
        // it holds even when the request never leaves. Slightly later than
        // xhr.timeout so the native event wins when the request DID go out.
        //
        // Settle the promise HERE rather than relying on abort() to fire onabort:
        // when the request never really left, there is no guarantee any event is
        // dispatched at all, and a deadline that depends on the very machinery it
        // is guarding against is not a deadline. reject() after settle is a no-op,
        // so the native onabort path staying is harmless.
        deadlineTimer = setTimeout(() => {
          selfAborted = 'TIMEOUT';
          try { xhr.abort(); } catch { /* already gone */ }
          done();
          reject(Object.assign(new Error('Request timed out'), { code: 'TIMEOUT', retryable: true }));
        }, opts.timeoutMs + 1000);
      }
      xhr.onload = () => {
        done();
        let body = {};
        try { body = JSON.parse(xhr.responseText); } catch { /* non-JSON */ }
        if (xhr.status >= 200 && xhr.status < 300) resolve(body);
        else reject(Object.assign(new Error(body.error || `HTTP ${xhr.status}`), { status: xhr.status, body }));
      };
      xhr.onerror = () => {
        done();
        reject(Object.assign(new Error('Network error'), { code: 'NETWORK', retryable: true }));
      };
      xhr.onabort = () => {
        done();
        if (selfAborted) {
          const msg = selfAborted === 'TIMEOUT'
            ? 'Request timed out'
            : 'Upload stalled — no data moved';
          reject(Object.assign(new Error(msg), { code: selfAborted, retryable: true }));
        } else {
          reject(Object.assign(new Error('Aborted'), { code: 'ABORTED' }));
        }
      };
      xhr.send(form);
    });
  }, []);

  // Resumable, parallel, PATCH-free chunked upload — the fallback for clients
  // where the TUS PATCH flow is blocked. Mints a single-use token, opens a
  // chunk session, then uploads index-addressed chunks over plain multipart
  // POSTs (any order, up to `parallel` at a time). Survives drops: on retry /
  // reload it re-queries /status and re-sends only the missing chunks. Returns
  // the embed URL.
  //
  // Pinned to EMBED_API_URL (not pickEmbedEndpoint). This is no longer because the
  // other hosts lack /upload/chunk — as of 2026-07-14 every pool host exposes it —
  // but because a chunk SESSION is host-bound: the server keeps it in memory and
  // writes into one temp file, so a mid-upload host switch would lose the session.
  // The host is therefore chosen once, up front, and kept.
  const runChunkedUpload = useCallback(async () => {
    const base = (EMBED_API_URL || '').replace(/\/+$/, '');
    if (!base) throw new Error('No embed host configured');
    const file = videoFile;
    const size = file.size || 0;
    if (!size) throw new Error('Empty file');

    const MB = 1024 * 1024;

    // Bounds on what the probe may conclude. The floor is the server's
    // CHUNK_MIN_SIZE; the ceiling keeps a fast link from picking a chunk so large
    // that losing one costs minutes of re-send.
    const CHUNK_FLOOR = 256 * 1024;
    const CHUNK_CEIL = size > 500 * MB ? 4 * MB : size > 50 * MB ? 2 * MB : 1 * MB;
    // How long one chunk should take on the measured link. Well inside HARD_MS
    // (280s, itself just under nginx's client_body_timeout), so a chunk that runs
    // slower than the probe suggested still lands instead of timing out.
    const CHUNK_TARGET_SECONDS = 45;
    const PROBE_BYTES = 256 * 1024;

    // Measure, don't guess.
    //
    // This used to read navigator.connection and pick a size from it. That API
    // reports optimistically on mobile (a dying carrier link still answers "4g"),
    // and chunkSize is frozen for the life of the session, because the server
    // pre-sizes the file and demands every chunk be exactly that many bytes. So a
    // guess that came out too high could never be walked back: the upload just sat
    // at 0% re-sending a body the link had never once delivered.
    //
    // Pushing the smallest body this path would ever send and timing it answers
    // the only question that matters. A probe that cannot get through is itself
    // the answer: take the floor.
    //
    // Worker count is NOT decided here. It is derived from the settled chunkSize
    // further down, so the two cannot come from different passes.
    const measureChunkSize = async () => {
      setStatusText('Checking your connection...');
      patchUploadDetail({
        method: 'reliable',
        phase: 'Measuring connection',
        waitingOn: 'POST /upload/probe',
        sent: 0,
        total: size,
      });
      const blob = file.slice(0, Math.min(PROBE_BYTES, size));
      const startedAt = Date.now();
      try {
        await postForm(`${base}/upload/probe`, {}, { chunk: blob }, { stallMs: 30000, timeoutMs: 90000 });
      } catch (e) {
        if (e?.code === 'ABORTED') throw e;
        patchUploadDetail({ probeBps: 0, lastError: e?.code || 'PROBE_FAIL', lastStatus: e?.status || 0 });
        return CHUNK_FLOOR;
      }
      const seconds = Math.max(0.05, (Date.now() - startedAt) / 1000);
      patchUploadDetail({ probeBps: blob.size / seconds });
      const target = (blob.size / seconds) * CHUNK_TARGET_SECONDS;
      // Whole multiples of the floor, so the sizes stay legible in server logs.
      const stepped = Math.floor(target / CHUNK_FLOOR) * CHUNK_FLOOR;
      return Math.max(CHUNK_FLOOR, Math.min(CHUNK_CEIL, stepped));
    };

    // Settled per session: measured below for a fresh one, or taken from the
    // server on resume.
    let chunkSize = 0;

    const fpKey = `chunked::${base}::${file.name}::${size}`;
    let sessionId = null;
    let totalChunks = 0;
    let received = new Set();
    let embedFromServer = '';
    let deferral = null;

    // Resume a live session for this exact file (survives a reload / retry).
    let stored = null;
    try { stored = localStorage.getItem(fpKey); } catch { /* ignore */ }
    // Sessions written by builds before the deferral was persisted are a bare
    // sessionId string; anything newer is {sessionId, deferral}.
    let storedId = null;
    let storedDeferral = null;
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        storedId = parsed?.sessionId || null;
        storedDeferral = parsed?.deferral || null;
      } catch { storedId = stored; }
    }
    if (storedId) {
      try {
        const st = await postForm(`${base}/upload/chunk/status`, { sessionId: storedId }, null, { timeoutMs: 15000 });
        if (st && Number.isFinite(st.totalChunks)) {
          sessionId = storedId;
          totalChunks = st.totalChunks;
          chunkSize = st.chunkSize || CHUNK_FLOOR;
          received = new Set(st.received || []);
          // A resumed session mints no token, so the deferral has to come back
          // out of storage — otherwise publish would reach for whatever the last
          // unrelated mint happened to leave in the refs. If it is missing, the
          // server still parked this upload and we can no longer commission it:
          // mark it so publish refuses instead of posting to Hive regardless.
          deferral = storedDeferral || { finalizeToken: null, permlink: '', gated: false, lost: true };
        }
      } catch { /* expired/unknown — create a fresh session below */ }
    }

    if (!sessionId) {
      chunkSize = await measureChunkSize();
      const tokenRes = await axios.post(
        `${base}/uploads/token`,
        { owner: user, frontend_app: '3speak-tv', short: !!fromStories, gated: !!gated, defer_encode: true, ...(gated && gatedAllowlist.length ? { allowlist: gatedAllowlist } : {}) },
        { headers: { 'X-API-Key': EMBED_API_KEY, 'Content-Type': 'application/json' } }
      );
      const token = tokenRes.data?.token;
      embedFromServer = tokenRes.data?.embed_url || '';
      if (!token) throw new Error('Failed to obtain upload token');
      // 🔐 Refuse to continue if we asked for a gated upload and the embed
      // instance did not confirm it. An older instance returns a perfectly valid
      // token with the flag silently dropped, and uploading against it would
      // publish a supporters-only video in the clear. IPFS content cannot be
      // withdrawn, so failing loudly here is the only safe response.
      deferral = captureDeferral(tokenRes.data);
      if (gated && tokenRes.data?.gated !== true) {
        throw new Error(
          'This upload server does not support supporters-only videos yet. ' +
          'Nothing was uploaded. Turn the toggle off to publish publicly, or try again later.'
        );
      }


      // The control-plane calls (create/status/finish) carry no payload worth
      // speaking of, so the byte-based stall watchdog cannot guard them — nothing
      // ever "moves" for it to notice. They get a hard deadline instead, and
      // create is retried: a middlebox that swallows chunk POSTs swallows THIS
      // one too, and an unguarded create is precisely the failure where the bar
      // sits at 0% and the upload never starts at all.
      // Short deadline on purpose: create carries a handful of form fields, so if
      // it has not answered in 15s the path is dead, not slow. A long timeout here
      // buys nothing and just leaves the bar sitting at 0% with no explanation.
      const CREATE_TIMEOUT_MS = 15000;
      const CREATE_ATTEMPTS = 3;
      let created = null;
      let createErr = null;
      for (let attempt = 0; attempt < CREATE_ATTEMPTS && !created; attempt++) {
        // Say something BEFORE the first attempt too. Otherwise the whole first
        // deadline elapses with the bar frozen at 0% and no status change, which
        // reads exactly like the hang this guard was added to prevent.
        setStatusText(attempt === 0
          ? 'Starting upload…'
          : `Connection unstable — retrying… (${attempt + 1}/${CREATE_ATTEMPTS})`);
        patchUploadDetail({
          method: 'reliable',
          phase: attempt === 0 ? 'Opening upload session' : 'Retrying upload session',
          waitingOn: `POST /upload/chunk/create — ${CREATE_TIMEOUT_MS / 1000}s deadline`,
          attempt: attempt + 1,
          attempts: CREATE_ATTEMPTS,
          sent: 0,
          total: size,
        });
        if (attempt > 0) {
          await sleep(2000 * attempt);
        }
        try {
          created = await postForm(
            `${base}/upload/chunk/create`,
            {
              token,
              filename: file.name,
              duration: String(Math.round(videoDuration)),
              size: String(size),
              chunkSize: String(chunkSize),
              // The server clamps an UNprobed size down to its floor, because
              // that client is guessing. This one measured.
              probed: '1',
            },
            null,
            { timeoutMs: CREATE_TIMEOUT_MS },
          );
        } catch (e) {
          if (e?.code === 'ABORTED') throw e;   // user hit reset — stop
          createErr = e;
        }
      }
      if (!created) {
        throw createErr || new Error('Could not start the upload — please retry');
      }
      sessionId = created.sessionId;
      totalChunks = created.totalChunks;
      chunkSize = created.chunkSize;
      embedFromServer = created.embed_url || embedFromServer;
      received = new Set(created.received || []);
      try { localStorage.setItem(fpKey, JSON.stringify({ sessionId, deferral })); } catch { /* ignore */ }
    }

    // Bound BYTES in flight, not streams. `parallel` used to be computed up front
    // from a fresh connection reading while chunkSize came back from the server on
    // resume: two different passes, free to disagree. That is how a session ended
    // up pushing five 1MB chunks at a link that had never delivered one. Deriving
    // the worker count from the size it will actually send means they cannot.
    // 5 is the practical ceiling: embed2 speaks HTTP/1.1 and browsers allow 6
    // connections per origin, so the 6th stays free for status/finish. Raising it
    // would mean HTTP/2, which is a REGRESSION here: h2 multiplexes every stream
    // over ONE TCP connection, so a single lost packet head-of-line blocks all of
    // them. Independent TCP connections are what give the stall isolation.
    const MAX_INFLIGHT_BYTES = 1.25 * MB;
    const parallel = Math.max(1, Math.min(5, Math.floor(MAX_INFLIGHT_BYTES / chunkSize)));
    patchUploadDetail({ chunkBytes: chunkSize, workers: 1 });

    // Ramp, don't fan out. Worker count is derived from chunkSize, and the FLOOR
    // chunk size is chosen precisely BECAUSE the probe could not get through — so
    // the worst links were the ones handed the most concurrent streams. Measured
    // across every user on this path: floor-size sessions (5 workers) delivered
    // ZERO bytes 15 times in 28, while every 1-worker session moved data. Five
    // flows do not multiply a saturated uplink, they just make each request five
    // times longer and five times likelier to hit STALL_MS.
    //
    // So prove the transport can carry one chunk before opening the rest. A
    // healthy link ramps in seconds; a link that never lands its first chunk now
    // fails having tied up one stream instead of five. The gate must also open on
    // the way out, or workers parked on it would hang Promise.all forever.
    let ramped = false;
    let openRamp;
    const rampGate = new Promise((r) => { openRamp = r; });
    const releaseRamp = () => {
      if (ramped) return;
      ramped = true;
      openRamp();
    };

    // Progress = bytes the SERVER has confirmed + bytes currently in flight. The
    // in-flight half is what keeps the bar alive: without it the bar can only step
    // once per completed chunk, which on a slow link means it looks frozen for
    // minutes — and looks broken forever if the first chunk keeps failing.
    let serverBytes = received.size * chunkSize;
    const inflight = new Map();   // chunk index -> bytes uploaded so far
    const paint = () => {
      const live = serverBytes + [...inflight.values()].reduce((a, b) => a + b, 0);
      const pct = size ? Math.min(99, Math.floor((live / size) * 100)) : 0;
      setUploadProgress(pct);
      setStatusText(`Uploading video... ${pct}%`);
      patchUploadDetail({
        method: 'reliable',
        phase: 'Uploading',
        waitingOn: undefined,   // session is open; we are moving, not waiting
        attempt: undefined,
        attempts: undefined,
        sent: live,
        acked: serverBytes,
        total: size,
        chunksDone: received.size,
        chunksTotal: totalChunks,
      });
    };
    paint();

    // Work queue = the indices the server doesn't have yet.
    const queue = [];
    for (let i = 0; i < totalChunks; i++) if (!received.has(i)) queue.push(i);

    // Retry a chunk for as long as it takes. There is no attempt ceiling: giving
    // up threw away an upload that was often 90%+ done, and a resend is free
    // because the server no-ops an index it already holds. Backoff plateaus at
    // 30s rather than climbing to 60s — the old ladder spent minutes asleep on
    // links that had already come back.
    // CHUNK_BUDGET_MS is a backstop against a genuinely dead link, not a target:
    // at a 30s plateau it allows ~60 attempts on one chunk before giving up.
    const RETRY_DELAYS = [0, 2000, 5000, 10000, 20000, 30000];
    const CHUNK_BUDGET_MS = 30 * 60 * 1000;
    const STALL_MS = 45000;    // no bytes moved at all -> abort this attempt, retry
    const HARD_MS = 280000;    // just under nginx client_body_timeout (300s)
    let failed = null;
    let retries = 0;

    const worker = async (slot) => {
      // Everyone but the pathfinder waits for the first server-acked chunk.
      if (slot > 0) await rampGate;
      while (queue.length && !failed) {
        const index = queue.shift();
        const start = index * chunkSize;
        const blob = file.slice(start, Math.min(start + chunkSize, size));
        let ok = false;
        let lastErr;

        const chunkStartedAt = Date.now();
        for (let attempt = 0; !ok && !failed; attempt++) {
          if (attempt > 0 && Date.now() - chunkStartedAt > CHUNK_BUDGET_MS) break;
          if (attempt > 0) {
            setStatusText('Connection unstable — retrying…');
            // Clamp: the loop now runs past the end of the ladder, and an
            // undefined delay would make setTimeout fire immediately and spin.
            await sleepUntilVisible(RETRY_DELAYS[Math.min(attempt, RETRY_DELAYS.length - 1)]);
            if (failed) break;
          }
          try {
            const r = await postForm(
              `${base}/upload/chunk`,
              { sessionId, index: String(index) },
              { chunk: blob },
              {
                stallMs: STALL_MS,
                timeoutMs: HARD_MS,
                onProgress: (loaded) => { inflight.set(index, loaded); paint(); },
              },
            );
            ok = true;
            // A chunk landed: the transport works, so open the other streams.
            if (!ramped) { patchUploadDetail({ workers: parallel }); releaseRamp(); }
            inflight.delete(index);
            if (Number.isFinite(r.receivedBytes)) serverBytes = r.receivedBytes;
            paint();
          } catch (e) {
            inflight.delete(index);
            retries += 1;
            patchUploadDetail({ retries, lastError: e?.code || 'ERR', lastStatus: e?.status || 0 });
            paint();
            if (e?.code === 'ABORTED') { failed = e; return; }   // user reset — stop

            // The session is gone (host restarted, or idle past CHUNK_SESSION_TTL).
            // Retrying this chunk can only 404 forever, so surface it and let the
            // caller start a fresh session rather than spinning.
            if (e?.status === 404) {
              try { localStorage.removeItem(fpKey); } catch { /* ignore */ }
              failed = Object.assign(new Error('Upload session expired — please retry'), { code: 'SESSION_GONE' });
              return;
            }
            lastErr = e;
          }
        }

        if (!ok) {
          // Last word goes to the server: the chunk may actually have landed and
          // only the ACK was lost (a stalled/aborted POST looks identical to us).
          // Re-syncing also picks up chunks a sibling worker completed.
          try {
            const st = await postForm(`${base}/upload/chunk/status`, { sessionId }, null, { timeoutMs: 30000 });
            if (st && Array.isArray(st.received)) {
              if (Number.isFinite(st.receivedBytes)) { serverBytes = st.receivedBytes; paint(); }
              if (st.received.includes(index)) {
                ok = true;   // it did land — move on
                // Landed-but-unacked still proves the transport carries a chunk,
                // so this must open the ramp too. Otherwise a link whose ACKs keep
                // getting lost would run on one worker for the whole upload.
                if (!ramped) { patchUploadDetail({ workers: parallel }); releaseRamp(); }
              }
            }
          } catch { /* status unreachable — fall through to the failure below */ }
        }
        if (!ok) { failed = lastErr || new Error(`Chunk ${index} failed`); return; }
      }
    };

    const workers = Math.max(1, Math.min(parallel, queue.length || 1));
    await Promise.all(Array.from({ length: workers }, (_, slot) => (
      // The pathfinder opens the gate on its way out HOWEVER it exits, so a first
      // chunk that never lands can never strand the ramped workers on Promise.all.
      slot === 0 ? worker(0).finally(releaseRamp) : worker(slot)
    )));
    if (failed) throw failed;

    const fin = await postForm(`${base}/upload/chunk/finish`, { sessionId }, null, { timeoutMs: 60000 });
    try { localStorage.removeItem(fpKey); } catch { /* ignore */ }
    // finish reports the permlink that actually received the bytes — the only
    // authority on the subject. A finalize token is bound to one permlink server
    // side, so if the two disagree the token belongs to some other upload and
    // sending it would 403; treat that as a lost deferral rather than
    // commissioning the wrong video.
    const finPermlink = fin?.permlink || '';
    if (deferral?.finalizeToken && finPermlink && deferral.permlink !== finPermlink) {
      console.warn(`Chunked finish landed on ${finPermlink} but the deferral holds ${deferral.permlink} — discarding mismatched finalize token`);
      deferral = { finalizeToken: null, permlink: finPermlink, gated: deferral.gated, lost: true };
    }
    return { embedUrl: fin.embed_url || embedFromServer || '', deferral };
  }, [user, fromStories, gated, gatedAllowlist, videoFile, videoDuration, postForm]);

  // TIER 3, last resort: ONE multipart POST carrying the whole file.
  //
  // Why it can help when the other two are dead: it is the smallest possible
  // request shape. No PATCH (tier 1's weak spot), no session handshake and no
  // repeated same-shaped POSTs (tier 2's), just a single ordinary form upload of
  // the kind every proxy on earth already passes. A middlebox that mangles the
  // chunk protocol often waves this straight through.
  //
  // The trade is real and it is why this is LAST, not first: there is no resume.
  // One drop and the whole file starts over, so on a genuinely bad link this can
  // burn a lot of bandwidth for nothing. Guarded by stallMs (byte-based) and
  // deliberately NOT by a hard timeout — a slow-but-moving upload must never be
  // killed for being slow, which is the whole point of offering it.
  const runSimpleUpload = useCallback(async () => {
    const base = (EMBED_API_URL || '').replace(/\/+$/, '');
    const file = videoFile;
    if (!file) throw new Error('No video selected');
    const size = file.size;

    setStatusText('Trying one last method — sending in a single request…');
    patchUploadDetail({
      method: 'single-shot',
      phase: 'Sending whole file in one request (no resume)',
      waitingOn: 'POST /upload/simple',
      attempt: undefined,
      attempts: undefined,
      chunksDone: undefined,
      chunksTotal: undefined,
      acked: undefined,
      sent: 0,
      total: size,
    });

    const tokenRes = await axios.post(
      `${base}/uploads/token`,
      { owner: user, frontend_app: '3speak-tv', short: !!fromStories, gated: !!gated, defer_encode: true, ...(gated && gatedAllowlist.length ? { allowlist: gatedAllowlist } : {}) },
      { headers: { 'X-API-Key': EMBED_API_KEY, 'Content-Type': 'application/json' } },
    );
    const token = tokenRes.data?.token;
    if (!token) throw new Error('Failed to obtain upload token');
    // 🔐 Refuse to continue if we asked for a gated upload and the embed
    // instance did not confirm it. An older instance returns a perfectly valid
    // token with the flag silently dropped, and uploading against it would
    // publish a supporters-only video in the clear. IPFS content cannot be
    // withdrawn, so failing loudly here is the only safe response.
    const deferral = captureDeferral(tokenRes.data);
    if (gated && tokenRes.data?.gated !== true) {
      throw new Error(
        'This upload server does not support supporters-only videos yet. ' +
        'Nothing was uploaded. Turn the toggle off to publish publicly, or try again later.'
      );
    }


    const res = await postForm(
      `${base}/upload/simple`,
      {
        token,
        filename: file.name,
        duration: String(Math.round(videoDuration)),
        frontend_app: '3speak-tv',
      },
      { file },
      {
        stallMs: 60000,
        onProgress: (loaded) => {
          const pct = size ? Math.min(99, Math.floor((loaded / size) * 100)) : 0;
          setUploadProgress(pct);
          setStatusText(`Uploading in a single request… ${pct}%`);
          patchUploadDetail({
            sent: loaded,
            total: size,
            waitingOn: loaded > 0 ? undefined : 'POST /upload/simple',
          });
        },
      },
    );

    if (!res || !res.embed_url) throw new Error('Single-request upload did not return an embed URL');
    return { embedUrl: res.embed_url, deferral };
  }, [user, fromStories, gated, gatedAllowlist, videoFile, videoDuration, postForm]);

  // Upload with automatic fallback. Primary path is TUS on the least-busy host;
  // if the user forced the reliable path (checkbox) or PATCH was already detected
  // blocked this session, go straight to the chunked fallback. If TUS trips the
  // PATCH-blocked watchdog mid-attempt, switch to chunked and remember it for the
  // rest of the session. Returns { embedUrl, deferral } — the deferral belongs to
  // whichever path actually produced the bytes, so publish can never commission
  // the encode against an attempt that was abandoned along the way.
  const runUploadWithFallback = useCallback(async (generatedPermlink) => {
    const reliableBase = (EMBED_API_URL || '').replace(/\/+$/, '');

    // Chunked, then the single-request last resort if chunked itself is dead.
    // A user reset (ABORTED) is deliberate and must never escalate to another
    // attempt — only genuine transport failures fall through.
    const chunkedThenSimple = async () => {
      try {
        return await runChunkedUpload();
      } catch (chunkErr) {
        if (chunkErr?.code === 'ABORTED') throw chunkErr;
        console.warn('Chunked upload failed — trying single-request fallback', chunkErr);
        toast.message('Still stuck — trying one last upload method.');
        return await runSimpleUpload();
      }
    };

    // Gating no longer decides the path. Every path now mints an upload token
    // and asks the backend to defer the encode, so the gated choice is made at
    // publish instead of travelling with the bytes — which is what lets the
    // toggle work at all, given the upload starts before the user can reach it.
    // If a backend does not support deferral, publish refuses rather than
    // shipping a supporters-only video in the clear.
    if (sessionForcedReliableRef.current) {
      chosenEmbedBaseRef.current = reliableBase;
      setSelectedEndpoint(reliableBase);
      return await chunkedThenSimple();
    }

    const { base, uploadUrl } = await pickEmbedEndpoint();
    chosenEmbedBaseRef.current = base;
    setSelectedEndpoint(base);
    try {
      return await runTusUpload(generatedPermlink, uploadUrl);
    } catch (err) {
      if (err?.code === 'PATCH_BLOCKED') {
        sessionForcedReliableRef.current = true;   // stick to reliable this session
        console.warn('PATCH blocked — switching to chunked upload fallback');
        toast.message('Your network blocked the resumable upload — switching to a more compatible method.');
        setStatusText('Switching upload method…');
        setUploadProgress(0);
        chosenEmbedBaseRef.current = reliableBase;
        setSelectedEndpoint(reliableBase);
        return await chunkedThenSimple();
      }
      throw err;
    }
  }, [gated, runTusUpload, runChunkedUpload, runSimpleUpload]);

  // Kick off the background upload (called when the user reaches "Add details").
  // Idempotent: only starts once per selected video. The embed asset gets its own
  // permlink here — the Hive post keeps its title-derived permlink and the two are
  // bridged at publish by the /video/{embedPermlink}/hive link step.
  const startEarlyUpload = useCallback(() => {
    if (prefilled || EMBED_DEBUG) return;            // nothing to upload in these flows
    if (!videoFile) return;
    // Cancelled by hand. Only an explicit publish restarts this one.
    if (cancelledFileRef.current === videoFile) return;
    // A different file is now selected (e.g. "Replace Video") → start fresh.
    if (earlyUploadStartedRef.current && earlyUploadedFileRef.current !== videoFile) {
      resetEarlyUpload();
    }
    if (earlyUploadStartedRef.current) return;       // already started/done for this file
    earlyUploadStartedRef.current = true;
    earlyUploadedFileRef.current = videoFile;
    setVideoUploadStatus('uploading');
    setUploadProgress(0);
    setStatusText('Uploading video in the background…');
    // Snapshot what the browser claims about the link at kickoff. It is not used
    // to size anything any more (the probe does that), but it is the first thing
    // worth seeing on a screenshot of an upload that went wrong.
    const conn = getConnectionProfile();
    patchUploadDetail({
      link: conn.effectiveType || 'unknown',
      linkDown: Number.isFinite(conn.downlink) ? conn.downlink : null,
      linkRtt: Number.isFinite(conn.rtt) ? conn.rtt : null,
      saveData: !!conn.saveData,
      fileBytes: videoFile?.size || 0,
      startedAt: Date.now(),
      retries: 0,
    });
    const p = (async () => {
      try {
        // Stale-client guard: if a newer build is deployed, force-reload onto it
        // BEFORE any upload starts, so nobody uploads on cached/retired code.
        if (await reloadIfStale()) return { embedUrl: '', deferral: null };   // page is reloading — bail out
        // TUS on the least-busy host, auto-falling back to chunked if PATCH is blocked.
        const { embedUrl: url, deferral } = await runUploadWithFallback('');
        if (!url) throw new Error('No embed URL returned');
        earlyEmbedUrlRef.current = url;
        // Pin the deferral to THIS upload. Whatever else starts and mints a
        // token later cannot move the target the encode gets commissioned at.
        earlyDeferralRef.current = deferral;
        setEmbedUrl(url);
        setUploadProgress(100);
        setVideoUploadStatus('done');
        setStatusText('');
        return { embedUrl: url, deferral };
      } catch (err) {
        console.error('Background video upload failed:', err);
        // Allow the publish step to retry the upload inline.
        earlyUploadStartedRef.current = false;
        earlyUploadPromiseRef.current = null;
        earlyDeferralRef.current = null;
        setVideoUploadStatus('error');
        // Say WHY, in the bar the user is actually looking at. Without this the
        // last thing on screen stays "retrying…" forever, which is
        // indistinguishable from the hang these guards exist to prevent.
        setStatusText(err?.message || 'Upload failed — please retry');
        toast.error(err?.message || 'Upload failed — please retry');
        return { embedUrl: '', deferral: null };
      }
    })();
    earlyUploadPromiseRef.current = p;
  }, [prefilled, videoFile, runUploadWithFallback, resetEarlyUpload, patchUploadDetail]);

  /**
   * publishToEmbed — the 3-step publish:
   * 1. TUS upload to embed service
   * 2. Post to Hive via aioha
   * 3. Link embed video to Hive post
   */
  const publishToEmbed = async () => {
    if (!user) {
      toast.error('User not logged in');
      return;
    }
    // Fail fast on a stale/expired wallet session (e.g. an expired HiveSigner
    // token): `user` can be a leftover localStorage value while aioha has no
    // live session. Without this, the whole video + thumbnail upload runs and
    // only the final Hive broadcast fails with "Not logged in". isLoggedIn()
    // is true for an aioha session OR a ManteAuth/ButrAuth login.
    if (!isLoggedIn()) {
      toast.error('Your session expired — please log in again before uploading');
      return;
    }
    // For non-prefilled flows we need a local file. Prefilled flows already
    // have the embed URL handed over from an external uploader.
    if (!prefilled && !videoFile) {
      toast.error('No video file');
      return;
    }
    if (!fromStories && !title?.trim()) {
      toast.error('Title is required');
      return;
    }
    if (!description?.trim()) {
      toast.error('Description is required');
      return;
    }
    if (!fromStories && (!tagsPreview || tagsPreview.length === 0)) {
      toast.error('Please add at least one tag');
      return;
    }

    // Backstop upload gate: blocks "Post Video/Short" for creators with
    // canUpload === false, even if they reached /embed-studio directly (bypassing
    // the upload-button gate). Fails open if the check errors.
    if (isUploadBlocked(await getCreatorSettings(user))) {
      useSupportBlock.getState().showSupportBlock('upload');
      return;
    }

    // If the background upload (started on the "Add details" step) is running or
    // done, reuse it instead of uploading again. Wait for an in-flight one.
    let earlyUrl = earlyEmbedUrlRef.current;
    // Travels with the bytes from here on, never out of shared state: by the
    // time publish runs a second attempt may have started, and commissioning
    // against its permlink strands the upload that actually landed at
    // awaiting_encode forever.
    let deferral = earlyDeferralRef.current;
    if (!prefilled && !earlyUrl && earlyUploadPromiseRef.current) {
      setUploading(true);
      setStatusText('Finishing video upload…');
      try {
        const early = await earlyUploadPromiseRef.current;
        earlyUrl = early?.embedUrl || '';
        deferral = early?.deferral || null;
      } catch { earlyUrl = ''; deferral = null; }
    }
    const alreadyUploaded = !prefilled && !!earlyUrl;

    setUploading(true);
    setUploadProgress(alreadyUploaded ? 100 : 0);
    setStatusText(prefilled ? 'Preparing publish...' : (alreadyUploaded ? 'Finalizing…' : 'Uploading video...'));
    addMessage(prefilled ? 'Using pre-uploaded video' : (alreadyUploaded ? 'Video already uploaded' : 'Starting video upload...'));

    try {
      // For prefilled flows, the permlink was decided by whoever uploaded the
      // file (e.g. the Hangouts server). Reuse it so the Hive post permlink
      // matches the embed permlink — that's what the existing /video/{p}/hive
      // link endpoint expects.
      // Permlink slug source: longform videos use the title; shorts have no
      // title, so they keep using the first words of the description (caption).
      const slugSource = ((fromStories ? description : title) || description || '').trim();
      const slug = slugSource
        ? slugSource.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 27).replace(/-+$/, '')
        : '';
      const generatedPermlink = prefilled && prefilledPermlink
        ? prefilledPermlink
        : (slug ? `${slug}-${Date.now() % 1000}` : '');

      // ─── Step 1: TUS upload to embed service ───
      // Skipped when prefilled OR when the background upload already finished it.
      let capturedEmbedUrl = prefilled ? prefilledEmbedUrl : (alreadyUploaded ? earlyUrl : '');

      if (prefilled) {
        // Nothing to upload — the file was already pushed to embed.3speak.tv
        // by an external uploader. Skip straight to thumbnail + Hive linking.
        setUploadProgress(100);
        addMessage('Pre-uploaded video ready');
      } else if (alreadyUploaded) {
        // Background upload (from the details step) already produced the embed URL.
        setUploadProgress(100);
        addMessage('Video uploaded in the background');
      } else if (EMBED_DEBUG) {
        // Debug mode: simulate upload progress without actually uploading
        addMessage('[DEBUG] Simulating upload...');
        for (let pct = 0; pct <= 100; pct += 5) {
          await new Promise(r => setTimeout(r, 150));
          setUploadProgress(pct);
          setStatusText(`Uploading video... ${pct}%`);
        }
        capturedEmbedUrl = `https://embed.okinoko.io/embed?v=debug/${Date.now()}`;
        addMessage('[DEBUG] Simulated upload complete');
      } else {
        // No background upload available (it failed, or the user reached publish
        // before "Add details" started one) → upload inline now, with fallback.
        const uploaded = await runUploadWithFallback(generatedPermlink);
        capturedEmbedUrl = uploaded?.embedUrl || '';
        deferral = uploaded?.deferral || null;
      }

      // Fallback: if no X-Embed-URL header, warn but don't use the raw TUS URL
      if (!capturedEmbedUrl) {
        console.warn('No X-Embed-URL header received from embed service');
      }

      if (!capturedEmbedUrl) {
        throw new Error('Upload succeeded but no embed URL was returned');
      }

      setEmbedUrl(capturedEmbedUrl);
      addMessage('Video uploaded successfully');

      // 🔐 Commission the encode now that the gated choice is final.
      //
      // A deferred upload has no encode job yet: its bytes are pinned and the
      // video is parked. This call settles gating and queues the job together,
      // which is the whole reason for deferring — the encoder is what encrypts,
      // and an unencrypted rendition is public the moment its CID is pinned, so
      // the decision cannot be revisited afterwards.
      if (deferral?.lost) {
        // The bytes landed, but the finalize token that goes with them is gone
        // (a session resumed from an older build, or a token bound to a
        // different permlink). Commissioning is impossible, and posting to Hive
        // anyway would publish a video that stays parked and never encodes.
        throw new Error(
          'This upload could not be finalised because its upload session was '
          + 'interrupted. Nothing was published. Please re-select the video and '
          + 'upload it again.'
        );
      }

      if (deferral?.finalizeToken && deferral?.permlink) {
        const finalizeBase = (chosenEmbedBaseRef.current || EMBED_API_URL || '').replace(/\/+$/, '');
        addMessage(gated ? 'Starting encrypted encode…' : 'Starting encode…');
        // The upload's success response comes back BEFORE the server has pinned
        // the file: post-finish answers immediately and then pins on setImmediate,
        // so for a while the video is still `uploading` and commissioning replies
        // 409 not_awaiting_encode (or not_pinned while the CID is still landing).
        // That is "not yet", not "no", and the wait scales with file size — a
        // 105MB short raced it by ~3s. Failing the publish there made the user
        // click Post a second time to get the same upload commissioned, so poll
        // instead. Only these two codes retry: 401/403/404 are real and must
        // surface immediately rather than being sat on for a minute and a half.
        const FINALIZE_RETRY_MS = [1000, 2000, 3000, 5000, 5000, 8000, 8000, 10000, 12000, 15000, 20000];
        for (let attempt = 0; ; attempt++) {
          try {
            // 2xx ends the loop: 201 commissioned, or 200 already_queued, which
            // makes a repeat attempt after a lost response harmless.
            await axios.post(
              `${finalizeBase}/video/${deferral.permlink}/encode`,
              { gated: !!gated, ...(gated && gatedAllowlist.length ? { allowlist: gatedAllowlist } : {}) },
              {
                headers: {
                  Authorization: `Bearer ${deferral.finalizeToken}`,
                  'Content-Type': 'application/json',
                },
              },
            );
            break;
          } catch (encErr) {
            const code = encErr?.response?.data?.code;
            const notReady = encErr?.response?.status === 409
              && (code === 'not_awaiting_encode' || code === 'not_pinned');
            if (!notReady || attempt >= FINALIZE_RETRY_MS.length) throw encErr;
            setStatusText('Finishing upload on the server…');
            await new Promise(r => setTimeout(r, FINALIZE_RETRY_MS[attempt]));
          }
        }
      } else if (gated && !deferral?.gated) {
        // Not deferred, and the toggle went on after the token was minted. The
        // upload is already committed as public; encoding it now would publish
        // it in the clear, and IPFS content cannot be withdrawn. Stop before the
        // Hive post exists rather than after.
        throw new Error(
          'Supporters-only was switched on after the upload had already started, and this '
          + 'upload server cannot apply it afterwards. Nothing was published. Please re-select '
          + 'the video and turn supporters-only on before continuing.'
        );
      }

      // ─── Upload thumbnail if available ───
      let thumbnailUrl = null;
      if (thumbnailFile) {
        try {
          setStatusText('Uploading thumbnail...');
          addMessage('Uploading thumbnail...');
          // Embed posts are broadcast by @threespeak, so the thumbnail goes
          // straight to the 3Speak image server (static key) — no user signature.
          thumbnailUrl = await uploadThumbnail(thumbnailFile, user, { preferStatic: true });
          addMessage('Thumbnail uploaded');
        } catch (thumbErr) {
          console.warn('Thumbnail upload failed:', thumbErr);
          addMessage('Warning: Thumbnail upload failed (non-critical)', 'warning');
        }
      }

      if (EMBED_DEBUG) {
        addMessage('[DEBUG] Skipping Hive posting and embed linking');
        setStatusText('[DEBUG] Done — staying on screen');
        setUploadProgress(100);
        // Keep uploading=true so the status screen stays visible
        return;
      }

      setStatusText('Posting to Hive...');
      addMessage('Publishing to Hive blockchain...');

      // ─── Step 2: Post to Hive via aioha ───
      const hivePermlink = generatedPermlink;
      const communityTag = typeof community === 'string' ? community : community?.name || 'hive-181335';

      // Build body: embed URL (video first) + description + credit to original author
      let postBody = `${capturedEmbedUrl}\n\n${description}`;
      if (originalAuthor && originalPermlink) {
        // Use shorts link format when remix comes from a short
        const shortPl = originalShortPermlink || originalPermlink;
        const originalLink = fromStories
          ? `${window.location.origin}/shorts?v=${originalAuthor}/${shortPl}`
          : `${window.location.origin}/@${originalAuthor}/${originalPermlink}`;
        postBody += `\n\n---\n*Based on a video by [@${originalAuthor}](${originalLink})*`;
      }

      // "Watch on 3Speak" link at the bottom, pointing at the right page for the
      // content type: shorts → /shorts, regular videos → /watch. Always points at
      // the main instance (3speak.tv), never preview, regardless of where posted.
      const watchPath = fromStories
        ? `/shorts?v=${user}/${hivePermlink}`
        : `/watch?v=${user}/${hivePermlink}`;
      postBody += `\n\n---\n▶ [Watch on 3speak.tv](https://3speak.tv${watchPath})`;

      // Only the community tag is added automatically (no '3speak', no 'short').
      // Shorts are identified by the embed-video `short` DB field, not a Hive tag.
      // The community tag is surfaced in the uploader's tag list and counts toward
      // the 10-tag limit, so the total never exceeds 10.
      const baseTags = fromStories
        ? ['hive-181335']
        : [communityTag];
      // When marked adult, append the canonical Hive `nsfw` tag so the whole Hive
      // ecosystem (and our hive_tags filter) treats it as NSFW.
      const userTags = [
        ...tagsPreview.filter(t => !baseTags.includes(t)),
        ...(isNsfw ? ['nsfw'] : []),
      ].filter((t, i, a) => a.indexOf(t) === i);

      // Embed ASSET owner/permlink (…/embed?v=owner/permlink) — this is what the
      // `video.info` block below carries so peakd/ecency render the player.
      let embedOwner = user;
      let embedAssetPermlink = hivePermlink;
      try {
        const vParam = new URL(capturedEmbedUrl).searchParams.get('v') || '';
        const [o, p] = vParam.split('/');
        if (o) embedOwner = o;
        if (p) embedAssetPermlink = p;
      } catch { /* fall back to user / hive permlink */ }

      // OpenAttribute: read the source aspect off the file we are publishing.
      // Resolves null (and the attribute is then omitted) when there is no local
      // file — a remix that reuses an existing embed never had one.
      const oaOrientation = await probeVideoOrientation(videoFile);

      const jsonMetadata = {
        app: '3speak/embed',
        format: 'markdown',
        tags: [...baseTags, ...userTags],
        // Top-level `image: [url]` is the Hive-wide convention frontends read to
        // pick a post's cover (peakd, ecency, hive.blog, …). Only add it when we
        // actually have a thumbnail — otherwise we'd post `image: [null]` which
        // some renderers choke on. The same field is duplicated inside `video`
        // for legacy 3Speak readers that look for it there.
        ...(thumbnailUrl ? { image: [thumbnailUrl] } : {}),
        // Top-level `links` array — the Hive-wide convention (peakd, ecency, …)
        // for cataloguing the URLs in the body. Listing the play.3speak.tv embed
        // here is what lets other frontends detect and render the 3Speak player
        // inline (matches the Snapie.io posts). `capturedEmbedUrl` is already the
        // canonical `https://play.3speak.tv/embed?v=owner/permlink` form that the
        // body leads with.
        links: [capturedEmbedUrl],
        video: {
          platform: '3speak',
          url: capturedEmbedUrl,
          reusable: (originalAuthor && originalPermlink) ? true : reusable,
          ...(thumbnailUrl ? { thumbnail: thumbnailUrl } : {}),
          ...(originalAuthor ? { originalAuthor, originalPermlink } : {}),
          // Legacy 3Speak `info` block. Other Hive frontends (peakd, ecency, …)
          // render the player by reading video.info.author + video.info.permlink
          // to build the embed — WITHOUT it they request an EMPTY owner/permlink
          // and show nothing. Mirrors the schema of classic 3speak.tv posts, and
          // our own PostView/WatchedView/chatLinks read video.info too.
          info: {
            platform: '3speak',
            author: embedOwner,
            permlink: embedAssetPermlink,
            title: title || '',
            duration: Number(videoDuration) || 0,
            ...(thumbnailUrl ? { sourceMap: [{ url: thumbnailUrl, type: 'thumbnail' }] } : {}),
          },
        },
        // OpenAttribute. A short is a MicroPost: without this it depends on the
        // reading app having peak.snaps in its own container list, and any app
        // that does not falls through to plain `Comment`. A regular upload is an
        // Article, which is what the spec's rules would infer anyway — the value
        // there is that the reader stops guessing and gets the attribute below.
        ...oaEnvelope(fromStories ? OA_MICROPOST : OA_ARTICLE),
        // `surface` is where this was published to be watched, not how long it
        // is: a 16-second landscape clip is still a `watch` video.
        ...threespeakVideo({
          surface: fromStories ? 'shorts' : 'watch',
          orientation: oaOrientation,
          duration: videoDuration,
        }),
        // 🔐 Marks the post as supporters-only so a watch page knows to ask the
        // gate before trying to play anything. It is a HINT for rendering, never
        // the access decision: the gate re-checks entitlement on every manifest
        // and key request, so editing this out of the post buys nothing.
        // The gate knows the asset by its EMBED permlink, which is not always
        // the Hive permlink (a remix reuses an existing asset), so it is stored
        // explicitly rather than re-derived by every reader.
        ...(gated ? { gated: true, gatedVideoId: embedAssetPermlink } : {}),
      };

      // Build comment_options. When the author is declining payout, skip
      // beneficiaries entirely — declaring beneficiaries against a 0 HBD
      // payout reads weird on-chain and an empty beneficiaries extension
      // would be rejected by Hive.
      let allBeneficiaries = [];
      if (!declineRewards) {
        let parsedBeneficiaries = beneficiaries;
        if (typeof parsedBeneficiaries === 'string') {
          try { parsedBeneficiaries = JSON.parse(parsedBeneficiaries); } catch { parsedBeneficiaries = []; }
        }

        // Start with user-set beneficiaries (from the UI list, includes locked items)
        const beneMap = new Map();
        for (const b of (Array.isArray(parsedBeneficiaries) ? parsedBeneficiaries : [])) {
          beneMap.set(b.account, Math.max(beneMap.get(b.account) || 0, b.weight));
        }

      // Apply locked beneficiaries: 10% threespeakfund + 1% encoder.pay for
      // non-Pro users (both skipped for Pro subscribers) + 5% to the original
      // creator on remix/clip (kept for both tiers). encoder.pay rides on
      // embed uploads specifically because they go through 3Speak's encoder.
      enforceLockedBeneficiaries(beneMap, {
        isPremium,
        username: user,
        includeEncoder: true,
        originalAuthor: originalAuthor && originalPermlink ? originalAuthor : null,
      });

        // Convert map to sorted array (sorted by account name — required by Hive protocol)
        allBeneficiaries = [...beneMap.entries()]
          .map(([account, weight]) => ({ account, weight }))
          .sort((a, b) => a.account.localeCompare(b.account));
      }

      const commentOptions = {
        author: user,
        permlink: hivePermlink,
        max_accepted_payout: declineRewards ? '0.000 HBD' : '1000000.000 HBD',
        percent_hbd: rewardPowerup ? 0 : 10000,
        allow_votes: true,
        allow_curation_rewards: true,
        // Hive rejects an empty beneficiaries extension ("Must specify at least one
        // beneficiary") — Premium users with no beneficiaries have an empty list —
        // but the broadcaster's serializer needs `extensions` to be an array. So use
        // an empty array (not a missing field, and not an empty-beneficiaries entry).
        extensions: allBeneficiaries.length > 0 ? [[0, { beneficiaries: allBeneficiaries }]] : [],
      };

      // Determine parent:
      // - Short remix → comment under the original short
      // - New short → reply to @peak.snaps latest container post
      // - Regular video → root post in community
      let parentAuthor = '';
      let parentPermlink = communityTag;

      if (fromStories && originalAuthor && originalPermlink) {
        // Remix of an existing short → post as comment under the original
        parentAuthor = originalAuthor;
        parentPermlink = originalPermlink;
        addMessage(`Replying to @${parentAuthor}/${parentPermlink}`);
      } else if (fromStories) {
        addMessage('Finding snaps container post...');
        setStatusText('Finding snaps container post...');
        try {
          // @peak.snaps always has a live container (a new one every ~8-13h,
          // and the previous one keeps accepting replies), so a failure here
          // is the RPC node, not a gap in the containers. The shared resolver
          // therefore walks every configured node and both hivemind APIs,
          // retrying in rounds, instead of giving up after one call.
          const container = await resolveSnapsContainer({
            onProgress: (msg) => { addMessage(msg); setStatusText(msg); },
          });
          parentAuthor = container.author;
          parentPermlink = container.permlink;
          addMessage(`Replying to @${parentAuthor}/${parentPermlink}`);
        } catch (snapErr) {
          console.error('Failed to fetch snaps container:', snapErr);
          throw new Error(snapErr?.message || 'Could not find a snaps container post to reply to');
        }
      }

      // ─── Scheduled-post branch ─────────────────────────────────────
      // If the user toggled "schedule this post", we don't broadcast now.
      // Instead we ensure @threespeak is in their posting account_auths (asks
      // for an account_update2 signature on the first scheduled post ever),
      // then POST the fully-built post to the checker, which has a 5-minute
      // cron that broadcasts due posts as @threespeak on the user's behalf.
      if (isScheduled && scheduleDateTime && !fromStories) {
        try {
          setStatusText('Checking @threespeak posting authority...');
          addMessage('Checking @threespeak posting authority...');
          const hasAuth = await hasThreespeakPostingAuth(user);
          if (!hasAuth) {
            setStatusText('Authorizing @threespeak (sign with active key)...');
            addMessage('Authorizing @threespeak to post on your behalf...');
            await addThreespeakToPostingAuth(user);
            addMessage('@threespeak authorized');
          }

          // The HTML datetime-local string is local-tz; convert to a real ISO UTC.
          const scheduledOnIso = new Date(scheduleDateTime).toISOString();

          // Auth: the checker create endpoint uses the app-key method (same as the
          // embed /video/* writes), not a client Hive signature — because HiveSigner
          // and ManteAuth can't sign arbitrary messages client-side. The checker
          // trusts the app key + verifies on-chain that the user granted @threespeak
          // posting authority (which we just ensured above and the cron relies on).
          const payoutOptions = declineRewards ? 'decline' : (rewardPowerup ? 'powerup' : 'default');
          const checkerBase =
            import.meta.env.VITE_SCHEDULED_POSTS_API_URL || 'https://prod-checker.okinoko.io';
          const url = `${checkerBase.replace(/\/$/, '')}/scheduled-posts/create`;

          // The embedvideos service indexes uploads by their own permlink. We extract
          // it from the capturedEmbedUrl (format: ?v=<owner>/<embedPermlink>) so the
          // cron can later link the broadcast Hive post back to the embed-video record.
          let embedPermlink = null;
          try {
            const v = new URL(capturedEmbedUrl).searchParams.get('v');
            if (v) embedPermlink = v.split('/').pop() || null;
          } catch { /* leave null — link step in cron is best-effort */ }

          setStatusText('Saving scheduled post...');
          addMessage('Saving scheduled post...');
          const resp = await axios.post(url, {
            owner: user,
            permlink: hivePermlink,
            scheduledOn: scheduledOnIso,
            title,
            description,
            body: postBody,
            tags: jsonMetadata.tags,
            jsonMetadata,
            beneficiaries: allBeneficiaries,
            payoutOptions,
            thumbnail: thumbnailUrl,
            parentAuthor,
            parentPermlink,
            embedPermlink,
          }, {
            headers: CHECKER_API_KEY ? { Authorization: `Bearer ${CHECKER_API_KEY}` } : {},
          });

          if (resp.status !== 201 || !resp.data?.success) {
            throw new Error(resp.data?.error || 'Failed to save scheduled post');
          }

          // We deliberately SKIP the regular Hive broadcast and the embed-link
          // step here — the cron does both at publish time.
          setStatusText(`Scheduled for ${new Date(scheduledOnIso).toLocaleString()}`);
          addMessage(`Scheduled for ${new Date(scheduledOnIso).toLocaleString()}`, 'success');
          toast.success('Post scheduled!');
          setCompleted(true);
          setUploading(false);
          setUploadProgress(100);
          return;
        } catch (schedErr) {
          console.error('Scheduled-post error:', schedErr);
          const msg = schedErr?.response?.data?.error || schedErr?.message || 'Could not schedule post';
          addMessage(`Schedule failed: ${msg}`, 'error');
          toast.error(`Schedule failed: ${msg}`);
          throw schedErr;
        }
      }

      // Policy: video posts in the embed route are broadcast by @threespeak, not
      // signed by the user. Every aioha login (Keychain/HiveAuth/PeakVault/Ledger
      // /HiveSigner) routes its post through our server, which signs+broadcasts as
      // @threespeak on the user's behalf (they granted @threespeak posting
      // authority via the pre-upload gate). ButrAuth (getCurrentProvider() ===
      // null) keeps its own cookie-authenticated server path via commentWithAioha.
      const useThreespeakProxy = !!getCurrentProvider();
      if (useThreespeakProxy) {
        addMessage('Posting via @threespeak (delegated posting authority)');
      }

      let result;

      if (originalAuthor && originalPermlink && !fromStories) {
        // Dual post (non-short remix): video post + comment on original video
        addMessage('Creating post and comment on original video...');

        const mainPostOp = ['comment', {
          parent_author: parentAuthor,
          parent_permlink: parentPermlink,
          author: user,
          permlink: hivePermlink,
          title: title,
          body: postBody,
          json_metadata: JSON.stringify(jsonMetadata),
        }];

        const commentOptionsOp = ['comment_options', commentOptions];

        const replyPermlink = `re-${originalAuthor}-${Date.now()}`;
        const replyBody = `I created a remix/clip from this video!\n\nCheck it out: [${title || 'My remix'}](${window.location.origin}/@${user}/${hivePermlink})`;
        const replyOp = ['comment', {
          parent_author: originalAuthor,
          parent_permlink: originalPermlink,
          author: user,
          permlink: replyPermlink,
          title: '',
          body: replyBody,
          // A notification pointing at the remix, not the remix itself, so it
          // carries no video attribute — only the envelope saying what it is.
          json_metadata: JSON.stringify({ app: '3speak/embed', tags: ['3speak'], ...oaEnvelope(OA_COMMENT) }),
        }];

        const remixOps = [mainPostOp, commentOptionsOp, replyOp];
        result = useThreespeakProxy
          ? await broadcastViaThreespeak(remixOps)
          : await broadcastWithAioha(remixOps, KeyTypes.Posting);
      } else {
        // Single post: shorts (including short remixes) and regular uploads
        if (useThreespeakProxy) {
          // Build the raw ops commentWithAioha would have built, and post them
          // server-side as @threespeak.
          const ops = [
            ['comment', {
              parent_author: parentAuthor,
              parent_permlink: parentPermlink,
              author: user,
              permlink: hivePermlink,
              title: fromStories ? '' : title,
              body: postBody,
              json_metadata: JSON.stringify(jsonMetadata),
            }],
            ['comment_options', commentOptions],
          ];
          result = await broadcastViaThreespeak(ops);
        } else {
          result = await commentWithAioha(
            parentAuthor,
            parentPermlink,
            hivePermlink,
            fromStories ? '' : title,
            postBody,
            jsonMetadata,
            commentOptions
          );
        }
      }

      if (!result.success) {
        throw new Error('Failed to post to Hive');
      }

      addMessage('Posted to Hive successfully');
      setStatusText('Linking embed video...');

      // ─── Step 3: Link embed video to Hive post ───
      const vParam = new URL(capturedEmbedUrl).searchParams.get('v');
      const embedPermlink = vParam ? vParam.split('/').pop() : null;
      // Target the SAME server the bytes went to (the returned embed URL is the
      // shared player host, not the upload server, so we can't derive it).
      const embedApiBase = chosenEmbedBaseRef.current || EMBED_API_URL;

      try {
        if (embedPermlink && embedApiBase) {
          await fetch(`${embedApiBase}/video/${embedPermlink}/hive`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(EMBED_API_KEY ? { 'X-API-Key': EMBED_API_KEY } : {}),
            },
            body: JSON.stringify({
              hive_author: user,
              hive_permlink: hivePermlink,
              hive_title: fromStories ? '' : title,
              hive_body: postBody,
              hive_tags: ['3speak', ...tagsPreview],
            }),
          });
          addMessage('Embed video linked to Hive post');
        }
      } catch (linkErr) {
        console.warn('Failed to link embed video to Hive post:', linkErr);
        addMessage('Warning: Could not link embed video (non-critical)', 'warning');
      }

      // ─── Step 4: Update thumbnail on embed service ───
      if (thumbnailUrl && embedPermlink && embedApiBase) {
        try {
          await fetch(`${embedApiBase}/video/${embedPermlink}/thumbnail`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(EMBED_API_KEY ? { 'X-API-Key': EMBED_API_KEY } : {}),
            },
            body: JSON.stringify({ thumbnail_url: thumbnailUrl }),
          });
          addMessage('Thumbnail linked to embed video');
        } catch (thumbLinkErr) {
          console.warn('Failed to set embed thumbnail:', thumbLinkErr);
          addMessage('Warning: Could not set embed thumbnail (non-critical)', 'warning');
        }
      }

      // ─── Channel trailer ───
      // After the post exists, never before: the checker verifies the permlink
      // really belongs to this creator before pinning it. Non-fatal — the video
      // is published either way, so a failure here is a warning, not an error.
      if (isChannelTrailer) {
        try {
          await setChannelTrailer(user, hivePermlink, { author: user });
          addMessage('Set as your channel trailer', 'success');
        } catch (trailerErr) {
          console.warn('Failed to set channel trailer:', trailerErr);
          addMessage('Published, but could not set it as your channel trailer', 'warning');
          // Surfaced, not just logged into the status list: the video publishes
          // fine either way, so a quiet failure looks like the toggle did nothing.
          toast.error('Published, but could not set it as your channel trailer.');
        }
      }

      // ─── Done ───
      setStatusText('Completed');
      setPublishedPermlink(hivePermlink);
      setCompleted(true);
      setUploading(false);
      addMessage('Video successfully published!', 'success');
      toast.success('Video published successfully!');

    } catch (err) {
      console.error('Publish error:', err);
      addMessage('Upload failed: ' + err.message, 'error');
      toast.error('Upload failed: ' + err.message);
      setUploading(false);
      setStatusText('');
    }
  };

  const value = {
    // Step
    step, setStep,
    // Video
    videoFile, setVideoFile,
    prevVideoFile, setPrevVideoFile,
    videoDuration, setVideoDuration,
    videoMode, setVideoMode,
    clearVideoSelection,
    // Thumbnail
    generatedThumbnail, setGeneratedThumbnail,
    selectedThumbnail, setSelectedThumbnail,
    thumbnailFile, setThumbnailFile,
    selectedIndex, setSelectedIndex,
    // Details
    title, setTitle,
    description, setDescription,
    tagsInputValue, setTagsInputValue,
    tagsPreview, setTagsPreview,
    community, setCommunity,
    beneficiaries, setBeneficiaries,
    declineRewards, SetDeclineRewards,
    rewardPowerup, setRewardPowerup,
    isNsfw, setIsNsfw,
    isChannelTrailer, setIsChannelTrailer,
    isScheduled, setIsScheduled,
    scheduleDateTime, setScheduleDateTime,
    // Community data
    communitiesData, setCommunitiesData,
    // Modals
    isOpen, setIsOpen,
    benficaryOpen, setBeneficiaryOpen,
    BeneficiaryList, setBeneficiaryList,
    list, setList,
    remaingPercent, setRemaingPercent,
    // Publish state
    uploading, setUploading,
    completed, setCompleted,
    uploadProgress, setUploadProgress,
    statusText, setStatusText,
    uploadDetail, setUploadDetail,
    statusMessages, setStatusMessages,
    embedUrl, setEmbedUrl,
    publishedPermlink,
    // Background ('early') video upload that starts on the details step
    videoUploadStatus,
    selectedEndpoint,
    startEarlyUpload,
    // Opt-in "reliable" (resumable chunked, PATCH-free) upload fallback
    // Prefilled flow (e.g. Hangouts server-side recording)
    prefilled,
    prefilledPermlink,
    prefilledOwner,
    prefilledEmbedUrl,
    setPrefilledFromQuery,
    // Entry origin
    fromStories, setFromStories,
    gated, setGated,
    gatedAllowlist, setGatedAllowlist,
    // Original video attribution
    originalAuthor, setOriginalAuthor,
    originalPermlink, setOriginalPermlink,
    originalShortPermlink, setOriginalShortPermlink,
    // Reusable flag
    reusable, setReusable,
    // User
    user,
    navigate,
    // Functions
    publishToEmbed,
    resetUploadState,
    cancelEarlyUpload,
  };

  return (
    <EmbedUploadContext.Provider value={value}>
      {children}
    </EmbedUploadContext.Provider>
  );
}
