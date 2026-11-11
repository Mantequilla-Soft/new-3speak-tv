import { useState } from 'react';
import { Icon } from '../v2/Icon';
import { SUPPORTED_LANGUAGES, getTargetLanguage, setTargetLanguage } from '../../utils/translate';
import './LanguageSelector.scss';

export default function LanguageSelector({ onChange }) {
  const [lang, setLang] = useState(getTargetLanguage);

  const handleChange = (e) => {
    const code = e.target.value;
    setLang(code);
    setTargetLanguage(code);
    onChange?.(code);
  };

  return (
    <div className="language-selector">
      <Icon name="translate" size={16} />
      <select className="v2-input is-select" value={lang} onChange={handleChange}>
        {SUPPORTED_LANGUAGES.map(l => (
          <option key={l.code} value={l.code}>
            {l.native}
          </option>
        ))}
      </select>
    </div>
  );
}
