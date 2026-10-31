import { useEffect, useState } from 'react';
import { useAppStore } from '../lib/store';

// The card size actually in use. "Large cards" is a mobile-only setting: on
// desktop the cards are always small, whatever was saved (the toggle is
// hidden there too, see SettingsModal). The saved choice is left alone, so a
// phone keeps it.
export const CARD_SIZE_MOBILE_QUERY = '(max-width: 768px)';

export function useIsCardSizeMobile() {
  const [mobile, setMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(CARD_SIZE_MOBILE_QUERY).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(CARD_SIZE_MOBILE_QUERY);
    const onChange = () => setMobile(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return mobile;
}

export default function useCardSize() {
  const saved = useAppStore((s) => s.homeCardSize);
  const mobile = useIsCardSizeMobile();
  return mobile && saved === 'large' ? 'large' : 'small';
}
