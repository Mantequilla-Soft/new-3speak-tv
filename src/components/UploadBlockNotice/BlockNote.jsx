import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import TranslateButton from '../TranslateButton/TranslateButton';
import { translateText, TITLE_LANGUAGES } from '../../utils/translate';
import './BlockNote.scss';

const langName = (code) => TITLE_LANGUAGES.find((l) => l.code === code)?.native || code;

/**
 * The admin's upload block note, quoted in the support popup and the banner.
 * The note is free text the team typed (often English), so it gets the same
 * Translate menu as the announcement popup; the original stays one click away.
 */
export default function BlockNote({ note }) {
  const { t } = useTranslation();
  const [translated, setTranslated] = useState(null);
  const [translatedLang, setTranslatedLang] = useState(null);
  const [isTranslating, setIsTranslating] = useState(false);
  const [translateFailed, setTranslateFailed] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const [translatedFrom, setTranslatedFrom] = useState(null);

  // A new note (admin changed it) drops the old translation.
  const hasTranslation = !!translated && translatedFrom === note;
  const shown = hasTranslation && !showOriginal ? translated : note;

  const translate = async (code) => {
    setIsTranslating(true);
    setTranslateFailed(false);
    try {
      const out = await translateText(note, code, 'auto', { plain: true });
      if (!out) throw new Error('empty translation');
      setTranslated(out);
      setTranslatedLang(code);
      setTranslatedFrom(note);
      setShowOriginal(false);
    } catch {
      setTranslateFailed(true);
    } finally {
      setIsTranslating(false);
    }
  };

  return (
    <div className="block-note">
      <span className="block-note-label">{t('app.uploadBlock.noteLabel')}</span>
      <p className="block-note-text" dir="auto">{shown}</p>
      <div className="block-note-tools">
        <TranslateButton onTranslate={translate} isTranslating={isTranslating} languages={TITLE_LANGUAGES} />
        {hasTranslation && (
          <span className="block-note-translated">
            <span>
              {showOriginal
                ? t('watch.summary.showingOriginal')
                : t('watch.summary.translatedTo', { language: langName(translatedLang) })}
            </span>
            <button type="button" onClick={() => setShowOriginal((v) => !v)}>
              {showOriginal
                ? t('watch.summary.showLanguage', { language: langName(translatedLang) })
                : t('watch.summary.showOriginal')}
            </button>
          </span>
        )}
      </div>
      {translateFailed && <p className="block-note-error">{t('announcement.translateFailed')}</p>}
    </div>
  );
}
