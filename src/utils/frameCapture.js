// Grab the frame a <video> is showing as a JPEG data URL, on browsers that make
// that hard. Firefox for Android (seen on 159) decodes video in hardware and
// reads such frames back wrong: pure black through a 2D canvas, one flat dark
// purple through WebGL, "format null" through VideoFrame, paused or playing,
// and has no VideoDecoder. What it does do: our API decodes the frame from the
// file (serverFrame.js).
//
// Mobile devices go to the API first. Desktops, and mobiles when the API can't help
// (not an MP4/MOV, offline), tries in turn: 2D canvas, VideoFrame.copyTo, WebGL;
// the frame decoded from the file in software (softwareFrame.js, needs a
// VideoDecoder); the first three again while playing; the hidden-video path;
// then the API. Each result is checked before it is trusted: a frame that is
// one flat colour is a failed readback, never a real picture.
import { captureFrameAt, isMobileDevice } from './videoThumbnails';
import { videoFrameToCanvas } from './videoFrameImage';

const JPEG_QUALITY = 0.9;
// Spread between the darkest and brightest value of any colour channel in a
// downscaled copy at or below which the grab counts as one flat colour.
const FLAT_SPREAD = 10;

/** True when a drawable source (canvas, image) is one flat colour (black, purple, ...). */
function isBlank(source, width, height) {
  try {
    const c = document.createElement('canvas');
    c.width = 32;
    c.height = Math.max(1, Math.round((32 * height) / width));
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(source, 0, 0, c.width, c.height);
    const px = ctx.getImageData(0, 0, c.width, c.height).data;
    const lo = [255, 255, 255];
    const hi = [0, 0, 0];
    for (let i = 0; i < px.length; i += 4) {
      for (let k = 0; k < 3; k += 1) {
        if (px[i + k] < lo[k]) lo[k] = px[i + k];
        if (px[i + k] > hi[k]) hi[k] = px[i + k];
      }
    }
    return Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) <= FLAT_SPREAD;
  } catch {
    return false; // can't tell: don't throw a possibly good frame away
  }
}

function grab2d(video, w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d').drawImage(video, 0, 0, w, h);
  if (isBlank(c, w, h)) return null;
  return c.toDataURL('image/jpeg', JPEG_QUALITY);
}

// WebCodecs: VideoFrame(video).copyTo() reads the pixels out through its own
// path (where the browser gives the frame a readable format at all).
async function grabVideoFrame(video) {
  if (typeof window.VideoFrame !== 'function') throw new Error('no VideoFrame');
  const frame = new window.VideoFrame(video);
  try {
    const c = await videoFrameToCanvas(frame);
    if (isBlank(c, c.width, c.height)) return null;
    return c.toDataURL('image/jpeg', JPEG_QUALITY);
  } finally {
    frame.close();
  }
}

const VERT = 'attribute vec2 p;varying vec2 uv;void main(){uv=vec2((p.x+1.)*.5,1.-(p.y+1.)*.5);gl_Position=vec4(p,0.,1.);}';
const FRAG = 'precision mediump float;uniform sampler2D t;varying vec2 uv;void main(){gl_FragColor=texture2D(t,uv);}';

function grabWebGL(video, w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const gl = c.getContext('webgl', { preserveDrawingBuffer: true, alpha: false, antialias: false })
    || c.getContext('experimental-webgl', { preserveDrawingBuffer: true, alpha: false });
  if (!gl) throw new Error('no webgl');
  try {
    const max = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    if (w > max || h > max) throw new Error(`frame ${w}x${h} > texture ${max}`);
    const shader = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    // Any size works with clamp + linear and no mipmaps (WebGL 1 rule).
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);

    gl.viewport(0, 0, w, h);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    if (isBlank(c, w, h)) return null;
    return c.toDataURL('image/jpeg', JPEG_QUALITY);
  } finally {
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

// Resolves once the playing video has put a new frame on screen.
function nextFrame(video) {
  return new Promise((resolve) => {
    const done = () => resolve();
    if (typeof video.requestVideoFrameCallback === 'function') video.requestVideoFrameCallback(done);
    else requestAnimationFrame(() => requestAnimationFrame(done));
    setTimeout(done, 700);
  });
}

function isBlankDataUrl(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(isBlank(img, img.naturalWidth || 16, img.naturalHeight || 9));
    img.onerror = () => resolve(true);
    img.src = dataUrl;
  });
}

/**
 * The frame `video` shows (paused, on screen) as { dataUrl, method, tried }.
 * dataUrl is null when every way came back blank or failed; `tried` lists
 * each attempt ("2d:blank", "webgl:ok", "webgl:error <msg>", ...).
 */
export async function captureVideoFrame(video, { file } = {}) {
  const w = video.videoWidth;
  const h = video.videoHeight;
  const tried = [];
  const attempt = async (name, fn) => {
    if (!w || !h) { tried.push(`${name}:no-size`); return null; }
    try {
      const out = await fn(video, w, h);
      tried.push(`${name}:${out ? 'ok' : 'blank'}`);
      return out;
    } catch (err) {
      tried.push(`${name}:error ${String(err?.message || err).slice(0, 60)}`);
      return null;
    }
  };
  // Each way in turn until one gives a real picture; `suffix` names the round.
  const round = async (suffix) => {
    for (const [name, fn] of [['2d', grab2d], ['videoframe', grabVideoFrame], ['webgl', grabWebGL]]) {
      const out = await attempt(`${name}${suffix}`, fn);
      if (out) return { out, name: `${name}${suffix}` };
    }
    return null;
  };

  // Decoded by our API from the stretch of the file the frame needs (MP4/MOV,
  // H.264 / HEVC). Sends data, so only first on mobile devices, else last.
  let serverTried = false;
  const viaServer = async () => {
    serverTried = true;
    try {
      const { serverFrameFromFile } = await import('./serverFrame');
      const c = await serverFrameFromFile(file, video.currentTime);
      if (isBlank(c, c.width, c.height)) { tried.push('server:blank'); return null; }
      tried.push('server:ok');
      return c.toDataURL('image/jpeg', JPEG_QUALITY);
    } catch (err) {
      tried.push(`server:error ${String(err?.message || err).slice(0, 80)}`);
      return null;
    }
  };

  // 0. Mobile devices: the API first (their browsers read video frames back
  // black or garbled, e.g. Firefox for Android).
  if (file && isMobileDevice()) {
    const out = await viaServer();
    if (out) return { dataUrl: out, method: 'server', tried };
  }

  // 1. As it is (paused).
  let hit = await round('');
  let dataUrl = hit?.out || null;
  let method = hit?.name || null;

  // 2. Decoded from the file in software (MP4/MOV), bypassing the <video>.
  if (!dataUrl && file) {
    try {
      const { decodeFrameFromFile } = await import('./softwareFrame');
      const c = await decodeFrameFromFile(file, video.currentTime);
      if (isBlank(c, c.width, c.height)) tried.push('decode:blank');
      else {
        dataUrl = c.toDataURL('image/jpeg', JPEG_QUALITY);
        method = 'decode';
        tried.push('decode:ok');
      }
    } catch (err) {
      tried.push(`decode:error ${String(err?.message || err).slice(0, 80)}`);
    }
  }

  // 3. While playing: some decoders only hand over frames they're presenting.
  if (!dataUrl) {
    const at = video.currentTime;
    try {
      await video.play();
      await nextFrame(video);
      hit = await round('-playing');
      dataUrl = hit?.out || null;
      method = hit?.name || null;
    } catch (err) {
      tried.push(`play:error ${String(err?.message || err).slice(0, 60)}`);
    } finally {
      video.pause();
      video.currentTime = at;
    }
  }

  // 4. The off-screen path the generator uses, from the file itself.
  if (!dataUrl && file) {
    try {
      const out = await captureFrameAt(file, video.currentTime);
      if (await isBlankDataUrl(out)) tried.push('hidden:blank');
      else { dataUrl = out; method = 'hidden'; tried.push('hidden:ok'); }
    } catch (err) {
      tried.push(`hidden:error ${String(err?.message || err).slice(0, 60)}`);
    }
  }

  // 5. The API, if not tried first already.
  if (!dataUrl && file && !serverTried) {
    dataUrl = await viaServer();
    if (dataUrl) method = 'server';
  }

  return { dataUrl, method, tried };
}
