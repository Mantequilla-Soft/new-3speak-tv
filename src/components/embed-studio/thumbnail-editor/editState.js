// The thumbnail editor's state: one plain, serialisable object, so it can sit in
// the upload context and come back unchanged after Back from Details.
//
//   frame   how the chosen picture fills the thumbnail: `zoom` (1 = just covers
//           it) and the point of the picture at the centre (`x`, `y`, 0..1)
//   layers  drawn over the picture, bottom first. Each has an `id` and a `type`
//           that renderThumbnail.js looks up in LAYER_RENDERERS; a new kind of
//           layer is a new type there plus a tool in tools/index.js.

export const OUTPUT_SIZE = {
  landscape: { width: 1280, height: 720 },
  portrait: { width: 720, height: 1280 },
};

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;

export const DEFAULT_FRAME = Object.freeze({ zoom: 1, x: 0.5, y: 0.5 });

export function emptyEdit() {
  return { frame: { ...DEFAULT_FRAME }, layers: [] };
}

// "As it is": one shared object, so renders and exports of a plain picture
// compare equal from one render to the next.
export const NO_EDIT = Object.freeze({ frame: DEFAULT_FRAME, layers: Object.freeze([]) });

let layerSeq = 0;
const nextId = () => `l${Date.now().toString(36)}${(layerSeq += 1)}`;

// Size is a percentage of the thumbnail's height, so a layer looks the same in
// the preview, the export and either orientation.
export const TEXT_SIZE = { min: 4, max: 30, initial: 12 };
// Border thickness as a percentage of the text's size, so it scales with it.
export const BORDER_SIZE = { min: 2, max: 25, initial: 10 };
// The box behind text: padding, corner radius and its own border, all also a
// percentage of the text's size; opacity 0..100.
export const BOX = {
  padding: { min: 0, max: 80, initial: 30 },
  radius: { min: 0, max: 100, initial: 20 },
  border: { min: 0, max: 20, initial: 0 },
  opacity: { min: 0, max: 100, initial: 80 },
};

// Text defaults, also filled in for layers saved before a setting existed.
export const TEXT_DEFAULTS = {
  border: false,
  borderSize: BORDER_SIZE.initial,
  borderColor: '#111111',
  box: false,
  boxColor: '#000000',
  boxOpacity: BOX.opacity.initial,
  boxPadding: BOX.padding.initial,
  boxRadius: BOX.radius.initial,
  boxBorder: BOX.border.initial,
  boxBorderColor: '#ffffff',
};

export function newTextLayer(text, index = 0, style = {}) {
  return {
    id: nextId(),
    type: 'text',
    text,
    font: 'anton',
    size: TEXT_SIZE.initial,
    color: '#ffffff',
    align: 'center',
    ...TEXT_DEFAULTS,
    ...style,
    x: 0.5,
    // Each new one a bit lower, so they don't land on top of each other.
    y: Math.min(0.85, 0.5 + index * 0.15),
  };
}

// Sticker size: the longer side as a percentage of the thumbnail's height.
export const STICKER_SIZE = { min: 5, max: 100 };

export function newStickerLayer({ url, title, size }, index = 0) {
  return {
    id: nextId(),
    type: 'sticker',
    url,
    title,
    size,
    rotation: 0,
    // Staggered from the middle, like text.
    x: Math.min(0.85, 0.5 + index * 0.08),
    y: Math.min(0.85, 0.5 + index * 0.08),
  };
}

export function updateLayer(edit, id, patch) {
  return { ...edit, layers: edit.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)) };
}

export function removeLayer(edit, id) {
  return { ...edit, layers: edit.layers.filter((l) => l.id !== id) };
}
