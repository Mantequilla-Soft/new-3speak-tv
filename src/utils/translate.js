import axios from 'axios';
import { TRANSLATE_API_URL } from './config';
import { getLanguage } from '../i18n';

const STORAGE_KEY = '3speak-translate-lang';

export const SUPPORTED_LANGUAGES = [
  { code: 'en', name: 'English', native: 'English' },
  { code: 'zh', name: 'Chinese', native: '中文' },
  { code: 'hi', name: 'Hindi', native: 'हिन्दी' },
  { code: 'es', name: 'Spanish', native: 'Español' },
  { code: 'fr', name: 'French', native: 'Français' },
  { code: 'ar', name: 'Arabic', native: 'العربية' },
  { code: 'bn', name: 'Bengali', native: 'বাংলা' },
  { code: 'pt', name: 'Portuguese', native: 'Português' },
  { code: 'ru', name: 'Russian', native: 'Русский' },
  { code: 'ja', name: 'Japanese', native: '日本語' },
  { code: 'de', name: 'German', native: 'Deutsch' },
  { code: 'ko', name: 'Korean', native: '한국어' },
  { code: 'it', name: 'Italian', native: 'Italiano' },
  { code: 'nl', name: 'Dutch', native: 'Nederlands' },
  { code: 'pl', name: 'Polish', native: 'Polski' },
  { code: 'tr', name: 'Turkish', native: 'Türkçe' },
  { code: 'vi', name: 'Vietnamese', native: 'Tiếng Việt' },
  { code: 'th', name: 'Thai', native: 'ไทย' },
  { code: 'id', name: 'Indonesian', native: 'Bahasa Indonesia' },
  { code: 'uk', name: 'Ukrainian', native: 'Українська' },
  { code: 'sv', name: 'Swedish', native: 'Svenska' },
  { code: 'cs', name: 'Czech', native: 'Čeština' },
  { code: 'el', name: 'Greek', native: 'Ελληνικά' },
  { code: 'hu', name: 'Hungarian', native: 'Magyar' },
  { code: 'fi', name: 'Finnish', native: 'Suomi' },
  { code: 'da', name: 'Danish', native: 'Dansk' },
  { code: 'ro', name: 'Romanian', native: 'Română' },
  { code: 'he', name: 'Hebrew', native: 'עברית' },
  { code: 'fa', name: 'Persian', native: 'فارسی' },
  { code: 'tl', name: 'Tagalog', native: 'Tagalog' },
  { code: 'ms', name: 'Malay', native: 'Bahasa Melayu' },
  { code: 'bg', name: 'Bulgarian', native: 'Български' },
  { code: 'nb', name: 'Norwegian', native: 'Norsk' },
  { code: 'ur', name: 'Urdu', native: 'اردو' },
];

export function getTargetLanguage() {
  // Until someone picks a translation language, translate into the language
  // they read the interface in.
  return localStorage.getItem(STORAGE_KEY) || getLanguage();
}

export function setTargetLanguage(code) {
  localStorage.setItem(STORAGE_KEY, code);
}

function stripMarkdownAndHtml(text) {
  let s = text;
  // Remove "replied to [timestamp](link) on [host](url)" footers
  s = s.replace(/\n?<br\s*\/?>\s*<sup>\s*replied to.*?<\/sup>/gi, '');
  s = s.replace(/\n?\*?\*?replied to \[.*?\]\([^)]*\).*$/gim, '');
  // Remove HTML tags
  s = s.replace(/<[^>]+>/g, '');
  // Markdown images ![alt](url)
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
  // Markdown links [text](url) → text
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  // Fenced code blocks
  s = s.replace(/```[\s\S]*?```/g, '');
  // Inline code
  s = s.replace(/`([^`]*)`/g, '$1');
  // Bold/italic markers
  s = s.replace(/(\*{1,3}|_{1,3})(.*?)\1/g, '$2');
  // Headings
  s = s.replace(/^#{1,6}\s+/gm, '');
  // Blockquotes
  s = s.replace(/^>\s?/gm, '');
  // Horizontal rules
  s = s.replace(/^[-*_]{3,}\s*$/gm, '');
  // List markers
  s = s.replace(/^[\s]*[-*+]\s+/gm, '');
  s = s.replace(/^[\s]*\d+\.\s+/gm, '');
  // Collapse multiple newlines / whitespace
  s = s.replace(/\n{3,}/g, '\n\n').trim();
  return s;
}

export async function translateText(text, target, source = 'auto') {
  const cleaned = stripMarkdownAndHtml(text);
  if (!cleaned) return '';
  const { data } = await axios.post(`${TRANSLATE_API_URL}/translate`, {
    q: cleaned,
    source,
    target,
    format: 'text',
  });
  return data.translatedText;
}
