import { useTranslation } from 'react-i18next';
import { Clapperboard, ImagePlus } from 'lucide-react';
import MarkdownComposer from '../studio/MarkdownComposer';

export const SHORT_TEXT_MAX = 5000;

/**
 * The audiograms of one track (made in the audio editor), going out as 3Speak
 * Shorts once the track is posted: that is what they are for, so every one
 * goes (to drop one, remove it in the audio editor). Per
 * Short: its title and text (our post editor, previewed like a snap: a Short
 * is a reply like one) on the left, its thumbnail on the right (9:16, as the
 * Shorts are); the thumbnail opens the thumbnail editor (`onDesign`).
 */
export default function AudiogramShortsSection({ track, onChange, onDesign, disabled = false }) {
  const { t } = useTranslation();
  const list = track?.audiograms || [];
  if (!list.length) return null;
  const patch = (url, p) => onChange(list.map((a) => (a.url === url ? { ...a, ...p } : a)));
  return (
    <div className="audio-upload-shorts" data-testid="audiogram-shorts">
      <span className="audio-upload-reward-label">
        <Clapperboard size={13} aria-hidden="true" /> {t('audio.upload.shorts.sectionTitle', { count: list.length })}
      </span>
      <p className="audio-upload-shorts-help">{t('audio.upload.shorts.sectionHelp')}</p>
      {list.map((a, i) => (
        <div key={a.url} className="audio-upload-short">
          <div className="audio-upload-short-fields">
            <input
              type="text"
              className="audio-upload-post-tags"
              placeholder={t('audio.upload.shorts.titlePlaceholder')}
              aria-label={t('audio.upload.shorts.titleLabel', { n: i + 1 })}
              value={a.title}
              maxLength={120}
              disabled={disabled}
              onChange={(e) => patch(a.url, { title: e.target.value })}
            />
            <div className="audio-upload-short-text" role="group" aria-label={t('audio.upload.shorts.textLabel', { n: i + 1 })} aria-disabled={disabled || undefined}>
              <MarkdownComposer
                value={a.description}
                onChange={(v) => { if (!disabled) patch(a.url, { description: String(v ?? '').slice(0, SHORT_TEXT_MAX) }); }}
                placeholder={t('audio.upload.shorts.textPlaceholder')}
                previewContext="snap"
              />
            </div>
          </div>
          <button
            type="button"
            className="audio-upload-short-thumb"
            onClick={() => onDesign(a.url)}
            disabled={disabled}
            title={t('audio.upload.shorts.designThumb')}
            aria-label={t('audio.upload.shorts.thumbLabel', { n: i + 1 })}
          >
            {a.thumbnailUrl
              ? <img src={a.thumbnailUrl} alt="" />
              : <video src={`${a.url}#t=1.5`} muted playsInline preload="metadata" aria-hidden="true" />}
            <span className="audio-upload-short-thumb-label">
              <ImagePlus size={12} aria-hidden="true" /> {a.thumbnailUrl ? t('audio.upload.shorts.editThumb') : t('audio.upload.shorts.designThumb')}
            </span>
          </button>
        </div>
      ))}
    </div>
  );
}
