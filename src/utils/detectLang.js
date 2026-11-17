// Best-effort language detection for the teleprompter script.
//
// Deliberately tiny and dependency-free: non-Latin scripts are identified by
// character range, Latin languages by stop-word hits. It only ever has to pick
// among the handful of languages the STT server actually has models for, and it
// falls back to English whenever it isn't reasonably sure.

const SCRIPT_RANGES = [
  { re: /[ґєіїҐЄІЇ]/, lang: 'uk-UA' }, // letters only Ukrainian has (before Cyrillic)
  { re: /[Ѐ-ӿ]/, lang: 'ru-RU' }, // Cyrillic
  { re: /[؀-ۿ]/, lang: 'ar-SA' }, // Arabic
  { re: /[ऀ-ॿ]/, lang: 'hi-IN' }, // Devanagari
  { re: /[぀-ヿ]/, lang: 'ja-JP' }, // Hiragana/Katakana
  { re: /[가-힯]/, lang: 'ko-KR' }, // Hangul
  { re: /[一-鿿]/, lang: 'zh-CN' }, // Han (after JA/KO so kana/hangul win)
];

const STOPWORDS = {
  'en-US': ['the', 'and', 'to', 'of', 'is', 'in', 'that', 'it', 'you', 'for', 'we', 'are', 'this', 'with', 'have', 'not', 'but'],
  'de-DE': ['der', 'die', 'das', 'und', 'ist', 'nicht', 'ich', 'wir', 'mit', 'auf', 'ein', 'eine', 'sich', 'für', 'aber', 'auch'],
  'es-ES': ['el', 'la', 'los', 'las', 'de', 'que', 'es', 'en', 'un', 'una', 'por', 'para', 'con', 'no', 'se', 'del'],
  'pt-BR': ['o', 'os', 'as', 'de', 'que', 'em', 'um', 'uma', 'para', 'com', 'não', 'se', 'do', 'da', 'mais', 'você'],
  'fr-FR': ['le', 'la', 'les', 'et', 'de', 'que', 'est', 'un', 'une', 'pour', 'dans', 'avec', 'je', 'nous', 'pas', 'ce'],
  'it-IT': ['il', 'la', 'le', 'di', 'che', 'è', 'un', 'una', 'per', 'con', 'non', 'sono', 'del', 'nel', 'anche'],
  'nl-NL': ['de', 'het', 'een', 'en', 'van', 'is', 'dat', 'niet', 'op', 'met', 'voor', 'ik', 'wij', 'zijn', 'maar'],
  // Only words no other listed language uses (Polish "i", "w", "do" are English too)
  'pl-PL': ['się', 'nie', 'że', 'jest', 'jak', 'ale', 'tak', 'dla', 'jestem', 'już', 'żeby', 'może', 'bardzo', 'tylko'],
  'tr-TR': ['ve', 'bir', 'bu', 'için', 'ile', 'çok', 'ama', 'biz', 'değil', 'gibi', 'daha', 'olarak', 'şey', 'bunu'],
  'vi-VN': ['và', 'là', 'của', 'không', 'có', 'được', 'những', 'một', 'cho', 'này', 'với', 'các', 'người', 'trong', 'tôi'],
};

const DEFAULT_LANG = 'en-US';

/**
 * @param {string} text   the script
 * @param {string[]} [allowed]  BCP-47 tags the recognizer actually supports;
 *                              a detection outside this set is discarded.
 * @returns {string} a BCP-47 tag, always one of `allowed` when that is given.
 */
export function detectScriptLang(text, { allowed } = {}) {
  const permit = (tag) => !allowed || !allowed.length || allowed.includes(tag);
  const fallback = permit(DEFAULT_LANG) ? DEFAULT_LANG : (allowed && allowed[0]) || DEFAULT_LANG;

  const raw = (text || '').trim();
  if (raw.length < 8) return fallback; // too little to judge

  for (const { re, lang } of SCRIPT_RANGES) {
    if (re.test(raw)) return permit(lang) ? lang : fallback;
  }

  const tokens = raw
    .toLowerCase()
    .split(/[^\p{L}]+/u)
    .filter(Boolean);
  if (tokens.length < 4) return fallback;

  const counts = new Map();
  for (const t of tokens) {
    for (const [lang, list] of Object.entries(STOPWORDS)) {
      if (list.includes(t)) counts.set(lang, (counts.get(lang) || 0) + 1);
    }
  }

  let best = null;
  let bestScore = 0;
  for (const [lang, score] of counts) {
    if (!permit(lang)) continue;
    if (score > bestScore) { best = lang; bestScore = score; }
  }

  // Require a real signal — at least 2 hits and 5% of the words — else English.
  if (!best || bestScore < 2 || bestScore / tokens.length < 0.05) return fallback;
  return best;
}

/** Vosk-ish model id ("en-us", "de") → BCP-47 ("en-US", "de-DE"). */
export function modelIdToTag(id) {
  const s = String(id || '').trim().toLowerCase();
  if (!s) return '';
  const [base, region] = s.split(/[-_]/);
  if (region) return `${base}-${region.toUpperCase()}`;
  const bare = {
    en: 'en-US', de: 'de-DE', es: 'es-ES', fr: 'fr-FR', pt: 'pt-BR', it: 'it-IT',
    nl: 'nl-NL', ru: 'ru-RU', hi: 'hi-IN', ar: 'ar-SA', ja: 'ja-JP', ko: 'ko-KR',
    zh: 'zh-CN', cn: 'zh-CN', pl: 'pl-PL', tr: 'tr-TR', sv: 'sv-SE',
    uk: 'uk-UA', ua: 'uk-UA', vi: 'vi-VN', vn: 'vi-VN', id: 'id-ID', bn: 'bn-BD',
    sw: 'sw-KE', th: 'th-TH', tl: 'fil-PH', fil: 'fil-PH',
  };
  return bare[base] || `${base}-${base.toUpperCase()}`;
}

export default detectScriptLang;
