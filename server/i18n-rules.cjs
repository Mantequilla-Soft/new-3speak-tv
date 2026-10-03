/**
 * Validation rules for community translations (server copy, CommonJS).
 *
 * 🚨 KEEP IN STEP WITH src/i18n/rules.js. The in-app editor checks a string with
 * that file before saving and this server checks it again with this one; the two
 * must agree or the editor says "fine" and the server says "no". Both follow
 * scripts/i18n/check.mjs (placeholders, tag names, plural suffixes), so a string
 * that passes here also passes the CI check once it lands in a pull request.
 * `node server/i18n-editor.test.cjs` runs the same cases through both copies.
 */

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/
const LANG_CODE_RE = /^[a-z]{2,3}(-[A-Z]{2})?$/
const KEY_RE = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)+$/
const MAX_KEY_LEN = 200
const MAX_VALUE_LEN = 2000
const MAX_LANG_NAME_LEN = 40
const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor'])
// Every C0 control character except \n, plus DEL.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0009\u000B-\u001F\u007F]/
const has = (obj, k) => Object.prototype.hasOwnProperty.call(obj, k)
const PLURAL_FORMS = ['zero', 'one', 'two', 'few', 'many', 'other']

function flatten (obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out)
    else out[key] = v
  }
  return out
}

// Same as check.mjs: {{name}} placeholders and <name> / </name> / <name/> tags.
function tokens (s) {
  const str = String(s)
  return [
    ...[...str.matchAll(/\{\{\s*([\w.]+)[^}]*\}\}/g)].map((m) => `{{${m[1]}}}`),
    ...[...str.matchAll(/<\/?([\w]+)\s*\/?>/g)].map((m) => `<${m[1]}>`)
  ].sort()
}

const baseKey = (k) => k.replace(PLURAL_SUFFIX, '')

/** Plural categories for a language; a code Intl does not know gets one/other. */
function pluralCategories (code) {
  try {
    if (!Intl.PluralRules.supportedLocalesOf([code]).length) return ['one', 'other']
    return new Intl.PluralRules(code).resolvedOptions().pluralCategories
  } catch {
    return ['one', 'other']
  }
}

function isValidKeyShape (key) {
  return typeof key === 'string' && key.length <= MAX_KEY_LEN && KEY_RE.test(key) &&
    !key.split('.').some((seg) => FORBIDDEN_SEGMENTS.has(seg))
}

/**
 * Is `key` a row of the target language? Strict shape, and either an English key
 * or a plural form of one that the language uses. Returns an error message, or null.
 */
function validateKey (key, en, categories) {
  if (!isValidKeyShape(key)) return 'Invalid key'
  const m = key.match(PLURAL_SUFFIX)
  if (m) {
    if (!has(en, `${baseKey(key)}_other`)) return 'Not a plural form English uses for this text'
    if (!categories.includes(m[1]) && m[1] !== 'zero') {
      return `'${m[1]}' is not a plural form in this language (use: ${categories.join(', ')})`
    }
  } else if (!has(en, key)) {
    return 'This key does not exist in English'
  }
  return null
}

/**
 * Check one translated string. `en` is the FLAT English source, `categories` the
 * plural categories of the target language. Returns an error message, or null.
 */
function validateEntry (key, value, en, categories) {
  const keyErr = validateKey(key, en, categories)
  if (keyErr) return keyErr
  const m = key.match(PLURAL_SUFFIX)
  const base = baseKey(key)

  if (typeof value !== 'string') return 'Must be text'
  if (!value.trim()) return 'Empty; reset the row instead to fall back to English'
  if (value.length > MAX_VALUE_LEN) return `Longer than ${MAX_VALUE_LEN} characters`
  if (CONTROL_CHARS.test(value)) return 'Contains control characters (only line breaks are allowed)'

  const ref = String(has(en, key) ? en[key] : en[`${base}_other`])

  // Markup that has no business in an interface string, whatever English says.
  if (/<\s*\/?\s*script/i.test(value)) return 'Script tags are not allowed'
  if (/javascript\s*:/i.test(value) || /vbscript\s*:/i.test(value) || /data\s*:\s*text\/html/i.test(value)) {
    return 'Script URLs are not allowed'
  }
  if (/\bon[a-z]+\s*=/i.test(value)) return 'Event-handler attributes are not allowed'
  if (value.includes('$t(') && !ref.includes('$t(')) return 'Nested $t(…) references are not allowed'

  // Tags: only the tag NAMES English uses, and never with attributes.
  const enTags = new Set([...ref.matchAll(/<\/?([\w]+)\s*\/?>/g)].map((x) => x[1]))
  for (const t of value.matchAll(/<(\/?)([\w-]+)([^<>]*)>/g)) {
    if (t[3].replace(/[\s/]/g, '') !== '') return `Tag <${t[2]}> cannot have attributes`
    if (!enTags.has(t[2])) return `Tag <${t[2]}> is not in the English text`
  }

  // Same rule as check.mjs. A plural form may drop {{count}} ("one comment"), and
  // may use any token from ANY English form of that text: Russian "one" also covers
  // 21, 31…, so it needs {{count}} even where English "one" reads "Upload a video".
  const refTokens = m
    ? [...new Set(PLURAL_FORMS.flatMap((c) => (has(en, `${base}_${c}`) ? tokens(en[`${base}_${c}`]) : [])))]
    : tokens(ref)
  const want = refTokens.filter((t) => !(m && t === '{{count}}'))
  const haveTokens = tokens(value)
  const lost = want.filter((t) => !haveTokens.includes(t))
  const extra = haveTokens.filter((t) => !refTokens.includes(t))
  if (lost.length) return `Missing ${lost.join(' ')}`
  if (extra.length) return `Unknown ${extra.join(' ')}`
  return null
}

/**
 * Validate a whole batch `{ key: value | null }` (null = remove the override).
 * Returns { errors, sets, deletes }; apply nothing when `errors` is non-empty.
 * `existing` is the language's current overlay (removal is only for keys it has).
 */
function validateBatch (changes, en, categories, existing = {}) {
  const errors = {}
  const sets = {}
  const deletes = []
  for (const [key, value] of Object.entries(changes)) {
    if (value === null) {
      if (!isValidKeyShape(key)) errors[key] = 'Invalid key'
      else if (has(existing, key)) deletes.push(key)
      // Removing something that is not there is a harmless no-op.
      continue
    }
    const err = validateEntry(key, value, en, categories)
    if (err) errors[key] = err
    else sets[key] = value
  }
  return { errors, sets, deletes }
}

/**
 * Fingerprint of a string for proofread marks: 64-bit FNV-1a over the UTF-8 bytes,
 * as 16 hex characters. A mark stores the fingerprint of the exact text the
 * translator saw; when the text changes, the fingerprints differ and the mark is
 * stale. Not a security hash (it only has to notice edits), but synchronous and
 * identical in the browser and on the server, which sha256 cannot be.
 * The 64-bit multiply by the FNV prime (2^40 + 0x1b3) is done on two 32-bit halves.
 */
function proofHash (value) {
  let hi = 0xcbf29ce4
  let lo = 0x84222325
  const byte = (b) => {
    lo = (lo ^ b) >>> 0
    const low = lo * 0x1b3
    const carry = Math.floor(low / 0x100000000)
    hi = (hi * 0x1b3 + carry + ((lo << 8) >>> 0)) >>> 0
    lo = low >>> 0
  }
  for (const ch of String(value)) {
    const c = ch.codePointAt(0)
    if (c < 0x80) byte(c)
    else if (c < 0x800) { byte(0xc0 | (c >> 6)); byte(0x80 | (c & 63)) } else if (c < 0x10000) {
      byte(0xe0 | (c >> 12)); byte(0x80 | ((c >> 6) & 63)); byte(0x80 | (c & 63))
    } else {
      byte(0xf0 | (c >> 18)); byte(0x80 | ((c >> 12) & 63)); byte(0x80 | ((c >> 6) & 63)); byte(0x80 | (c & 63))
    }
  }
  return hi.toString(16).padStart(8, '0') + lo.toString(16).padStart(8, '0')
}

/** Plain-text language name: 1-40 chars, no markup or quotes-breaking characters. */
function validateLanguageName (s) {
  if (typeof s !== 'string') return 'Must be text'
  const v = s.trim()
  if (!v) return 'Required'
  if (v.length > MAX_LANG_NAME_LEN) return `Longer than ${MAX_LANG_NAME_LEN} characters`
  if (CONTROL_CHARS.test(v) || v.includes('\n')) return 'Contains control characters'
  if (/[<>{}`\\$]/.test(v)) return 'Plain text only'
  return null
}

module.exports = {
  PLURAL_SUFFIX,
  LANG_CODE_RE,
  MAX_VALUE_LEN,
  MAX_LANG_NAME_LEN,
  flatten,
  tokens,
  baseKey,
  pluralCategories,
  isValidKeyShape,
  validateKey,
  validateEntry,
  validateBatch,
  validateLanguageName,
  proofHash
}
