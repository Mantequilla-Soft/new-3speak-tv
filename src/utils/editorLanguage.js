import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * The editor (editor.3speak.tv, in an iframe) speaks the viewer's language.
 *
 *   on open:  ?lang=<code> on the iframe's URL (editorUrlWithLang), so its first
 *             screen is already in the right language
 *   later:    { type: 'set-language', lang } when the viewer switches language while
 *             it is open (useEditorLanguage), like 'set-theme'
 *
 * The code is the interface language (i18n.language). The editor ships the same 21
 * languages as this site; a code it does not know (a community language) makes it
 * fall back to the browser's language, then English.
 */
const LANG_RE = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/;

/** The language to hand the editor, or null when there is nothing sane to send. */
export function editorLang(lang) {
  return typeof lang === 'string' && LANG_RE.test(lang) ? lang : null;
}

/** `url` with lang=<code> added (or replaced), keeping its other params. */
export function editorUrlWithLang(url, lang) {
  const code = editorLang(lang);
  if (!url || !code) return url;
  const [base, hash = ''] = String(url).split('#');
  const [path, query = ''] = base.split('?');
  const q = new URLSearchParams(query);
  q.set('lang', code);
  return `${path}?${q.toString()}${hash ? `#${hash}` : ''}`;
}

/**
 * The language now, and a ref to the language the iframe was opened with: the URL
 * must not follow later switches (a new src would reload the editor and lose the
 * edit), those go as messages. While `ready`, every switch is sent with `send`.
 */
export function useEditorLanguage(send, ready) {
  const { i18n } = useTranslation();
  const lang = editorLang(i18n.language);
  const sent = useRef(null);
  useEffect(() => {
    if (!ready) { sent.current = null; return; }
    if (!lang || sent.current === lang) return;
    sent.current = lang;
    send({ type: 'set-language', lang });
  }, [ready, lang, send]);
  return lang;
}
