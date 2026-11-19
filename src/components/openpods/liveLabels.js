import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import './LiveInteract.scss';

// The SDK's live-interaction text (LiveLabels in @snapie/hangouts-react): the
// poll and prediction card, the raid banner and the raid line in chat,
// translated as liveInteract.labels.<key>. Same scheme as boostLabels.js: each
// key is read on its own, a missing one falls back to the SDK's English, and
// placeholders are SINGLE braces, `{name}`, filled by the SDK.
// A plain string, split: quoted single words here would read as icon names to
// scripts/icons/scan.mjs, which would then keep their glyphs in the font.
export const LIVE_LABEL_KEYS = (
  'raidLine raidTitle raidBody raidGoNow raidStay '
  + 'pollBadge predictionBadge endsIn finalResults votes youVoted '
  + 'signInToVote voteFailed pot balance stakeButton stakePlaceholder '
  + 'yourStake waitingForResult outcomeWon youWon cancelled close'
).split(' ');

/** The labels object for `t`, keys whose text is missing left out. */
export function liveLabelsFrom(t) {
  const out = {};
  for (const k of LIVE_LABEL_KEYS) {
    const key = `liveInteract.labels.${k}`;
    const v = t(key);
    if (typeof v === 'string' && v && v !== key) out[k] = v;
  }
  return out;
}

/** The translated LiveLabels for the site language, re-read on a switch. */
export function useLiveLabels() {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage || i18n.language;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => liveLabelsFrom(t), [t, lang]);
}

/** Where a raid sends the viewer: the stream page, which itself hands an
 *  announced stream on to its watch page. */
export function raidPath(target) {
  return `/watch/${encodeURIComponent(target?.roomName || '')}`;
}
