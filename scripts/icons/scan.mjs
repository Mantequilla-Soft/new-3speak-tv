#!/usr/bin/env node
/**
 * Find every Material Symbols icon name the app uses.
 *
 * The full Material Symbols Rounded font is 4.5 MB (3,776 icons, 4 variation
 * axes) and blocked the first paint of every page. We ship a subset instead
 * (src/styles/fonts/material-symbols-rounded-subset.woff2) holding only the
 * icons listed in src/styles/fonts/material-symbols-rounded.icons.json.
 *
 * An icon name is "used" when it appears in src/ as a quoted word ('home',
 * "play_arrow", `close`), as the text of a .material-symbols-rounded element,
 * or as a CSS content: "name". This over-collects a little (a quoted 'search'
 * that is not an icon still keeps the search icon), which only costs a few
 * hundred bytes. Missing one is worse: the icon would render as its raw name.
 *
 * Names built at runtime cannot be seen by the scan: list them in EXTRA_ICONS.
 *
 *   npm run icons:subset       (scan + rebuild the subset font, needs Python fontTools)
 *   node scripts/icons/scan.mjs --check   (exit 1 if a used icon is not in the subset)
 *
 * tests/unit/iconFontSubset.test.js runs the same check, so a new icon that is
 * not in the subset fails the tests instead of showing up as text.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const ALL_NAMES_FILE = path.join(ROOT, 'scripts/icons/all-icon-names.json');
export const SUBSET_NAMES_FILE = path.join(ROOT, 'src/styles/fonts/material-symbols-rounded.icons.json');

// Icon names put together at runtime, which the scan cannot find.
export const EXTRA_ICONS = [
  // GlobalAudioPlayer + AudioPost: `replay_${SKIP_BACK}` / `forward_${SKIP_FORWARD}`
  // (playerMath.js, 10 s today). Keep every step the font has, in case it changes.
  'replay_5', 'replay_10', 'replay_30',
  'forward_5', 'forward_10', 'forward_30',
];

const FILE_RE = /\.(jsx?|tsx?|mjs|s?css|html|json)$/;
const QUOTED_RE = /["'`]([a-z0-9_]+)["'`]/g;
const SPAN_RE = /material-symbols-rounded[^>]*>\s*([a-z0-9_]+)\s*</g;
const CONTENT_RE = /content:\s*["']([a-z0-9_]+)["']/g;

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      // Translations hold prose, not icon names; the generated list is our output.
      if (e.name === 'locales' || e.name === 'fonts') continue;
      yield* walk(p);
    } else if (FILE_RE.test(e.name)) {
      yield p;
    }
  }
}

/** Every icon name used in the app, sorted. */
export function findUsedIcons(allNames = JSON.parse(fs.readFileSync(ALL_NAMES_FILE, 'utf8'))) {
  const known = new Set(allNames);
  const found = new Set();
  const files = [...walk(path.join(ROOT, 'src')), path.join(ROOT, 'index.html')];
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    for (const re of [QUOTED_RE, SPAN_RE, CONTENT_RE]) {
      for (const m of text.matchAll(re)) if (known.has(m[1])) found.add(m[1]);
    }
  }
  for (const name of EXTRA_ICONS) {
    if (!known.has(name)) throw new Error(`EXTRA_ICONS: "${name}" is not a Material Symbols icon`);
    found.add(name);
  }
  return [...found].sort();
}

/** Used icons that the shipped subset font does not contain. */
export function missingFromSubset() {
  const subset = new Set(JSON.parse(fs.readFileSync(SUBSET_NAMES_FILE, 'utf8')));
  return findUsedIcons().filter((n) => !subset.has(n));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) {
    const missing = missingFromSubset();
    if (missing.length) {
      console.error(`Icons used but missing from the subset font: ${missing.join(', ')}\nRun: npm run icons:subset`);
      process.exit(1);
    }
    console.log('icon font subset covers every used icon');
  } else {
    // Print the used names as JSON (read by subset.py).
    process.stdout.write(JSON.stringify(findUsedIcons()));
  }
}
