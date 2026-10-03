import { useTranslation } from 'react-i18next';
import { LANGUAGES, setLanguage, getLanguage } from '../../i18n';
import './LanguagePicker.scss';

// Where translations are contributed (TRANSLATING.md in the repo).
const CONTRIBUTE_URL = 'https://github.com/Mantequilla-Soft/new-3speak-tv/blob/develop/TRANSLATING.md';

/**
 * Interface-language dropdown. A native <select> on purpose: it is the one control
 * every phone already renders as a proper full-screen list, and each option shows
 * the language in its own script, so nobody has to read English to find theirs.
 */
export default function LanguagePicker({ compact = false }) {
  const { t, i18n } = useTranslation();
  const current = i18n.resolvedLanguage || getLanguage();

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
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code} lang={l.code}>
            {l.native}{l.native !== l.english ? ` (${l.english})` : ''}
          </option>
        ))}
      </select>
      {!compact && (
        <a className="language-picker-contribute" href={CONTRIBUTE_URL} target="_blank" rel="noopener noreferrer">
          {t('common.language.contribute')}
        </a>
      )}
    </div>
  );
}
