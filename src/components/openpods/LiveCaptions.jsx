import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StreamCaptions, useLiveCaptions } from '@snapie/hangouts-react';
import { DockTile, Icon } from '../v2/ui';
import './LiveCaptions.scss';

/**
 * Live captions on the watch surfaces (H11). The host's studio sends the text
 * on the stream's data channel; here it is shown over the picture (never in
 * the video itself), translated into the site language on the viewer's own
 * device where the browser can (Chrome's built-in Translator), else in the
 * original language with a note. Everything must be inside <StandaloneWatch>.
 */

const PREF_KEY = 'live-captions-on';

/** The viewer's CC choice, remembered. On by default: the host chose to caption. */
export function useCaptionsPref() {
  const [on, setOn] = useState(() => {
    try { return localStorage.getItem(PREF_KEY) !== '0'; } catch { return true; }
  });
  const toggle = useCallback(() => {
    setOn((v) => {
      try { localStorage.setItem(PREF_KEY, v ? '0' : '1'); } catch { /* storage off */ }
      return !v;
    });
  }, []);
  return [on, toggle];
}

/** The captions over the player. */
export function LiveCaptionsOverlay({ show, className }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage || i18n.language || 'en';
  const labels = useMemo(() => ({
    translatedFrom: t('liveCaptions.viewer.translatedFrom'),
    showOriginal: t('liveCaptions.viewer.showOriginal'),
    translateTo: t('liveCaptions.viewer.translateTo'),
    noTranslator: t('liveCaptions.viewer.noTranslator'),
  // `lang` re-reads the text after a language switch.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [t, lang]);
  return <StreamCaptions show={show} targetLang={lang} labels={labels} className={className} />;
}

/**
 * The CC switch, only while the host has captions running.
 * `variant`: 'rail' (phone action rail), 'dock' (the tile dock under the
 * player) or 'overlay' (a chip over the player).
 */
export function LiveCaptionsToggle({ on, onToggle, variant = 'dock' }) {
  const { t } = useTranslation();
  const { available } = useLiveCaptions();
  if (!available) return null;
  const icon = on ? 'closed_caption' : 'closed_caption_disabled';
  const title = on ? t('liveCaptions.viewer.hide') : t('liveCaptions.viewer.show');
  const label = t('liveCaptions.viewer.label');
  if (variant === 'rail') {
    return (
      <div className="actionItem" onClick={onToggle} role="button" aria-pressed={on} title={title}>
        <div className={`actionButton${on ? ' liked' : ''}`}><Icon name={icon} size={24} fill={on} /></div>
        <span className="actionLabel">{label}</span>
      </div>
    );
  }
  if (variant === 'overlay') {
    return (
      <button
        type="button"
        className={`live-captions-chip${on ? ' is-on' : ''}`}
        onClick={(e) => { e.stopPropagation(); onToggle(); }}
        aria-pressed={on}
        title={title}
        aria-label={title}
      >
        <Icon name={icon} size={18} />
      </button>
    );
  }
  return <DockTile icon={icon} label={label} active={on} onClick={onToggle} title={title} />;
}
