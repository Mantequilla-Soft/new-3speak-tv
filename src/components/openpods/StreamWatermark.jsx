import { useCallback, useEffect, useRef, useState } from 'react';
import logoDark from '../../assets/image/3S_logodark.png';
import './StreamWatermark.scss';

/**
 * The free-tier "3Speak" mark, drawn by the PAGE over a stream that came in
 * from OBS.
 *
 * A browser studio burns this logo into its program feed (the SDK's
 * drawWatermark, fed the same 3S_logodark.png through `watermarkLogoUrl`). A
 * stream from OBS never passes through that canvas, so for a free host the
 * server marks the room `headless && watermark` and every viewer page draws the
 * same mark here instead.
 *
 * Same geometry as drawWatermark with a logo: top-left of the picture, a margin
 * of 16/720 of the frame height, the logo 6% of the frame height, 90% opacity.
 * "The picture" is the part of the video frame the viewer actually sees: inside
 * the letterbox for `object-fit: contain`, and the box itself when a phone crops
 * a landscape stream with `cover` (otherwise the mark would slide off-screen as
 * the viewer pans). The fit is read from the <video>'s computed style, so it
 * follows the crop switch without being told.
 *
 * Render it as a child of the positioned box the stream video fills, next to
 * LiveAdLayer.
 */
export default function StreamWatermark({ show = false }) {
  const layerRef = useRef(null);
  const [video, setVideo] = useState(null);
  const [pos, setPos] = useState(null); // { left, top, height } in px, relative to the layer

  // The SDK mounts its <video> only once the track arrives and may swap it.
  useEffect(() => {
    if (!show) return undefined;
    const box = layerRef.current?.parentElement;
    if (!box) return undefined;
    const find = () => setVideo(box.querySelector('video.hh-stream-video__el') || box.querySelector('video'));
    find();
    const mo = new MutationObserver(find);
    mo.observe(box, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [show]);

  const measure = useCallback(() => {
    const layer = layerRef.current;
    if (!layer || !video) { setPos(null); return; }
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const r = video.getBoundingClientRect();
    const l = layer.getBoundingClientRect();
    if (!vw || !vh || !r.width || !r.height) { setPos(null); return; }
    const cover = getComputedStyle(video).objectFit === 'cover';
    const scale = cover ? Math.max(r.width / vw, r.height / vh) : Math.min(r.width / vw, r.height / vh);
    const fh = vh * scale;
    const fw = vw * scale;
    // Visible part of the frame: the letterboxed frame (contain) or the box (cover).
    const visLeft = cover ? r.left : r.left + (r.width - fw) / 2;
    const visTop = cover ? r.top : r.top + (r.height - fh) / 2;
    const margin = (16 / 720) * fh;
    const next = {
      left: Math.round(visLeft - l.left + margin),
      top: Math.round(visTop - l.top + margin),
      height: Math.max(12, Math.round(fh * 0.06)),
    };
    // Dragging the crop rewrites a style var many times a second; skip the
    // re-render when nothing moved.
    setPos((p) => (p && p.left === next.left && p.top === next.top && p.height === next.height ? p : next));
  }, [video]);

  useEffect(() => {
    if (!show || !video) return undefined;
    const raf = requestAnimationFrame(measure);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(video);
    if (layerRef.current) ro?.observe(layerRef.current);
    video.addEventListener('loadedmetadata', measure);
    video.addEventListener('resize', measure);
    // The crop switch changes object-fit with a class, which resizes nothing.
    const mo = new MutationObserver(measure);
    let el = video;
    for (let i = 0; i < 4 && el; i += 1) {
      mo.observe(el, { attributes: true, attributeFilter: ['class', 'style'] });
      el = el.parentElement;
    }
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      mo.disconnect();
      video.removeEventListener('loadedmetadata', measure);
      video.removeEventListener('resize', measure);
      window.removeEventListener('resize', measure);
    };
  }, [show, video, measure]);

  if (!show) return null;
  return (
    <div ref={layerRef} className="stream-watermark" aria-hidden="true">
      {pos && (
        <img
          className="stream-watermark__logo"
          src={logoDark}
          alt=""
          draggable={false}
          style={{ left: pos.left, top: pos.top, height: pos.height }}
        />
      )}
    </div>
  );
}
