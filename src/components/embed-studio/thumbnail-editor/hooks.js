import { useCallback, useEffect, useRef, useState } from 'react';
import { exportThumbnail, loadImage, loadLayerAssets } from './renderThumbnail';

/** The decoded picture for `src`, or null while it loads (or without one). */
export function useLoadedImage(src) {
  const [loaded, setLoaded] = useState({ src: null, image: null });
  useEffect(() => {
    if (!src) return undefined;
    let live = true;
    loadImage(src).then((image) => { if (live) setLoaded({ src, image }); }).catch(() => {});
    return () => { live = false; };
  }, [src]);
  return loaded.src === src ? loaded.image : null;
}

/**
 * Bumps whenever something the layers draw with (a font, a sticker picture) has
 * finished loading, so canvases that drew without it redraw. Include the value
 * in their effect deps.
 */
export function useAssetsVersion(layers) {
  const [version, setVersion] = useState(0);
  const needs = layers.filter((l) => l.type === 'text' || l.type === 'sticker');
  const wanted = needs.map((l) => (l.type === 'text' ? `t:${l.font}:${l.text}` : `s:${l.url}`)).join('\u0001');
  useEffect(() => {
    if (!wanted) return undefined;
    let live = true;
    loadLayerAssets(needs).then(() => { if (live) setVersion((v) => v + 1); });
    return () => { live = false; };
  }, [wanted]);
  return version;
}

/**
 * Renders the finished thumbnail a moment after the edit settles and hands it to
 * `onExport({ blob, dataUrl })`. `flush()` renders right away (and waits for it),
 * for the step's Proceed. Nothing happens without a picture.
 */
export function useThumbnailExport({ image, edit, width, height, assetsVersion, onExport, delay = 250 }) {
  const timer = useRef(null);
  const latest = useRef(null);
  latest.current = { image, edit, width, height, onExport };
  const pending = useRef(Promise.resolve());

  const run = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = null;
    const job = latest.current;
    if (!job.image) return Promise.resolve();
    pending.current = exportThumbnail(job).then((out) => {
      // A newer edit may have started meanwhile; only the latest one counts.
      if (latest.current.edit === job.edit && latest.current.image === job.image) job.onExport(out);
    }).catch((err) => {
      // e.g. a sticker host without CORS: the canvas refuses to export.
      console.warn('[thumbnail] export failed', err);
    });
    return pending.current;
  }, []);

  useEffect(() => {
    if (!image) return undefined;
    clearTimeout(timer.current);
    timer.current = setTimeout(run, delay);
    return () => clearTimeout(timer.current);
  }, [image, edit, width, height, assetsVersion, delay, run]);

  return useCallback(() => (timer.current ? run() : pending.current), [run]);
}
