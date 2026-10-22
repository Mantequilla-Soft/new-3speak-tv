#!/usr/bin/env node
/**
 * Print the GitHub Release notes for one production version.
 *
 *   node scripts/release-notes.mjs <previous-version> <version> [<date>]
 *
 * The notes are the src/changelog.js entries newer than <previous-version> and
 * up to <version>, newest first: the same text users see in the "We shipped an
 * update" popup. <date> (YYYY-MM-DD) is the day the version reached production;
 * it defaults to today. Used by .github/workflows/deploy-production.yml after
 * every deploy that bumps APP_VERSION.
 */
import { changelogSince } from '../src/changelog.js';

const [prev, version, date = new Date().toISOString().slice(0, 10)] = process.argv.slice(2);
if (!prev || !version) {
  console.error('usage: release-notes.mjs <previous-version> <version> [<date>]');
  process.exit(1);
}

// Numeric x.y.z compare, so 1.80.11 sorts after 1.80.9.
const atMost = (a, b) => {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) < (pb[i] || 0);
  return true;
};

const entries = changelogSince(prev).filter((e) => atMost(e.version, version));

const lines = [`Released to [3speak.tv](https://3speak.tv) on ${date}.`, ''];
if (entries.length) {
  lines.push("## What's new", '');
  for (const e of entries) lines.push(`- **${e.version}**: ${e.summary.replace(/\s+/g, ' ').trim()}`);
} else {
  lines.push('Behind-the-scenes changes only, nothing new to point at.');
}
lines.push('', `Previous version: ${prev}`);
console.log(lines.join('\n'));
