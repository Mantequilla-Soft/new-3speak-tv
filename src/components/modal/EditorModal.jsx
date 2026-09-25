import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { X, Loader2 } from 'lucide-react';
import { generateVideoThumbnails } from '../../utils/videoThumbnails';
import { getEditorUrl } from '../../utils/config';
import { useAppStore } from '../../lib/store';
import { useEmbedUpload } from '../../context/EmbedUploadContext';
import { usePremiumStatus } from '../../hooks/usePremiumStatus';
import { getLockedBeneficiaries } from '../../utils/beneficiaries';
import './EditorModal.scss';

function EditorModal({ isOpen, onClose, videoUrl, videoName, videoType, clipStart, clipEnd, originalAuthor, originalPermlink, originalShortPermlink }) {
  const navigate = useNavigate();
  const { setVideoFile, setPrevVideoFile, setGeneratedThumbnail, setVideoDuration, setOriginalAuthor, setOriginalPermlink, setOriginalShortPermlink, setFromStories, setList, setRemaingPercent } = useEmbedUpload();
  const iframeRef = useRef(null);
  const mediaLoadedRef = useRef(false);
  const [editorReady, setEditorReady] = useState(false);
  const { theme, getEffectiveTheme, user } = useAppStore();
  const premiumStatus = usePremiumStatus(user);
  const isPremium = !!premiumStatus?.premium;
  const [renderStatus, setRenderStatus] = useState(null); // null | 'sending' | 'rendering' | 'complete' | 'error' | 'preparing'
  const [renderProgress, setRenderProgress] = useState(0);
  const [renderedVideoUrl, setRenderedVideoUrl] = useState(null);
  const pollIntervalRef = useRef(null);

  // Resolved editor URL (picked from the configured list on each open)
  const [resolvedUrl, setResolvedUrl] = useState(null);
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState(false);

  // Resolve a working editor URL when the modal opens
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setResolving(true);
    setResolveError(false);
    setResolvedUrl(null);
    setEditorReady(false);
    mediaLoadedRef.current = false;

    getEditorUrl().then(url => {
      if (cancelled) return;
      if (url) {
        setResolvedUrl(url);
      } else {
        setResolveError(true);
      }
      setResolving(false);
    });

    return () => { cancelled = true; };
  }, [isOpen]);

  // Lock body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'auto';
    }
    return () => {
      document.body.style.overflow = 'auto';
    };
  }, [isOpen]);

  // Send message to editor iframe
  const sendToEditor = useCallback((message) => {
    if (iframeRef.current?.contentWindow && resolvedUrl) {
      iframeRef.current.contentWindow.postMessage(message, new URL(resolvedUrl).origin);
    }
  }, [resolvedUrl]);

  // Send theme and desktop flag to editor when ready or when theme changes
  useEffect(() => {
    if (editorReady) {
      sendToEditor({ type: 'set-theme', theme: getEffectiveTheme() });
      sendToEditor({ type: 'set-desktop', isDesktop: window.matchMedia('(min-width: 768px)').matches });
    }
  }, [editorReady, theme, sendToEditor, getEffectiveTheme]);

  // Listen for messages from editor iframe
  useEffect(() => {
    if (!isOpen || !resolvedUrl) return;

    const handleMessage = (event) => {
      // Validate origin
      try {
        const editorOrigin = new URL(resolvedUrl).origin;
        if (event.origin !== editorOrigin) return;
      } catch {
        return;
      }

      const { data } = event;
      if (!data || data.source !== '3speak-editor') return;

      switch (data.type) {
        case 'editor-ready':
          setEditorReady(true);
          // If we have a video to pre-load (remix mode), send it once
          if (videoUrl && !mediaLoadedRef.current) {
            mediaLoadedRef.current = true;
            // Convert raw IPFS URLs to HLS playlist URLs for the editor
            let editorUrl = videoUrl;
            if (editorUrl.includes('/ipfs/') && !editorUrl.endsWith('.m3u8')) {
              editorUrl = editorUrl.replace(/\/+$/, '') + '/480p/index.m3u8';
            }
            const msg = {
              type: 'load-media',
              url: editorUrl,
              name: videoName || 'Short Video',
              mediaType: videoType || 'video'
            };
            if (clipStart != null) msg.clipStart = clipStart;
            if (clipEnd != null) msg.clipEnd = clipEnd;
            if (originalAuthor) msg.parentAuthor = originalAuthor;
            if (originalPermlink) msg.parentPermlink = originalPermlink;
            sendToEditor(msg);
          }
          break;

        case 'render-request':
          handleRenderRequest(data.timeline);
          break;

        case 'post-to-3speak':
          handlePostTo3Speak(data.outputUrl);
          break;

        case 'editor-closed':
          // The editor already asked "are you sure" inside the iframe
          handleClose({ confirmed: true });
          break;
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [isOpen, resolvedUrl, videoUrl, videoName, videoType, clipStart, clipEnd, sendToEditor]);

  // While the editor is open, keys must not reach the page behind it (the
  // shorts page plays/pauses on Space and switches videos on the arrow keys).
  // Space is forwarded so it plays/pauses the editor preview instead.
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e) => {
      const t = e.target;
      const editable = t?.tagName === 'INPUT' || t?.tagName === 'TEXTAREA' || t?.tagName === 'SELECT' || t?.isContentEditable;
      e.stopImmediatePropagation();
      if (editable) return;
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        if (editorReady) sendToEditor({ type: 'toggle-play' });
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [isOpen, editorReady, sendToEditor]);

  // Give the editor keyboard focus once it is ready, so its own shortcuts work
  useEffect(() => {
    if (editorReady) iframeRef.current?.focus();
  }, [editorReady]);

  // Prevent navigation away while the editor is open
  useEffect(() => {
    if (!isOpen || !editorReady) return;

    // Block real page unloads (refresh, close tab)
    const handleBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };

    // Intercept internal link clicks (SPA navigation) in capture phase
    const handleClick = (e) => {
      const anchor = e.target.closest('a[href]');
      if (!anchor) return;

      const href = anchor.getAttribute('href');
      // Only intercept internal SPA links
      if (!href || href.startsWith('#') || href.startsWith('http') || href.startsWith('mailto:')) return;

      const leave = window.confirm(
        'The editor is still open. Leaving this page will close the editor and unsaved changes will be lost.\n\nOK = Close editor & leave\nCancel = Stay on this page'
      );

      if (!leave) {
        e.preventDefault();
        e.stopPropagation();
      }
      // If they confirm, let the click proceed — the component will unmount naturally
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('click', handleClick, true);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('click', handleClick, true);
    };
  }, [isOpen, editorReady]);

  // Handle render request from editor
  const handleRenderRequest = async (timeline) => {
    setRenderStatus('sending');

    try {
      // Collect media URLs from timeline
      const mediaUrls = [];
      for (const track of timeline.tracks || []) {
        for (const clip of track.clips || []) {
          if (clip.url) {
            mediaUrls.push({ id: clip.id, url: clip.url, type: clip.type });
          }
        }
      }

      const response = await fetch('/api/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timeline: {
            tracks: timeline.tracks,
            outputWidth: 1280,
            outputHeight: 720,
            fps: 30
          },
          mediaUrls
        })
      });

      if (!response.ok) throw new Error('Render request failed');

      const { jobId } = await response.json();
      setRenderStatus('rendering');
      startPolling(jobId);
    } catch (err) {
      console.error('[EditorModal] Render request error:', err);
      console.log('[EditorModal] Timeline state for future render:', JSON.stringify(timeline, null, 2));
      setRenderStatus('error');
    }
  };

  // Handle "Post to 3Speak" from editor — fetch rendered video, navigate to embed-studio
  const handlePostTo3Speak = async (outputUrl) => {
    if (!outputUrl) return;

    try {
      setRenderStatus('preparing');
      console.log('[EditorModal] Post to 3Speak: fetching', outputUrl);

      // Fetch the rendered video as a blob
      const res = await fetch(outputUrl);
      if (!res.ok) throw new Error(`Failed to fetch rendered video: ${res.status}`);
      const contentType = res.headers.get('content-type') || '';
      if (contentType.startsWith('text/')) {
        throw new Error(`Expected video file but got ${contentType}`);
      }
      const blob = await res.blob();
      const file = new File([blob], 'rendered-video.mp4', { type: blob.type || 'video/mp4' });
      console.log('[EditorModal] Post to 3Speak: fetched', file.size, 'bytes, type:', file.type);

      // Calculate video duration
      try {
        const video = document.createElement('video');
        video.preload = 'metadata';
        const duration = await new Promise((resolve) => {
          video.onloadedmetadata = () => {
            URL.revokeObjectURL(video.src);
            resolve(video.duration);
          };
          video.onerror = () => resolve(0);
          video.src = URL.createObjectURL(file);
        });
        setVideoDuration(duration);
      } catch { /* duration will be 0 */ }

      // Generate thumbnails from the video file (with timeout to avoid hanging)
      try {
        const thumbs = await Promise.race([
          generateVideoThumbnails(file, 2, 'url'),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Thumbnail timeout')), 10000))
        ]);
        setGeneratedThumbnail(thumbs);
      } catch (thumbErr) {
        console.warn('[EditorModal] Thumbnail generation failed, continuing without:', thumbErr);
      }

      // Force-close the editor without confirmation
      setEditorReady(false);
      setRenderStatus(null);
      setRenderProgress(0);
      setRenderedVideoUrl(null);
      setResolvedUrl(null);
      setResolveError(false);
      mediaLoadedRef.current = false;
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      onClose();

      // Pre-set the file in embed context
      setVideoFile(file);
      setPrevVideoFile(file);

      // Set original author/permlink for credit attribution
      if (originalAuthor) setOriginalAuthor(originalAuthor);
      if (originalPermlink) setOriginalPermlink(originalPermlink);
      if (originalShortPermlink) setOriginalShortPermlink(originalShortPermlink);

      // Remix from shorts should use the short upload form (no title/tags)
      setFromStories(true);

      // Pre-populate beneficiary list with locked minimums. Pro
      // subscribers skip the threespeakfund 10% — but the remix-author
      // 5% attribution always stays.
      const lockedBeneficiaries = getLockedBeneficiaries({
        isPremium,
        originalAuthor: originalAuthor || null,
      });
      setList(lockedBeneficiaries);
      const usedPercent = lockedBeneficiaries.reduce((sum, b) => sum + b.percent, 0);
      setRemaingPercent(100 - usedPercent);

      // Navigate to embed-studio thumbnail step (video uploads at publish time)
      navigate('/embed-studio/thumbnail?from=stories');
    } catch (err) {
      console.error('[EditorModal] Post to 3Speak failed:', err);
      setRenderStatus('post-error');
    }
  };

  // Poll render status
  const startPolling = (jobId) => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);

    pollIntervalRef.current = setInterval(async () => {
      try {
        const response = await fetch(`/api/render/${jobId}`);
        const data = await response.json();

        setRenderProgress(data.progress || 0);

        if (data.status === 'complete') {
          clearInterval(pollIntervalRef.current);
          setRenderStatus('complete');
          setRenderedVideoUrl(data.outputUrl);
        } else if (data.status === 'error') {
          clearInterval(pollIntervalRef.current);
          setRenderStatus('error');
        }
      } catch {
        // Keep polling on transient errors
      }
    }, 2000);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, []);

  const handleClose = (opts) => {
    if (editorReady && opts?.confirmed !== true && !window.confirm('Are you sure you want to close the editor? Unsaved changes will be lost.')) {
      return;
    }
    setEditorReady(false);
    setRenderStatus(null);
    setRenderProgress(0);
    setRenderedVideoUrl(null);
    setResolvedUrl(null);
    setResolveError(false);
    mediaLoadedRef.current = false;
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    onClose();
  };

  const handleUseRenderedVideo = () => {
    if (renderedVideoUrl) {
      window.open(renderedVideoUrl, '_blank');
    }
    handleClose();
  };

  if (!isOpen) return null;

  // Portaled to <body> so nothing on the page behind (nav, shorts controls,
  // transformed containers) can sit above the backdrop and take the click.
  // Portal events still bubble through the React tree, so stop them here
  // before they reach the page's own click/touch handlers.
  const stop = (e) => e.stopPropagation();
  return createPortal(
    <div
      className="editor-modal"
      onClick={stop}
      onMouseDown={stop}
      onPointerDown={stop}
      onTouchStart={stop}
      onTouchEnd={stop}
      onWheel={stop}
    >
      <div className="editor-modal-overlay" onClick={() => handleClose()}></div>
      <div className="editor-modal-content">
        <div className="editor-modal-body">
          {/* Show iframe only after a working URL is resolved */}
          {resolvedUrl && (
            <iframe
              ref={iframeRef}
              src={`${resolvedUrl}?compact=true`}
              className="editor-iframe"
              allow="cross-origin-isolated; camera; microphone; fullscreen"
              allowFullScreen
              title="3Speak Video Editor"
            />
          )}

          {/* Loading overlay — resolving URL or waiting for editor ready */}
          {(resolving || (!editorReady && !resolveError)) && (
            <div className="editor-loading-overlay">
              <Loader2 size={40} className="spinner" />
              <span>{resolving ? 'Finding available editor...' : 'Loading editor...'}</span>
            </div>
          )}

          {/* Error: no editor available */}
          {resolveError && (
            <div className="editor-loading-overlay">
              <span>No editor server is currently available. Please try again later.</span>
              <button className="render-btn" onClick={handleClose} style={{ marginTop: 16 }}>
                Close
              </button>
            </div>
          )}

          {/* Render status overlay */}
          {renderStatus && (
            <div className="render-overlay">
              {renderStatus === 'sending' && (
                <div className="render-status">
                  <Loader2 size={32} className="spinner" />
                  <span>Sending to render service...</span>
                </div>
              )}
              {renderStatus === 'rendering' && (
                <div className="render-status">
                  <div className="render-progress-bar">
                    <div className="render-progress-fill" style={{ width: `${renderProgress}%` }} />
                  </div>
                  <span>Rendering... {Math.round(renderProgress)}%</span>
                </div>
              )}
              {renderStatus === 'complete' && (
                <div className="render-status">
                  <span>Render complete!</span>
                  <button className="render-btn" onClick={handleUseRenderedVideo}>
                    Use Video
                  </button>
                </div>
              )}
              {renderStatus === 'preparing' && (
                <div className="render-status">
                  <Loader2 size={32} className="spinner" />
                  <span>Preparing video for upload...</span>
                </div>
              )}
              {renderStatus === 'error' && (
                <div className="render-status render-error">
                  <span>Render service not available yet. Timeline data logged to console.</span>
                  <button className="render-btn" onClick={() => setRenderStatus(null)}>
                    Back to Editor
                  </button>
                </div>
              )}
              {renderStatus === 'post-error' && (
                <div className="render-status render-error">
                  <span>Failed to prepare video for upload. Please try downloading instead.</span>
                  <button className="render-btn" onClick={() => setRenderStatus(null)}>
                    Back to Editor
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

export default EditorModal;
