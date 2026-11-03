// A WebCodecs VideoFrame as a canvas, by copying its pixels out (copyTo), not
// by drawing it: drawing goes through the same GPU readback that fails on
// Firefox for Android. RGBA if the browser converts; else its native I420 /
// NV12, converted here with the frame's own colour matrix and range.

const clampByte = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

// [R from V, G from U, G from V, B from U] per matrix (Kr/Kb based).
const MATRICES = {
  bt601: [1.402, 0.344136, 0.714136, 1.772],
  bt709: [1.5748, 0.187324, 0.468124, 1.8556],
};

/**
 * The frame's YUV → RGB matrix and range, from its colour space; untagged
 * video follows the usual rule (HD and up = BT.709, SD = BT.601, limited range).
 */
export function colourOf(colorSpace, height) {
  const m = colorSpace?.matrix;
  const matrix = m === 'bt709' ? 'bt709'
    : (m === 'smpte170m' || m === 'bt470bg') ? 'bt601'
      : height >= 720 ? 'bt709' : 'bt601';
  return { matrix, fullRange: colorSpace?.fullRange === true };
}

export function yuvToRgba(format, buf, layout, w, h, colour = colourOf(null, h)) {
  const out = new Uint8ClampedArray(w * h * 4);
  const [rv, gu, gv, bu] = MATRICES[colour.matrix] || MATRICES.bt601;
  // Limited range: Y 16..235, chroma 16..240 → scale to full.
  const ys = colour.fullRange ? 1 : 255 / 219;
  const yo = colour.fullRange ? 0 : 16;
  const cs = colour.fullRange ? 1 : 255 / 224;
  const [yL, uL, vL] = layout;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const Y = buf[yL.offset + y * yL.stride + x];
      let U;
      let V;
      if (format === 'NV12') {
        const o = uL.offset + (y >> 1) * uL.stride + (x >> 1) * 2;
        U = buf[o];
        V = buf[o + 1];
      } else {
        U = buf[uL.offset + (y >> 1) * uL.stride + (x >> 1)];
        V = buf[vL.offset + (y >> 1) * vL.stride + (x >> 1)];
      }
      const c = (Y - yo) * ys;
      const d = (U - 128) * cs;
      const e = (V - 128) * cs;
      const i = (y * w + x) * 4;
      out[i] = clampByte(c + rv * e);
      out[i + 1] = clampByte(c - gu * d - gv * e);
      out[i + 2] = clampByte(c + bu * d);
      out[i + 3] = 255;
    }
  }
  return out;
}

/**
 * The frame as a canvas at its display size, turned by `rotation` degrees
 * clockwise (0/90/180/270; the MP4 track's rotation, which a <video> applies
 * itself). Throws for pixel formats it can't read (null = GPU only, 10-bit, ...).
 */
export async function videoFrameToCanvas(frame, rotation = 0) {
  const w = frame.visibleRect?.width || frame.codedWidth;
  const h = frame.visibleRect?.height || frame.codedHeight;
  const rect = frame.visibleRect
    ? { x: frame.visibleRect.x, y: frame.visibleRect.y, width: w, height: h }
    : undefined;
  let rgba;
  try {
    const buf = new Uint8Array(frame.allocationSize({ format: 'RGBA', rect }));
    await frame.copyTo(buf, { format: 'RGBA', rect });
    rgba = new Uint8ClampedArray(buf.buffer);
  } catch {
    const fmt = frame.format;
    if (fmt !== 'I420' && fmt !== 'NV12') throw new Error(`format ${fmt}`);
    const buf = new Uint8Array(frame.allocationSize({ rect }));
    const layout = await frame.copyTo(buf, { rect });
    rgba = yuvToRgba(fmt, buf, layout, w, h, colourOf(frame.colorSpace, h));
  }
  const raw = document.createElement('canvas');
  raw.width = w;
  raw.height = h;
  raw.getContext('2d').putImageData(new ImageData(rgba, w, h), 0, 0);

  // Display size can differ from the coded size (non-square pixels); then turn.
  return drawTurned(raw, frame.displayWidth || w, frame.displayHeight || h, rotation);
}

/**
 * `source` drawn at w x h, turned by `rotation` degrees clockwise (0/90/180/270),
 * as a canvas. Returns `source` itself when there is nothing to do.
 */
export function drawTurned(source, w, h, rotation = 0) {
  const turn = ((Math.round(rotation / 90) * 90) % 360 + 360) % 360;
  const side = turn === 90 || turn === 270;
  const sw = source.width;
  const sh = source.height;
  if (sw === w && sh === h && !turn && source instanceof HTMLCanvasElement) return source;
  const out = document.createElement('canvas');
  out.width = side ? h : w;
  out.height = side ? w : h;
  const ctx = out.getContext('2d');
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate((turn * Math.PI) / 180);
  ctx.drawImage(source, -w / 2, -h / 2, w, h);
  return out;
}
