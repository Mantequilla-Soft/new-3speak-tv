#!/usr/bin/env node
/**
 * Fill MISSING interface translations with Claude.
 *
 *   ANTHROPIC_API_KEY=… npm run i18n:translate                 every language
 *   ANTHROPIC_API_KEY=… npm run i18n:translate -- --lang es,de  just these
 *   npm run i18n:translate -- --lang es --dry-run              show what would be sent
 *
 * It only ever ADDS keys a language does not have yet. A translation that exists —
 * whether a person wrote it in a pull request or an earlier run produced it — is
 * never touched, so human corrections survive every later run.
 *
 * If you change what an English string MEANS, give it a new key instead of editing
 * the text in place: the old translations then drop out (npm run i18n:check flags
 * them) and the new key gets translated fresh on the next run.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const LOCALES = path.join(root, 'src/locales');
const MODEL = 'claude-opus-5-5';
const CHUNK = 120;

const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const DRY = argv.includes('--dry-run');

const langSrc = fs.readFileSync(path.join(root, 'src/i18n/languages.js'), 'utf8');
const LANGS = Object.fromEntries([...langSrc.matchAll(/code:\s*'([\w-]+)'[^}]*english:\s*'([^']+)'/g)].map((m) => [m[1], m[2]]));
const targets = (opt('--lang')?.split(',') || Object.keys(LANGS)).filter((c) => c !== 'en');

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

const GUIDE = `You translate the user interface of 3Speak (3speak.tv), a video platform on the Hive blockchain, from English.

Rules:
- Keep it short, friendly and natural, the way a native-speaking app would say it. Buttons stay as short as the English.
- Use the informal "you" where the language has one and it is normal for consumer apps (Spanish tú, German du, French vous is fine, Portuguese você).
- Never translate these names: 3Speak, Hive, HBD, HIVE, Hive Power, HP, Keychain, HiveSigner, HiveAuth, PeakVault, Ledger, Ecency, PeakD, OpenPods, ButrAuth, Shorts, Snaps, IPFS, OBS, Discord, Telegram, YouTube, Podping, RC.
- "Upvote"/"vote" means a Hive vote that pays the creator: use the word Hive users in that language already use (often the English word is fine).
- Keep every {{placeholder}} exactly as written, and keep <0>…</0>-style tags around the matching words.
- Plural keys: you are given the English "other" form and asked for each plural category the target language needs (e.g. Polish one/few/many/other, Japanese only other). Include {{count}} where natural.
- Keep emoji, punctuation style (… not ...) and leading/trailing spaces as in the English.
- The key name hints at where the text appears (e.g. "upload.errors.tooLarge" is an error during upload). Use it for context; do not translate the key.`;

function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}

// Rebuild nesting in ENGLISH order, so every language file diffs line-for-line
// against en and reviewers can read a PR side by side.
function nestLike(enObj, flat, prefix = '') {
  const out = {};
  for (const [k, v] of Object.entries(enObj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') {
      const child = nestLike(v, flat, key);
      if (Object.keys(child).length) out[k] = child;
    } else if (PLURAL_SUFFIX.test(k)) {
      if (!k.endsWith('_other')) continue;
      const base = k.replace(PLURAL_SUFFIX, '');
      for (const c of ['zero', 'one', 'two', 'few', 'many', 'other']) {
        if (`${prefix ? `${prefix}.` : ''}${base}_${c}` in flat) out[`${base}_${c}`] = flat[`${prefix ? `${prefix}.` : ''}${base}_${c}`];
      }
    } else if (key in flat) out[k] = flat[key];
  }
  return out;
}

const readJson = (p) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {});

function missingFor(code, enFlat, trFlat) {
  const cats = new Intl.PluralRules(code).resolvedOptions().pluralCategories;
  const need = [];
  for (const [k, v] of Object.entries(enFlat)) {
    if (PLURAL_SUFFIX.test(k)) {
      if (!k.endsWith('_other')) continue;
      const base = k.replace(PLURAL_SUFFIX, '');
      const wanted = cats.filter((c) => !(`${base}_${c}` in trFlat));
      if (wanted.length) need.push({ key: base, english: v, englishOne: enFlat[`${base}_one`], pluralForms: wanted });
    } else if (!(k in trFlat)) need.push({ key: k, english: v });
  }
  return need;
}

const SCHEMA = {
  type: 'object',
  properties: {
    translations: {
      type: 'array',
      items: {
        type: 'object',
        properties: { key: { type: 'string' }, text: { type: 'string' } },
        required: ['key', 'text'],
        additionalProperties: false,
      },
    },
  },
  required: ['translations'],
  additionalProperties: false,
};

async function translateChunk(client, langName, items) {
  const request = items.map((it) => (it.pluralForms
    ? { key: it.key, english_one: it.englishOne, english_other: it.english, return_keys: it.pluralForms.map((c) => `${it.key}_${c}`) }
    : { key: it.key, english: it.english }));
  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: 64000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
    system: GUIDE,
    messages: [{
      role: 'user',
      content: `Translate into ${langName}. For plural entries return one item per name in return_keys.\n\n${JSON.stringify(request, null, 1)}`,
    }],
  });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === 'refusal') throw new Error(`refused: ${msg.stop_details?.explanation || 'no detail'}`);
  if (msg.stop_reason === 'max_tokens') throw new Error('response cut off (max_tokens)');
  const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return JSON.parse(text).translations;
}

async function main() {
  const enFiles = fs.readdirSync(path.join(LOCALES, 'en')).filter((f) => f.endsWith('.json')).sort();
  const client = DRY ? null : new Anthropic();

  for (const code of targets) {
    if (!LANGS[code]) { console.error(`unknown language '${code}' (add it to src/i18n/languages.js first)`); process.exitCode = 1; continue; }
    fs.mkdirSync(path.join(LOCALES, code), { recursive: true });
    for (const file of enFiles) {
      const area = file.replace(/\.json$/, '');
      const enObj = readJson(path.join(LOCALES, 'en', file));
      const enFlat = flatten(enObj);
      const trPath = path.join(LOCALES, code, file);
      const trFlat = flatten(readJson(trPath));
      const need = missingFor(code, enFlat, trFlat);
      if (!need.length) continue;
      console.log(`${code}/${file}: ${need.length} to translate`);
      if (DRY) continue;

      for (let i = 0; i < need.length; i += CHUNK) {
        const items = need.slice(i, i + CHUNK);
        const allowed = new Set(items.flatMap((it) => (it.pluralForms ? it.pluralForms.map((c) => `${it.key}_${c}`) : [it.key])));
        const out = await translateChunk(client, LANGS[code], items);
        for (const { key, text } of out) if (allowed.has(key) && !(key in trFlat)) trFlat[key] = text;
        // Write after every chunk, so an interrupted run keeps what it paid for.
        fs.writeFileSync(trPath, `${JSON.stringify(nestLike(enObj, trFlat), null, 2)}\n`);
      }
    }
  }
  console.log('\nDone. Run `npm run i18n:check` next.');
}

main().catch((e) => {
  if (e instanceof Anthropic.AuthenticationError) console.error('Set ANTHROPIC_API_KEY (or run `ant auth login`).');
  else if (e instanceof Anthropic.RateLimitError) console.error('Rate limited, run it again in a minute; finished files are kept.');
  else if (e instanceof Anthropic.APIError) console.error(`API error ${e.status}: ${e.message}`);
  else console.error(e);
  process.exit(1);
});
