import React, { useLayoutEffect, useRef, useState } from 'react';
import { clampFrame, frameRect, renderThumbnail } from './renderThumbnail';
import { updateLayer } from './editState';

// Within this share of the width/height of the middle, a dragged layer snaps to it.
const SNAP = 0.015;
// Extra grab margin around a layer's box, in output pixels.
const HIT_PAD = 16;

/**
 * The thumbnail, drawn at full output size (CSS scales it down) with the same
 * renderer as the export. In the editor, dragging a layer moves it and dragging
 * anywhere else moves the zoomed picture. `readOnly` (the step page) only shows
 * the result: no guides, no dragging, a click calls `onActivate`.
 */
export default function ThumbnailCanvas({
  image, edit, width, height, assetsVersion,
  selectedId, onSelect, onChange, label,
  readOnly = false, onActivate,
}) {
  const canvasRef = useRef(null);
  const boxesRef = useRef({});
  const dragRef = useRef(null);
  const [snap, setSnap] = useState({ snapX: false, snapY: false });
  const [dragging, setDragging] = useState(null); // 'layer' | 'frame' | null
  const [overLayer, setOverLayer] = useState(false);

  useLayoutEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    boxesRef.current = renderThumbnail(ctx, {
      image, edit, width, height,
      guides: readOnly ? null : { selectedId, ...snap },
    });
  }, [image, edit, width, height, selectedId, snap, assetsVersion, readOnly]);

  // Pointer position in output pixels.
  const toCanvas = (e) => {
    const r = canvasRef.current.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * width, y: ((e.clientY - r.top) / r.height) * height };
  };

  const hitLayer = ({ x, y }) => {
    // Topmost first: the last drawn wins.
    for (const layer of [...edit.layers].reverse()) {
      const b = boxesRef.current[layer.id];
      if (b && x >= b.x - HIT_PAD && x <= b.x + b.w + HIT_PAD && y >= b.y - HIT_PAD && y <= b.y + b.h + HIT_PAD) {
        return layer;
      }
    }
    return null;
  };

  const onPointerDown = (e) => {
    if (!image || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const at = toCanvas(e);
    const layer = hitLayer(at);
    if (layer) {
      onSelect(layer.id);
      dragRef.current = { kind: 'layer', id: layer.id, at, x: layer.x, y: layer.y };
    } else {
      onSelect(null);
      if (edit.frame.zoom <= 1) return;
      const { dw, dh, x, y } = frameRect(image, edit.frame, width, height);
      dragRef.current = { kind: 'frame', at, x, y, dw, dh };
    }
    setDragging(dragRef.current.kind);
    e.currentTarget.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  };

  const onPointerMove = (e) => {
    const d = dragRef.current;
    const at = toCanvas(e);
    if (!d) {
      // Hover only: show that text can be grabbed.
      const over = !!(image && hitLayer(at));
      if (over !== overLayer) setOverLayer(over);
      return;
    }
    const mx = at.x - d.at.x;
    const my = at.y - d.at.y;
    if (d.kind === 'layer') {
      let x = Math.min(1, Math.max(0, d.x + mx / width));
      let y = Math.min(1, Math.max(0, d.y + my / height));
      const snapX = Math.abs(x - 0.5) < SNAP;
      const snapY = Math.abs(y - 0.5) < SNAP;
      if (snapX) x = 0.5;
      if (snapY) y = 0.5;
      if (snapX !== snap.snapX || snapY !== snap.snapY) setSnap({ snapX, snapY });
      onChange(updateLayer(edit, d.id, { x, y }));
    } else {
      // The picture follows the pointer: its centre point moves the other way.
      const frame = { ...edit.frame, x: d.x - mx / d.dw, y: d.y - my / d.dh };
      onChange({ ...edit, frame: clampFrame(frame, image, width, height) });
    }
  };

  const endDrag = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setDragging(null);
    setSnap({ snapX: false, snapY: false });
  };

  if (readOnly) {
    return (
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        className="thumb-canvas is-readonly"
        role="button"
        tabIndex={0}
        aria-label={label}
        title={label}
        onClick={onActivate}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onActivate?.(); } }}
      />
    );
  }

  const pannable = image && edit.frame.zoom > 1;
  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className={[
        'thumb-canvas',
        pannable ? 'is-pannable' : '',
        overLayer ? 'is-over-layer' : '',
        dragging ? `is-dragging-${dragging}` : '',
      ].filter(Boolean).join(' ')}
      role="img"
      aria-label={label}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    />
  );
}
