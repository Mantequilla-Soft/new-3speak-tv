import { useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { UPLOADS_PAUSED } from '../utils/config';
import { useSupportBlock } from './supportBlockStore';

// Every upload paused at once (VITE_UPLOADS_PAUSED=true): when the image or audio
// servers are down, an upload would publish without its thumbnail or fail half
// way (owner 2026-11-24). Each way into an upload asks blockIfUploadsPaused()
// first; the popup says so and points to Discord for updates.

/** True (and the popup shown) when uploads are paused: the caller stops there. */
export function blockIfUploadsPaused() {
  if (!UPLOADS_PAUSED) return false;
  useSupportBlock.getState().showSupportBlock('paused');
  return true;
}

/** An upload page opened by its URL while uploads are paused: the popup, then Home. */
function UploadsPausedRedirect() {
  useEffect(() => { blockIfUploadsPaused(); }, []);
  return <Navigate to="/" replace />;
}

/** The route element, or the redirect while uploads are paused. */
export const uploadRoute = (element) => (UPLOADS_PAUSED ? <UploadsPausedRedirect /> : element);
