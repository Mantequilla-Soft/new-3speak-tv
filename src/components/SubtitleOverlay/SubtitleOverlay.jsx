import { useMemo } from 'react';
import './SubtitleOverlay.scss';

// On the v2 type scale (STYLE_GUIDE 3), so captions grow in the same steps as the rest.
const FONT_SIZES = { small: '14px', medium: '18px', large: '24px', 'x-large': '28px', 'xx-large': '32px' };
const FONT_SIZES_MOBILE = { small: '11px', medium: '14px', large: '18px', 'x-large': '20px', 'xx-large': '24px' };
const FONT_SIZES_FULLSCREEN = { small: '18px', medium: '24px', large: '32px', 'x-large': '40px', 'xx-large': '48px' };

export const SUBTITLE_FONTS = {
  'sans-serif': 'system-ui, -apple-system, sans-serif',
  'serif': 'Georgia, "Times New Roman", serif',
  'monospace': '"Courier New", Courier, monospace',
  'arial': 'Arial, Helvetica, sans-serif',
  'verdana': 'Verdana, Geneva, sans-serif',
  'georgia': 'Georgia, serif',
  'times': '"Times New Roman", Times, serif',
  'courier': '"Courier New", Courier, monospace',
  'comic-sans': '"Comic Sans MS", "Comic Sans", cursive',
  'impact': 'Impact, "Arial Black", sans-serif',
};

/**
 * Renders active subtitle text over the video.
 * Place inside a position:relative container (e.g. .video-iframe-wrapper).
 */
function SubtitleOverlay({ currentTime, cues, style = {} }) {
  const activeText = useMemo(() => {
    if (!cues || cues.length === 0) return null;
    for (const cue of cues) {
      if (currentTime >= cue.start && currentTime < cue.end) {
        return cue.text;
      }
    }
    return null;
  }, [currentTime, cues]);

  if (!activeText) return null;

  const {
    fontSize = 'medium',
    color = '#ffffff',
    bgOpacity = 0.7,
    fontFamily = 'sans-serif',
    borderWidth = 0,
    borderColor = '#000000',
  } = style;

  const resolvedFont = SUBTITLE_FONTS[fontFamily] || SUBTITLE_FONTS['sans-serif'];
  const strokeWidth = borderWidth > 0 ? `${borderWidth}px` : '0px';

  return (
    <div
      className="subtitle-overlay"
      style={{
        '--sub-font-size': FONT_SIZES[fontSize] || FONT_SIZES.medium,
        '--sub-font-size-mobile': FONT_SIZES_MOBILE[fontSize] || FONT_SIZES_MOBILE.medium,
        '--sub-font-size-fullscreen': FONT_SIZES_FULLSCREEN[fontSize] || FONT_SIZES_FULLSCREEN.medium,
        '--sub-color': color,
        '--sub-bg': `color-mix(in srgb, var(--media-black) ${Math.round(bgOpacity * 100)}%, transparent)`,
        '--sub-font-family': resolvedFont,
        '--sub-stroke-width': strokeWidth,
        '--sub-stroke-color': borderColor,
      }}
    >
      <span className="subtitle-overlay-text">{activeText}</span>
    </div>
  );
}

export default SubtitleOverlay;
