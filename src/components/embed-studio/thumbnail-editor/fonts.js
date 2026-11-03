// Fonts for text on thumbnails: the video editor's set (3speak-editor
// index.html), so a look made there can be made here. All self-hosted through
// @fontsource (no Google Fonts hotlink, same as Roboto in main.jsx); the
// browser fetches a file only once something is drawn in it. Roboto 700 is
// already loaded app-wide. One weight each: the one a thumbnail wants.
import '@fontsource/anton/400.css';
import '@fontsource/bebas-neue/400.css';
import '@fontsource/montserrat/800.css';
import '@fontsource/oswald/700.css';
import '@fontsource/archivo-black/400.css';
import '@fontsource/titan-one/400.css';
import '@fontsource/bangers/400.css';
import '@fontsource/righteous/400.css';
import '@fontsource/poppins/700.css';
import '@fontsource/inter/700.css';
import '@fontsource/open-sans/700.css';
import '@fontsource/lato/700.css';
import '@fontsource/raleway/700.css';
import '@fontsource/nunito/700.css';
import '@fontsource/fredoka/700.css';
import '@fontsource/playfair-display/700.css';
import '@fontsource/merriweather/700.css';
import '@fontsource/lora/700.css';
import '@fontsource/permanent-marker/400.css';
import '@fontsource/lobster/400.css';
import '@fontsource/pacifico/400.css';
import '@fontsource/caveat/700.css';
import '@fontsource/dancing-script/700.css';
import '@fontsource/press-start-2p/400.css';
import '@fontsource/roboto-mono/700.css';

export const THUMB_FONTS = [
  // Bold and condensed: the classic thumbnail headline
  { key: 'anton', family: 'Anton', weight: 400 },
  { key: 'bebas', family: 'Bebas Neue', weight: 400 },
  { key: 'montserrat', family: 'Montserrat', weight: 800 },
  { key: 'oswald', family: 'Oswald', weight: 700 },
  { key: 'archivo', family: 'Archivo Black', weight: 400 },
  { key: 'titan', family: 'Titan One', weight: 400 },
  { key: 'bangers', family: 'Bangers', weight: 400 },
  { key: 'righteous', family: 'Righteous', weight: 400 },
  // Clean sans
  { key: 'poppins', family: 'Poppins', weight: 700 },
  { key: 'roboto', family: 'Roboto', weight: 700 },
  { key: 'inter', family: 'Inter', weight: 700 },
  { key: 'opensans', family: 'Open Sans', weight: 700 },
  { key: 'lato', family: 'Lato', weight: 700 },
  { key: 'raleway', family: 'Raleway', weight: 700 },
  { key: 'nunito', family: 'Nunito', weight: 700 },
  { key: 'fredoka', family: 'Fredoka', weight: 700 },
  // Serif
  { key: 'playfair', family: 'Playfair Display', weight: 700 },
  { key: 'merriweather', family: 'Merriweather', weight: 700 },
  { key: 'lora', family: 'Lora', weight: 700 },
  // Handwritten and script
  { key: 'marker', family: 'Permanent Marker', weight: 400 },
  { key: 'lobster', family: 'Lobster', weight: 400 },
  { key: 'pacifico', family: 'Pacifico', weight: 400 },
  { key: 'caveat', family: 'Caveat', weight: 700 },
  { key: 'dancing', family: 'Dancing Script', weight: 700 },
  // Special
  { key: 'pressstart', family: 'Press Start 2P', weight: 400 },
  { key: 'robotomono', family: 'Roboto Mono', weight: 700 },
];

export function fontFor(key) {
  return THUMB_FONTS.find((f) => f.key === key) || THUMB_FONTS[0];
}

/** The key for a family name as the video editor writes it ("Bebas Neue"). */
export function fontKeyForFamily(family) {
  return THUMB_FONTS.find((f) => f.family === family)?.key || THUMB_FONTS[0].key;
}

// Characters a font lacks (Cyrillic in Anton, CJK in all of them) fall back
// to the system sans-serif.
export function cssFont(font, px) {
  return `${font.weight} ${Math.round(px)}px "${font.family}", sans-serif`;
}

// A canvas never triggers a web-font download itself: it silently draws in the
// fallback. Ask for the font (and the subsets `text` needs) before drawing.
export function loadFont(key, text) {
  if (typeof document === 'undefined' || !document.fonts?.load) return Promise.resolve();
  return document.fonts.load(cssFont(fontFor(key), 64), text || 'Aa').catch(() => {});
}
