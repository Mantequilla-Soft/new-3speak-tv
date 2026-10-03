// The interface languages 3Speak ships.
//
// Adding a language is a PR, not a code change elsewhere: drop a folder of JSON
// files in src/locales/<code>/ (copy src/locales/en/), and add one line here. See
// TRANSLATING.md at the repo root. `native` is what the picker shows, so a person
// who cannot read English can still find their own language.
//
// `dir: 'rtl'` is honoured (it sets <html dir>), but the layout has not been
// reviewed right-to-left yet, so treat an RTL language as a first draft.
export const LANGUAGES = [
  { code: 'en', native: 'English', english: 'English' },
  { code: 'es', native: 'Español', english: 'Spanish' },
  { code: 'pt', native: 'Português', english: 'Portuguese' },
  { code: 'de', native: 'Deutsch', english: 'German' },
  { code: 'fr', native: 'Français', english: 'French' },
  { code: 'it', native: 'Italiano', english: 'Italian' },
  { code: 'pl', native: 'Polski', english: 'Polish' },
  { code: 'ru', native: 'Русский', english: 'Russian' },
  { code: 'tr', native: 'Türkçe', english: 'Turkish' },
  { code: 'id', native: 'Bahasa Indonesia', english: 'Indonesian' },
  { code: 'ko', native: '한국어', english: 'Korean' },
  { code: 'ja', native: '日本語', english: 'Japanese' },
  { code: 'zh', native: '中文', english: 'Chinese (Simplified)' },
];

export const DEFAULT_LANGUAGE = 'en';
export const LANGUAGE_CODES = LANGUAGES.map((l) => l.code);
export const getLanguageInfo = (code) => LANGUAGES.find((l) => l.code === code);
