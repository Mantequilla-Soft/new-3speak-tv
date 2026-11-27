import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

// The SDK's viewer boost text (BoostLabels in @snapie/hangouts-react): the
// Send a Boost dialog, the goal bar and the top supporters list, translated as
// live.boost.dialog.<key>. Each key is read on its own, so a missing one falls
// back to the SDK's English per key (and the i18n check skips these dynamic
// lookups). Placeholders in these strings are SINGLE braces, `{min}`: the SDK
// fills them, i18next leaves them alone (it only reads `{{x}}`).
export const BOOST_LABEL_KEYS = [
  'dialogTitle', 'close', 'success', 'done', 'presetsLabel', 'customAmount',
  'recipientsLabel', 'hostTag', 'rateHbd', 'rateHive', 'minimumHint', 'feeHint',
  'feeAmount', 'messagePlaceholder', 'cancel', 'send', 'sending', 'loading',
  'errAmount', 'errMessage', 'errMinimum', 'errNotEnabled', 'errNoWallet',
  'errConfig', 'errTransfer', 'approveHiveAuth', 'goalDefaultTitle',
  'goalProgress', 'goalReached', 'topSupporters', 'supporterAmount',
  'assetPoints', 'pointsAmount', 'pointsBalance', 'pointsHint',
  'errPointsMinimum', 'errPointsBalance', 'errSignIn', 'pointsConfirming',
];

/** The labels object for `t`, keys whose text is missing left out. */
export function boostLabelsFrom(t) {
  const out = {};
  for (const k of BOOST_LABEL_KEYS) {
    const key = `live.boost.dialog.${k}`;
    const v = t(key);
    if (typeof v === 'string' && v && v !== key) out[k] = v;
  }
  return out;
}

/** The translated BoostLabels for the site language, re-read on a switch. */
export function useBoostLabels() {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage || i18n.language;
  // `lang` re-reads the text after a language switch.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => boostLabelsFrom(t), [t, lang]);
}
