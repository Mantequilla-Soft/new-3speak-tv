import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

// The SDK's live battle meter text (BattleLabels in @snapie/hangouts-react),
// translated as battles.bar.<key>. Same pattern as boostLabels.js: each key is
// read on its own, so a missing one falls back to the SDK's English. The
// placeholders are SINGLE braces, `{name}`: the SDK fills them, i18next leaves
// them alone.
export const BATTLE_LABEL_KEYS = [
  'title', 'startsIn', 'timeLeft', 'counting', 'amount', 'wins', 'tie',
  'endedEarly', 'dropped', 'boostHint',
];

/** The labels object for `t`, keys whose text is missing left out. */
export function battleLabelsFrom(t) {
  const out = {};
  for (const k of BATTLE_LABEL_KEYS) {
    const key = `battles.bar.${k}`;
    const v = t(key);
    if (typeof v === 'string' && v && v !== key) out[k] = v;
  }
  return out;
}

/** The translated BattleLabels for the site language, re-read on a switch. */
export function useBattleLabels() {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage || i18n.language;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => battleLabelsFrom(t), [t, lang]);
}
