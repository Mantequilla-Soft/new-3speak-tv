# Translating 3Speak

3Speak's menus, buttons and messages are available in several languages. The first
version of each language was machine-translated, so some of it will sound stiff or
just be wrong. **Native speakers fixing that is the most valuable help there is**,
and you don't need to be a programmer to do it.

Everything happens through GitHub pull requests. There is no translation website
to sign up for.

## How it is organised

```
src/locales/
  en/            ← English, the source of every other language
    common.json
    watch.json
    upload.json
    …
  es/            ← Spanish: the same files, same keys, Spanish text
  de/
  …
```

Each file covers one area of the app (`watch.json` is the watch page, `upload.json`
the upload flow, `wallet.json` the wallet, and so on). Inside, every line is a
**key** and its **text**:

```json
{
  "comments": {
    "title": "Comments",
    "replyPlaceholder": "Write a reply…"
  }
}
```

You only ever change the text on the right. The keys on the left must stay exactly
as they are in English, or the app can't find your text.

## Fix or improve a translation

1. Open the file on GitHub, e.g. `src/locales/es/watch.json`, and click the ✏️
   pencil ("Edit this file"). GitHub makes a copy for you automatically.
2. Change the text. Compare with the same line in `src/locales/en/…` when you are
   unsure what it means or where it appears.
3. Click **Commit changes** → **Propose changes** → **Create pull request**. Say in
   a sentence what you improved.

That's it. An automatic check runs on your pull request and tells you if anything
is off (see "The rules" below). A maintainer reviews and merges it.

A key that is missing from a language file simply shows the English text, so it
is fine to translate only part of a file.

## Add a new language

1. Copy the `src/locales/en/` folder to `src/locales/<code>/`, using the
   two-letter [ISO 639-1 code](https://en.wikipedia.org/wiki/List_of_ISO_639-1_codes)
   (`nl` for Dutch, `hi` for Hindi, `vi` for Vietnamese, …).
2. Add one line to `src/i18n/languages.js`:
   ```js
   { code: 'nl', native: 'Nederlands', english: 'Dutch' },
   ```
   `native` is how the language names itself; that is what people see in the
   language menu.
3. Translate as much as you like, then open a pull request. Maintainers can fill
   in whatever is left with the machine translator (below) so the language is
   complete from day one, and you and others refine it over time.

Right-to-left languages (Arabic, Hebrew, Persian, Urdu) also need
`dir: 'rtl'` on that line. The layout has not been reviewed right-to-left yet, so
expect some rough edges there.

## The rules (the automatic check enforces these)

- **Keep `{{placeholders}}` exactly.** `"Sent {{amount}} to @{{user}}"` must still
  contain `{{amount}}` and `{{user}}`; move them wherever your grammar needs them.
- **Keep tags around the right words.** In `"Read our <termsLink>terms</termsLink>"`
  the part inside `<termsLink>…</termsLink>` becomes a link. Keep the tags, translate
  what is inside and around them.
- **Plurals.** Keys ending in `_one` / `_other` are the singular/plural forms of
  one text. Your language may need different forms: Polish and Russian use
  `_one`, `_few`, `_many`, `_other`; Japanese, Korean, Chinese and Indonesian only
  `_other`. Use the forms your language needs; the check tells you which ones
  those are.
- **Don't translate names**: 3Speak, Hive, HBD, HIVE, Hive Power, Keychain,
  HiveSigner, HiveAuth, PeakVault, Ledger, OpenPods, Shorts, Snaps, IPFS.
- **Don't add keys** that English doesn't have, and keep the JSON valid (quotes,
  commas). The pencil editor on GitHub highlights JSON mistakes.

Style: short and natural, the way a well-made app in your language talks. Buttons
should stay roughly as short as the English. Use the informal "you" where that is
normal for apps in your language.

---

## For developers

**Using translations in code**

```jsx
import { useTranslation, Trans } from 'react-i18next';

function UploadButton({ count }) {
  const { t } = useTranslation();
  return (
    <>
      <button>{t('common.actions.upload')}</button>
      <p>{t('upload.filesSelected', { count })}</p>
      <Trans i18nKey="auth.readTerms" components={{ termsLink: <a href="/terms" /> }} />
    </>
  );
}
```

```json
"filesSelected_one": "{{count}} file selected",
"filesSelected_other": "{{count}} files selected"
```

Outside components (utils, stores) use `import { t } from '../i18n'`, and only
call it when the text is needed, never at module top level (it would freeze the
text in whatever language was active when the file loaded). Dates and numbers:
`formatTimeAgo`, `formatDate`, `formatNumber` from `src/i18n`.

**New text** goes into the English file of that area (`src/locales/en/*.json`)
only. Other languages fall back to English until they are translated.

**Changing the meaning of existing English text?** Give it a new key instead of
editing it in place. The old translations then show up as stale in the check and
the new key gets translated fresh. Fixing a typo in place is fine.

**Commands**

```bash
npm run i18n:check                 # validate all languages, show coverage
npm run i18n:check -- --verbose    # list every missing key
npm run i18n:translate             # machine-translate every MISSING key (needs ANTHROPIC_API_KEY)
npm run i18n:translate -- --lang es,pt
```

`i18n:translate` only adds keys a language doesn't have yet. It never overwrites
an existing translation, so corrections made by people are safe across runs. Run
it after adding English strings, then `i18n:check`, then commit the result.
