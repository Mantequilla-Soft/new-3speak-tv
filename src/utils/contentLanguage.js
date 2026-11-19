// The language spoken in a video (idea F8), picked on the upload's Details
// step and written to the post's json_metadata as `language` (ISO 639-1; `zxx`
// is the ISO code for "no speech": music, ambience). Nothing reads it yet: it
// is collected now so a language filter in Discover and search has data once
// it exists.
//
// The default is the last language picked in this browser, else the site
// language when it is one of these, else English.

import i18next from 'i18next';

// The site language, read straight from i18next (src/i18n sets it up).
const siteLanguage = () => String(i18next.resolvedLanguage || i18next.language || 'en');

// The stream languages (components/openpods/StreamTemplates.jsx) plus the
// site's own Bengali and Filipino.
export const CONTENT_LANGUAGES = ['en', 'es', 'pt', 'de', 'fr', 'it', 'nl', 'pl', 'ru', 'uk', 'tr', 'ar', 'hi', 'bn', 'id', 'fil', 'vi', 'th', 'ja', 'ko', 'zh', 'sw'];
export const NO_SPEECH = 'zxx';

const STORAGE_KEY = '3speak_content_language';

const known = (code) => code === NO_SPEECH || CONTENT_LANGUAGES.includes(code);

export function readContentLanguage() {
  try {
    const kept = localStorage.getItem(STORAGE_KEY);
    if (known(kept)) return kept;
  } catch { /* storage blocked */ }
  const site = siteLanguage().split('-')[0];
  return CONTENT_LANGUAGES.includes(site) ? site : 'en';
}

export function writeContentLanguage(code) {
  if (!known(code)) return;
  try {
    localStorage.setItem(STORAGE_KEY, code);
  } catch {
    // storage blocked: the choice just isn't remembered
  }
}

/** A language's name in the reader's own language, from Intl (the code on an old browser). */
export function languageNamer(uiLang = siteLanguage()) {
  let dn = null;
  try { dn = new Intl.DisplayNames([uiLang], { type: 'language' }); } catch { /* old browser */ }
  return (code) => {
    try { return dn?.of(code) || code; } catch { return code; }
  };
}
