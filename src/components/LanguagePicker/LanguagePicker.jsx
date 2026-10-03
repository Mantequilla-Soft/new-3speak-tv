import { useEffect, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { setLanguage, getAllLanguages, subscribeLanguages } from '../../i18n';
import { fetchTranslatorStatus } from '../../lib/translatorApi';
import './LanguagePicker.scss';


/**
 * Interface-language dropdown. A native <select> on purpose: it is the one control
 * every phone already renders as a proper full-screen list, and each option shows
 * the language in its own script, so nobody has to read English to find theirs.
 *
 * The list includes languages translators added in the in-app editor (they arrive
 * from the API after load), and accounts on the translator list get a link to
 * that editor (/translate). `onNavigate` lets a host modal close when it is used.
 */
export default function LanguagePicker({ compact = false, onNavigate }) {
  const { t, i18n } = useTranslation();
  const languages = useSyncExternalStore(subscribeLanguages, getAllLanguages);
  // i18n.language, not resolvedLanguage: a community language with few strings
  // yet still "resolves" to English, but it is what the person picked.
  const current = languages.some((l) => l.code === i18n.language)
    ? i18n.language
    : (i18n.resolvedLanguage || 'en');
  const [isTranslator, setIsTranslator] = useState(false);

  useEffect(() => {
    if (compact) return undefined;
    let alive = true;
    fetchTranslatorStatus().then((s) => { if (alive) setIsTranslator(s.translator); });
    return () => { alive = false; };
  }, [compact]);

  return (
    <div className={`language-picker${compact ? ' language-picker--compact' : ''}`}>
      <div className="language-picker-text">
        <label className="settings-row-title" htmlFor="language-picker-select">
          🌐 {t('common.language.label')}
        </label>
        {!compact && <span className="settings-row-desc">{t('common.language.hint')}</span>}
      </div>
      <select
        id="language-picker-select"
        className="language-picker-select"
        value={current}
        onChange={(e) => setLanguage(e.target.value)}
      >
        {languages.map((l) => (
          <option key={l.code} value={l.code} lang={l.code}>
            {l.native}{l.native !== l.english ? ` (${l.english})` : ''}
          </option>
        ))}
      </select>
      {!compact && isTranslator && (
        <Link className="language-picker-contribute" to="/translate" onClick={onNavigate}>
          {t('translator.title')}
        </Link>
      )}
    </div>
  );
}
