/**
 * Quote cards: one line someone said in a video (its transcript), as a square
 * picture posted as a snap that links to that moment and names the video as its
 * source (lib/derived.js, kind quote, with the line's start and end).
 *
 * Flat 3Speak look (no gradients): a dark card, the red accent, the 3S mark,
 * the line as big as fits, then who said it, the video and the moment.
 */
import { derivedSource } from './derived';

export const CARD_SIZE = 1080;
export const MAX_QUOTE = 280;
const SITE = 'https://3speak.tv';

const COLORS = { bg: '#111215', text: '#ffffff', muted: '#a0a4ab', accent: '#e53935' };

/** "4:07" / "1:05:09" */
export function stamp(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** The line as quoted: one paragraph, trimmed, at most MAX_QUOTE characters. */
export function cleanQuote(text) {
  const one = String(text || '').replace(/\s+/g, ' ').trim().replace(/^["“”]+|["“”]+$/g, '');
  return one.length > MAX_QUOTE ? `${one.slice(0, MAX_QUOTE - 1).trimEnd()}…` : one;
}

/** Words into lines no wider than `width` (measure(text) -> px); a word too long for a line is cut. */
export function wrapLines(text, width, measure) {
  const lines = [];
  let line = '';
  for (const word of String(text).split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (measure(next) <= width) { line = next; continue; }
    if (line) lines.push(line);
    let w = word;
    while (measure(w) > width && w.length > 1) {
      let cut = w.length - 1;
      while (cut > 1 && measure(w.slice(0, cut)) > width) cut -= 1;
      lines.push(w.slice(0, cut));
      w = w.slice(cut);
    }
    line = w;
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * The biggest font size (from `max` down to `min`) at which the quote fits the
 * box, and its lines. At `min` it is cut to the lines that fit, the last ending "…".
 */
export function fitQuote(text, { width, height, max = 72, min = 36, lineHeight = 1.25 }, measureAt) {
  for (let size = max; size >= min; size -= 2) {
    const lines = wrapLines(text, width, (s) => measureAt(s, size));
    if (lines.length * size * lineHeight <= height) return { size, lines };
  }
  const lines = wrapLines(text, width, (s) => measureAt(s, min));
  const fit = Math.max(1, Math.floor(height / (min * lineHeight)));
  if (lines.length <= fit) return { size: min, lines };
  const kept = lines.slice(0, fit);
  kept[fit - 1] = `${kept[fit - 1].replace(/\s*\S*$/, '')}…`;
  return { size: min, lines: kept };
}

/** `text` cut (with "…") to fit `width`, measured with the ellipsis on. */
export function fitLine(text, width, measure) {
  if (measure(text) <= width) return text;
  let t = text;
  while (t && measure(`${t.trimEnd()}…`) > width) t = t.slice(0, -1);
  return t ? `${t.trimEnd()}…` : '';
}

/** Draws the card on a CARD_SIZE square 2D context. `mark` is the loaded 3S mark image, or null. */
export function drawQuoteCard(ctx, { quote, author, title, start, mark = null, font = 'Roboto, Arial, sans-serif' }) {
  const S = CARD_SIZE;
  const pad = 96;
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, S, S);
  ctx.fillStyle = COLORS.accent;
  ctx.fillRect(0, 0, 16, S);
  if (mark) ctx.drawImage(mark, pad, pad, 92, 80);

  ctx.fillStyle = COLORS.accent;
  ctx.font = `700 180px ${font}`;
  ctx.textBaseline = 'top';
  ctx.fillText('“', pad - 8, 210);

  const box = { width: S - pad * 2, height: 470 };
  const { size, lines } = fitQuote(quote, box, (s, px) => { ctx.font = `700 ${px}px ${font}`; return ctx.measureText(s).width; });
  ctx.font = `700 ${size}px ${font}`;
  ctx.fillStyle = COLORS.text;
  const lh = size * 1.25;
  const top = 360 + (box.height - lines.length * lh) / 2;
  lines.forEach((l, i) => ctx.fillText(l, pad, top + i * lh));

  ctx.font = `600 38px ${font}`;
  ctx.fillStyle = COLORS.text;
  ctx.fillText(`@${author}`, pad, S - pad - 110);
  ctx.font = `400 32px ${font}`;
  ctx.fillStyle = COLORS.muted;
  const tail = Number.isFinite(start) ? ` · ${stamp(start)}` : '';
  const room = S - pad * 2;
  ctx.fillText(`${fitLine(String(title || ''), room - ctx.measureText(tail).width, (x) => ctx.measureText(x).width)}${tail}`, pad, S - pad - 56);
  ctx.textAlign = 'right';
  ctx.fillText('3speak.tv', S - pad, pad + 24);
  ctx.textAlign = 'left';
}

/** The video at that moment, on 3speak.tv. */
export const momentUrl = (author, permlink, start) => `${SITE}/watch?v=${author}/${permlink}${Number.isFinite(start) && start > 0 ? `&t=${Math.floor(start)}` : ''}`;

/** The snap's text: the poster's words, the card, the line, who said it with a link to the moment. */
export function quoteBody({ quote, author, permlink, title, start, imageUrl, comment = '' }) {
  const words = String(comment || '').trim();
  const name = String(title || '').replace(/[[\]]/g, '') || `@${author}`;
  return [
    words,
    `![${cleanQuote(quote).slice(0, 80).replace(/[[\]]/g, '')}](${imageUrl})`,
    `> ${cleanQuote(quote)}`,
    `— @${author}, [${name}](${momentUrl(author, permlink, start)})`,
  ].filter(Boolean).join('\n\n');
}

/** The snap's json_metadata additions: the card as its image, the video as its source. */
export function quoteMetadata({ author, permlink, start, end, imageUrl }) {
  const source = derivedSource({ kind: 'quote', author, permlink, start, end });
  return {
    format: 'markdown',
    tags: ['3speak', 'quote'],
    image: [imageUrl],
    links: [momentUrl(author, permlink, start)],
    ...(source ? { '3speak': { source } } : {}),
  };
}

/** A Hive permlink for the snap. */
export const quotePermlink = (now = Date.now()) => `quote-${now.toString(36)}`;
