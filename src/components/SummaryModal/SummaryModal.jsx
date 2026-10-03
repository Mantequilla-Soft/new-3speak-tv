import { useEffect, useState, useCallback } from 'react';
import { MdClose, MdAutoAwesome } from 'react-icons/md';
import { useTranslation } from 'react-i18next';
import TranslateButton from '../TranslateButton/TranslateButton';
import { translateText, SUPPORTED_LANGUAGES } from '../../utils/translate';
import './SummaryModal.scss';

const langName = (code) =>
  SUPPORTED_LANGUAGES.find((l) => l.code === code)?.native || code;

/**
 * Popup showing the AI-generated summary of a video (from the translator
 * service's meta). Opened by the "Summary" button next to the vote button.
 * Includes the same on-the-fly translate control as the comment section so the
 * summary can be read in any language.
 */
export default function SummaryModal({ isOpen, onClose, summary, title }) {
  const { t } = useTranslation();
  const [translated, setTranslated] = useState(null);
  const [translatedLang, setTranslatedLang] = useState(null);
  const [isTranslating, setIsTranslating] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);

  // Reset translation when the summary changes (new video) or on close.
  useEffect(() => {
    setTranslated(null);
    setTranslatedLang(null);
    setShowOriginal(false);
  }, [summary, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  const handleTranslate = useCallback(
    async (code) => {
      if (!summary) return;
      setIsTranslating(true);
      try {
        const out = await translateText(summary, code);
        setTranslated(out);
        setTranslatedLang(code);
        setShowOriginal(false);
      } catch {
        setTranslated(null);
        setTranslatedLang(null);
      } finally {
        setIsTranslating(false);
      }
    },
    [summary]
  );

  if (!isOpen) return null;

  const body = translated && !showOriginal ? translated : summary;

  return (
    <div className="summary-modal-overlay" onClick={onClose}>
      <div className="summary-modal" onClick={(e) => e.stopPropagation()}>
        <div className="summary-modal-header">
          <div className="summary-modal-heading">
            <MdAutoAwesome size={18} />
            <h3>{t('watch.summary.title')}</h3>
          </div>
          <div className="summary-modal-actions">
            <TranslateButton onTranslate={handleTranslate} isTranslating={isTranslating} />
            <button
              type="button"
              className="summary-modal-close"
              onClick={onClose}
              aria-label={t('watch.summary.close')}
            >
              <MdClose size={20} />
            </button>
          </div>
        </div>

        {title && <p className="summary-modal-title">{title}</p>}

        {translated && (
          <div className="summary-modal-translated-note">
            <span>
              {showOriginal ? t('watch.summary.showingOriginal') : t('watch.summary.translatedTo', { language: langName(translatedLang) })}
            </span>
            <button type="button" onClick={() => setShowOriginal((s) => !s)}>
              {showOriginal ? t('watch.summary.showLanguage', { language: langName(translatedLang) }) : t('watch.summary.showOriginal')}
            </button>
          </div>
        )}

        <div className="summary-modal-body">{body}</div>
      </div>
    </div>
  );
}
