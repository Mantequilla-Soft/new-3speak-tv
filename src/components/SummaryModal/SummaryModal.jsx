import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import TranslateButton from '../TranslateButton/TranslateButton';
import { Dialog, StatusPill, Eyebrow } from '../v2/ui';
import { ChapterList } from '../playVideo/WatchPanels';
import { translateText, SUPPORTED_LANGUAGES } from '../../utils/translate';
import './SummaryModal.scss';

const langName = (code) =>
  SUPPORTED_LANGUAGES.find((l) => l.code === code)?.native || code;

/**
 * The AI summary of a video as a sheet (17h): the summary, then the chapters to
 * jump to, and a line saying where it came from. A side sheet on a wide screen,
 * a bottom sheet on a phone. Opened from the watch page's More menu. The same
 * on-the-fly translate control as the comments, so it reads in any language.
 */
export default function SummaryModal({ isOpen, onClose, summary, title, chapters = [], currentChapter = -1, onSeek }) {
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

  const body = translated && !showOriginal ? translated : summary;

  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
      width={420}
      className="summary-sheet"
      bodyClassName="summary-sheet__body"
      closeLabel={t('watch.summary.close')}
      tone="muted"
      title={(
        <span className="summary-sheet__title">
          {t('watch.summary.title')}
          <StatusPill tone="muted">{t('watch.aiBadge.label')}</StatusPill>
        </span>
      )}
      footer={<p className="summary-sheet__note">{t('watch.summary.disclaimer')}</p>}
    >
      {title && <p className="summary-sheet__video">{title}</p>}

      <div className="summary-sheet__tools">
        {translated && (
          <span className="summary-sheet__lang">
            {showOriginal ? t('watch.summary.showingOriginal') : t('watch.summary.translatedTo', { language: langName(translatedLang) })}
            <button type="button" onClick={() => setShowOriginal((s) => !s)}>
              {showOriginal ? t('watch.summary.showLanguage', { language: langName(translatedLang) }) : t('watch.summary.showOriginal')}
            </button>
          </span>
        )}
        <TranslateButton onTranslate={handleTranslate} isTranslating={isTranslating} />
      </div>

      <div className="summary-sheet__text">{body}</div>

      {chapters.length > 0 && (
        <>
          <Eyebrow className="summary-sheet__eyebrow">{t('watch.summary.jumpTo')}</Eyebrow>
          <ChapterList chapters={chapters} current={currentChapter} onSeek={onSeek} className="summary-sheet__chapters" />
        </>
      )}
    </Dialog>
  );
}
