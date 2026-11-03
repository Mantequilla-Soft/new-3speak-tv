// The video editor's pre-styled text boxes (3speak-editor
// src/utils/stickerPresets.js), as thumbnail text layers. The editor sizes in
// pixels of its own frame; here everything is relative to the text size (see
// editState.js), so the editor's values are converted once, below. Added from
// the Stickers tool, they are ordinary text layers: every setting stays editable.
import { fontKeyForFamily } from './fonts';

const EDITOR_PRESETS = [
  { id: 'caption', font: 'Montserrat', px: 44, color: '#ffffff', box: { color: '#000000', opacity: 75, radius: 10, padding: 14 } },
  { id: 'highlight', font: 'Montserrat', px: 48, color: '#111111', box: { color: '#ffd60a', opacity: 100, radius: 6, padding: 12 } },
  { id: 'brand', font: 'Poppins', px: 46, color: '#ffffff', box: { color: '#e53935', opacity: 100, radius: 12, padding: 14 } },
  { id: 'bubble', font: 'Nunito', px: 44, color: '#111111', box: { color: '#ffffff', opacity: 100, radius: 32, padding: 18 } },
  { id: 'outline', font: 'Inter', px: 42, color: '#ffffff', box: { color: '#000000', opacity: 0, radius: 12, padding: 14, border: 4, borderColor: '#ffffff' } },
  { id: 'neon', font: 'Bebas Neue', px: 64, color: '#39ff14', box: { color: '#0b0b12', opacity: 85, radius: 14, padding: 14, border: 4, borderColor: '#39ff14' } },
  { id: 'title', font: 'Anton', px: 80, color: '#ffffff' },
  { id: 'comic', font: 'Bangers', px: 72, color: '#ffd60a', box: { color: '#e53935', opacity: 100, radius: 8, padding: 12, border: 5, borderColor: '#111111' } },
  { id: 'marker', font: 'Permanent Marker', px: 52, color: '#ffffff' },
  { id: 'quote', font: 'Lora', px: 44, color: '#ffffff', box: { color: '#000000', opacity: 55, radius: 4, padding: 16 } },
  { id: 'tag', font: 'Poppins', px: 36, color: '#ffffff', box: { color: '#2f80ed', opacity: 100, radius: 40, padding: 12 } },
  { id: 'minimal', font: 'Inter', px: 40, color: '#ffffff' },
];

const pct = (v, px) => Math.round((v / px) * 100);

/** [{ id, style }]: `style` is spread into newTextLayer(). */
export const TEXT_PRESETS = EDITOR_PRESETS.map(({ id, font, px, color, box }) => ({
  id,
  style: {
    font: fontKeyForFamily(font),
    // The editor's 36..80 px on its frame read about right as 7..16 % here.
    size: Math.min(18, Math.max(6, Math.round(px / 5))),
    color,
    ...(box ? {
      box: true,
      boxColor: box.color,
      boxOpacity: box.opacity,
      boxRadius: pct(box.radius, px),
      boxPadding: pct(box.padding, px),
      boxBorder: pct(box.border || 0, px),
      boxBorderColor: box.borderColor || '#ffffff',
    } : {}),
  },
}));
