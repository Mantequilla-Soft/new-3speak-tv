/**
 * Small formatting helpers shared by the outside podcast views
 * (components/Podcasts): episode durations and publish dates.
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import DOMPurify from 'isomorphic-dompurify';

/** 3723 → "1h 2m", 605 → "10m". */
export function fmtDuration(sec) {
  if (!sec) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

/** A date formatter in the interface language: "29 Oct 2026". */
export function useDateFormat() {
  const { i18n } = useTranslation();
  return useMemo(() => {
    const fmt = new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'short', year: 'numeric' });
    return (d) => (d ? fmt.format(new Date(d)) : '');
  }, [i18n.language]);
}

// Show notes come from whoever runs the feed: only plain formatting and links
// survive, every link opens in a new tab, and no images or embeds load.
const NOTES_CONFIG = {
  ALLOWED_TAGS: ['p', 'br', 'a', 'b', 'strong', 'i', 'em', 'u', 'ul', 'ol', 'li', 'blockquote', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'span', 'div', 'code', 'pre'],
  ALLOWED_ATTR: ['href'],
  ALLOWED_URI_REGEXP: /^(?:https?:|mailto:)/i,
};

// Plain addresses in the notes ("https://…", "www.…") become links. Trailing
// sentence punctuation stays outside, and so does a ")" the URL did not open.
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi;

function trimUrl(url) {
  let u = url.replace(/[.,;:!?'"»”’]+$/, '');
  while (u.endsWith(')') && (u.match(/\(/g) || []).length < (u.match(/\)/g) || []).length) u = u.slice(0, -1);
  return u;
}

function linkifyText(doc, root) {
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.parentElement?.closest('a') && URL_RE.test(n.nodeValue)) nodes.push(n);
    URL_RE.lastIndex = 0;
  }
  for (const node of nodes) {
    const text = node.nodeValue;
    const frag = doc.createDocumentFragment();
    let last = 0;
    for (const m of text.matchAll(URL_RE)) {
      const url = trimUrl(m[0]);
      if (url.length < 8) continue;
      frag.append(text.slice(last, m.index));
      const a = doc.createElement('a');
      a.href = url.startsWith('www.') ? `https://${url}` : url;
      a.textContent = url;
      frag.append(a);
      last = m.index + url.length;
    }
    frag.append(text.slice(last));
    node.replaceWith(frag);
  }
}

// One entity ("&amp;", "&#8217;") to its character; only entities, never tags.
const decodeEntity = (m) => new DOMParser().parseFromString(m, 'text/html').documentElement.textContent || m;

/** Feed show notes → safe HTML for the episode page. Plain text keeps its line breaks. */
export function sanitizeShowNotes(raw) {
  const src = String(raw || '').trim();
  if (!src) return '';
  // HTML only when it uses real HTML tags: "Q&A <live>" in plain text stays text.
  const looksHtml = /<\/?(?:p|br|a|b|strong|i|em|u|ul|ol|li|div|span|h[1-6]|blockquote|hr|code|pre)\b[^>]*>/i.test(src);
  // Some feeds send HTML without paragraphs and break lines with newlines instead.
  const hasBlocks = /<(?:p|br|li|div|h[1-6]|blockquote)\b/i.test(src);
  const html = looksHtml
    ? (hasBlocks ? src : src.replace(/\r?\n/g, '<br>'))
    // Plain text often still carries entities ("Eva &amp; Ralph"): decode, then escape.
    : src.replace(/&(?:#x?[0-9a-f]+|[a-z]+\d*);/gi, decodeEntity)
      .replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])).replace(/\r?\n/g, '<br>');
  const clean = DOMPurify.sanitize(html, NOTES_CONFIG);
  const doc = new DOMParser().parseFromString(`<div>${clean}</div>`, 'text/html');
  linkifyText(doc, doc.body.firstChild);
  for (const a of doc.querySelectorAll('a')) {
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer nofollow ugc');
  }
  return doc.body.firstChild.innerHTML;
}
