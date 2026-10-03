#!/usr/bin/env node
/**
 * Validate the interface translations in src/locales/.
 *
 *   npm run i18n:check              errors fail, missing keys are reported
 *   npm run i18n:check -- --strict  missing keys fail too
 *   npm run i18n:check -- --verbose list every missing key
 *
 * English (src/locales/en) is the source of truth. For every other language this
 * checks that each file is valid JSON, has no keys English does not have, keeps
 * every {{placeholder}} and <tag> of the English string, uses plural forms that
 * exist in that language, and that src/i18n/languages.js and the folders agree.
 * It also scans src/ for t('…') calls whose key English does not define, which is
 * how a typo'd key in code shows up before a user sees the raw key on screen.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const LOCALES = path.join(root, 'src/locales');
const SRC = path.join(root, 'src');
const args = new Set(process.argv.slice(2));
const STRICT = args.has('--strict');
const VERBOSE = args.has('--verbose');

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;
const errors = [];
const warnings = [];

function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    errors.push(`${path.relative(root, file)}: invalid JSON (${e.message})`);
    return null;
  }
}

const tokens = (s) => {
  const str = String(s);
  return [
    ...[...str.matchAll(/\{\{\s*([\w.]+)[^}]*\}\}/g)].map((m) => `{{${m[1]}}}`),
    ...[...str.matchAll(/<\/?([\w]+)\s*\/?>/g)].map((m) => `<${m[1]}>`),
  ].sort();
};

const baseKey = (k) => k.replace(PLURAL_SUFFIX, '');

function loadLanguage(code) {
  const dir = path.join(LOCALES, code);
  const out = {};
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
    const data = readJson(path.join(dir, f));
    if (data) Object.assign(out, flatten(data, f.replace(/\.json$/, '')));
  }
  return out;
}

// ---- languages.js vs folders ----
const langSrc = fs.readFileSync(path.join(SRC, 'i18n/languages.js'), 'utf8');
const declared = [...langSrc.matchAll(/code:\s*'([\w-]+)'/g)].map((m) => m[1]);
const folders = fs.readdirSync(LOCALES).filter((n) => fs.statSync(path.join(LOCALES, n)).isDirectory());
for (const c of declared) if (!folders.includes(c)) errors.push(`languages.js lists '${c}' but src/locales/${c}/ does not exist`);
for (const c of folders) if (!declared.includes(c)) errors.push(`src/locales/${c}/ exists but is not listed in src/i18n/languages.js`);

const en = loadLanguage('en');
const enBases = new Set(Object.keys(en).map(baseKey));
for (const [k, v] of Object.entries(en)) {
  if (typeof v !== 'string') errors.push(`en: ${k} must be a string`);
}

// ---- each language against English ----
const report = [];
for (const code of folders.filter((c) => c !== 'en').sort()) {
  const tr = loadLanguage(code);
  let categories;
  try { categories = new Intl.PluralRules(code).resolvedOptions().pluralCategories; } catch { categories = ['one', 'other']; }
  const missing = [];
  let translated = 0;

  for (const [k, v] of Object.entries(tr)) {
    const m = k.match(PLURAL_SUFFIX);
    if (typeof v !== 'string') { errors.push(`${code}: ${k} must be a string`); continue; }
    if (m) {
      if (!enBases.has(baseKey(k)) || !(`${baseKey(k)}_other` in en)) errors.push(`${code}: ${k} is a plural of a key English does not pluralise`);
      else if (!categories.includes(m[1]) && m[1] !== 'zero') errors.push(`${code}: ${k} — '${m[1]}' is not a plural form in this language (use: ${categories.join(', ')})`);
    } else if (!(k in en)) {
      errors.push(`${code}: ${k} does not exist in English (renamed or removed?)`);
      continue;
    }
    const ref = en[k] ?? en[`${baseKey(k)}_other`];
    if (ref !== undefined) {
      // A plural form may legitimately drop {{count}} ("one comment"), so only
      // check the other placeholders there.
      const want = tokens(ref).filter((t) => !(m && t === '{{count}}'));
      const have = tokens(v);
      const lost = want.filter((t) => !have.includes(t));
      const extra = have.filter((t) => !tokens(ref).includes(t));
      if (lost.length) errors.push(`${code}: ${k} is missing ${lost.join(' ')} (English: "${ref}")`);
      if (extra.length) errors.push(`${code}: ${k} has unknown ${extra.join(' ')} (English: "${ref}")`);
    }
  }

  for (const k of Object.keys(en)) {
    const m = k.match(PLURAL_SUFFIX);
    if (m) {
      if (m[1] !== 'other') continue; // judge each plural group once
      const b = baseKey(k);
      const need = categories.filter((c) => c !== 'zero');
      const has = need.filter((c) => `${b}_${c}` in tr);
      if (has.length === need.length) translated++;
      else missing.push(`${b}_{${need.filter((c) => !has.includes(c)).join(',')}}`);
    } else if (k in tr) translated++;
    else missing.push(k);
  }
  const total = Object.keys(en).filter((k) => !PLURAL_SUFFIX.test(k) || k.endsWith('_other')).length;
  report.push({ code, translated, total, missing });
  if (missing.length) (STRICT ? errors : warnings).push(`${code}: ${missing.length} missing key(s)${VERBOSE ? `\n    ${missing.join('\n    ')}` : ''}`);
}

// ---- keys used in code but absent from English ----
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'locales') walk(p, out); }
    else if (/\.(jsx?|tsx?)$/.test(e.name)) out.push(p);
  }
  return out;
}
const areas = new Set(fs.readdirSync(path.join(LOCALES, 'en')).map((f) => f.replace(/\.json$/, '')));
for (const file of walk(SRC)) {
  const src = fs.readFileSync(file, 'utf8');
  for (const m of src.matchAll(/(?<![\w.$])(?:t|i18n\.t)\(\s*['"`]([\w-]+(?:\.[\w-]+)+)['"`]/g)) {
    const key = m[1];
    if (!areas.has(key.split('.')[0])) continue; // not one of ours (e.g. a URL helper)
    if (!(key in en) && !(`${key}_other` in en)) {
      const line = src.slice(0, m.index).split('\n').length;
      errors.push(`${path.relative(root, file)}:${line}: t('${key}') — key not in src/locales/en`);
    }
  }
}

// ---- output ----
console.log('\nTranslation coverage');
for (const r of report) {
  const pct = r.total ? Math.round((r.translated / r.total) * 100) : 100;
  console.log(`  ${r.code.padEnd(4)} ${String(pct).padStart(3)}%  ${r.translated}/${r.total}`);
}
if (warnings.length) console.log(`\nWarnings (${warnings.length}) — missing keys fall back to English:\n  ${warnings.join('\n  ')}`);
if (errors.length) {
  console.error(`\nErrors (${errors.length}):\n  ${errors.join('\n  ')}`);
  process.exit(1);
}
console.log('\n✓ translations OK');
