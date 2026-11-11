import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAppStore } from '../../lib/store';
import { isAnyPromptActive } from '../../utils/welcomeGate';
import { TIPS } from './incubationTips';
import { Icon, IconButton } from '../v2/ui';
import { useTranslation } from 'react-i18next';
import './IncubationTips.scss';

const SEEN_KEY = '3speak_incubation_tips_seen';
const LAST_KEY = '3speak_incubation_tip_at';

// One tip per visit, and not straight away. A hint that appears the moment
// somebody lands is an interruption; one that appears after they have been
// reading for a couple of minutes is a hint.
const FIRST_DELAY_MS = 2 * 60 * 1000;
// And never two in the same stretch of time, however long they stay.
const MIN_GAP_MS = 6 * 60 * 60 * 1000;

const readSeen = () => {
  try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')); } catch { return new Set(); }
};
const remember = (id) => {
  try {
    const all = readSeen();
    all.add(id);
    localStorage.setItem(SEEN_KEY, JSON.stringify([...all]));
    localStorage.setItem(LAST_KEY, String(Date.now()));
  } catch { /* private mode: they may see one again */ }
};
const lastShownAt = () => {
  try { return Number(localStorage.getItem(LAST_KEY)) || 0; } catch { return 0; }
};

/**
 * Small, occasional hints about things 3Speak can do.
 *
 * A corner card rather than a modal, on purpose: it must never interrupt, it
 * must never take the one-modal-at-a-time slot the welcome and graduation
 * prompts share, and it must be ignorable. It waits for that slot to be free
 * anyway, so a hint cannot land on top of something that matters more.
 *
 * Shown to users in their warm-up only. Someone who has been on Hive for three
 * years does not need to be told what a community is.
 */
export default function IncubationTips() {
  const { t } = useTranslation();
  const incubationHandle = useAppStore((s) => s.incubationHandle);
  const authenticated = useAppStore((s) => s.authenticated);
  const [tip, setTip] = useState(null);

  useEffect(() => {
    if (!authenticated || !incubationHandle) return undefined;
    if (Date.now() - lastShownAt() < MIN_GAP_MS) return undefined;

    const timer = setTimeout(() => {
      // Checked at fire time, not when the timer was set: a prompt may have
      // opened in those two minutes.
      if (isAnyPromptActive()) return;
      const seen = readSeen();
      const next = TIPS.find((x) => !seen.has(x.id));
      // Nothing left to say. The card simply stops appearing rather than
      // starting again from the top.
      if (next) setTip(next);
    }, FIRST_DELAY_MS);

    return () => clearTimeout(timer);
  }, [authenticated, incubationHandle]);

  const dismiss = useCallback(() => {
    if (tip) remember(tip.id);
    setTip(null);
  }, [tip]);

  if (!tip) return null;

  return (
    <aside className="inct" role="note" aria-label={t('incubation.tipCard.aria')}>
      {/* Tip card (design 46a): bulb in cyan, bold title, close on the right,
          a muted line and an optional cyan link. */}
      <div className="inct-head">
        <Icon name="lightbulb" size={18} className="inct-icon" />
        <strong>{t(tip.titleKey)}</strong>
        <IconButton icon="close" label={t('incubation.tipCard.dismiss')} size={28} variant="ghost" round className="inct-close" onClick={dismiss} />
      </div>
      <p>{t(tip.bodyKey)}</p>
      {tip.to && (
        <Link to={tip.to} className="inct-cta" onClick={dismiss}>
          {tip.ctaKey ? t(tip.ctaKey) : t('incubation.tipCard.takeALook')}
          <Icon name="arrow_forward" size={14} />
        </Link>
      )}
    </aside>
  );
}
