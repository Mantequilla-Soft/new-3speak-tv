// Blog to podcast: a Hive post's markdown as text a voice can read out.
//
// What a reader skips is dropped (images, code, tables, HTML, bare links,
// emoji and emoticons, the "watch on / posted with" footers frontends add),
// what they would say stays (a link reads as its words, a heading and a list
// item become sentences). The result is a list of paragraphs: the narration
// pauses between them and a little longer after a heading. The writer edits
// this script before anything is rendered, so it errs on the side of dropping.

// Footers frontends and tools sign posts with, as whole lines (or the rest of
// the post after them). Lowercase, matched against a line with its markup gone.
const FOOTER_LINES = [
  /^(?:▶️?\s*)?watch (?:it )?on 3speak/,
  /^posted (?:with|using|via|on) /,
  /^(?:this post|this article) (?:was )?(?:posted|published|written|created) (?:with|using|on|via) /,
  /^(?:sent|shared) (?:with|using|via) /,
  /^(?:upload(?:ed)?|posted) (?:to|on) 3speak/,
  /^(?:listen|watch) on 3speak/,
  /^posted from https?:/,
  /^(?:posted|written) (?:in|from) (?:ecency|peakd|inleo|leofinance|hive\.blog|liketu|waivio)/,
  /^(?:check out|follow) (?:me|my) on /,
]

// Pictographs, dingbats, flags, keycaps and the joiners that glue them.
const EMOJI = /(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|[\u{1F3FB}-\u{1F3FF}\u{FE0F}\u{200D}\u{20E3}\u{E0020}-\u{E007F}])+/gu
// Typed emoticons, only where they stand alone (": )" inside a sentence is rare).
const EMOTICON = /(?:^|(?<=\s))(?:[:;=8xX][-'^o]?[)(\]\[dDpP/\\|*3@$]+|[)(\]\[dDpP][-'^o]?[:;=]|<3+|\^_*\^|[oO]_[oO]|[tT]_[tT]|xD+|XD+|:[a-z_]{2,30}:)(?=\s|$|[.,!?])/g

const decodeEntities = (s) => s
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>')
  .replace(/&quot;/gi, '"')
  .replace(/&#39;|&apos;/gi, "'")
  .replace(/&#(\d{1,6});/g, (_, n) => { try { return String.fromCodePoint(Number(n)) } catch { return ' ' } })
  .replace(/&#x([0-9a-f]{1,6});/gi, (_, n) => { try { return String.fromCodePoint(parseInt(n, 16)) } catch { return ' ' } })

/** One line's inline markdown and markup as plain words. */
function inline(line) {
  return line
    // images, then links as their words (an empty one goes)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1')
    // bare links, hosts and handles' URLs; a mention reads as the name
    .replace(/<?\bhttps?:\/\/[^\s)>\]]+>?/gi, ' ')
    .replace(/\bwww\.[^\s)>\]]+/gi, ' ')
    .replace(/(^|\s)@([a-z][a-z0-9.-]{1,15})\b/gi, '$1$2')
    // a hashtag reads as its word
    .replace(/(^|\s)#([\p{L}\p{N}_-]{2,40})/gu, '$1$2')
    // emphasis, strike, inline code markers, sub/sup carets
    .replace(/`+([^`]*)`+/g, '$1')
    .replace(/(\*\*|__|~~|\*|_)(?=\S)([^\n]*?\S)\1/g, '$2')
    .replace(/[*~`^]+/g, ' ')
    .replace(EMOJI, ' ')
    .replace(EMOTICON, ' ')
    // separators people draw with characters
    .replace(/[|•·▪►▶◀◆◇■□★☆→←↑↓⟶⇒]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/** A sentence ends with a stop the voice can hear; a dangling colon becomes one. */
function closeSentence(text) {
  const t = text.replace(/\s*[:;,–-]+\s*$/, '').trim()
  if (!t) return ''
  if (/[.!?…"')\]]$/.test(t)) return t
  return `${t}.`
}

/** A line that only introduced a link or a picture ("My channel:" with the link gone). */
const isLeadIn = (raw, text) => /:\s*$/.test(text) && /(\]\(|https?:\/\/|!\[)/.test(raw)

/**
 * The post's markdown as narration paragraphs.
 * @returns {{ paragraphs: { text: string, heading?: boolean }[], words: number }}
 */
function narrationScript(markdown) {
  let s = decodeEntities(String(markdown || '')).replace(/\r\n?/g, '\n')
  // Blocks a reader skips whole.
  s = s
    .replace(/```[\s\S]*?(```|$)/g, '\n\n')
    .replace(/~~~[\s\S]*?(~~~|$)/g, '\n\n')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|iframe|video|audio|table|pre|code)\b[\s\S]*?<\/\1>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|blockquote|center)>/gi, '\n\n')
    .replace(/<[^>]+>/g, ' ')

  const out = []
  let para = []
  const flush = () => {
    if (para.length) out.push({ text: para.join(' ') })
    para = []
  }
  for (const rawLine of s.split('\n')) {
    const raw = rawLine.trim()
    if (!raw) { flush(); continue }
    // tables, rules, indented code
    if (/^\|.*\|$/.test(raw) || /^[-:| ]{3,}$/.test(raw) || /^([-*_=]\s*){3,}$/.test(raw) || /^ {4,}\S/.test(rawLine)) { flush(); continue }
    const heading = /^#{1,6}\s+/.test(raw)
    const item = /^(?:[-*+]|\d{1,3}[.)])\s+/.test(raw)
    const body = raw.replace(/^#{1,6}\s+/, '').replace(/^(?:>\s*)+/, '').replace(/^(?:[-*+]|\d{1,3}[.)])\s+/, '')
    const text = inline(body)
    const lower = text.toLowerCase()
    // A frontend's footer: this line and everything after it are not the post.
    if (FOOTER_LINES.some((re) => re.test(lower))) { flush(); break }
    if (!text || isLeadIn(raw, text) || !/[\p{L}\p{N}]/u.test(text)) continue
    if (heading) {
      flush()
      out.push({ text: closeSentence(text), heading: true })
      continue
    }
    // A list item is its own sentence; plain lines join up (single newlines are
    // still one paragraph in markdown), each closed if it ended without a stop
    // only when it was a line of its own in a list.
    para.push(item ? closeSentence(text) : text)
  }
  flush()

  const paragraphs = out
    .map((p) => ({ ...p, text: p.heading ? p.text : closeSentence(p.text.replace(/\s+([.,!?;:])/g, '$1').replace(/([.!?])\s*\.+/g, '$1')) }))
    .filter((p) => p.text && /[\p{L}\p{N}]/u.test(p.text))
  // A post that is all headings reads nothing.
  if (!paragraphs.some((p) => !p.heading)) return { paragraphs: [], words: 0 }
  const words = paragraphs.reduce((n, p) => n + p.text.split(/\s+/).length, 0)
  return { paragraphs, words }
}

/** Script text (paragraphs separated by a blank line) back as paragraphs, as the writer edited it. */
function parseScript(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map((p) => {
      const heading = /^#\s+/.test(p)
      return heading ? { text: closeSentence(p.replace(/^#\s+/, '')), heading: true } : { text: p }
    })
}

/** Paragraphs as editable script text: a heading starts with "# ". */
function scriptText(paragraphs) {
  return paragraphs.map((p) => (p.heading ? `# ${p.text}` : p.text)).join('\n\n')
}

// About 150 spoken words a minute (the Piper voices measured 160-205).
const WORDS_PER_MINUTE = 155
const estimateSeconds = (words) => Math.round((Number(words) || 0) / WORDS_PER_MINUTE * 60)

module.exports = { narrationScript, parseScript, scriptText, estimateSeconds, inline, WORDS_PER_MINUTE }
