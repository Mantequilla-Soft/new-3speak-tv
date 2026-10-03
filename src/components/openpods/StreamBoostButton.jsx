import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Rocket } from 'lucide-react';
import { SendBoostDialog, useStreamContext } from '@snapie/hangouts-react';
import { useAppStore } from '../../lib/store';
import { withHiveAuthWaiting } from '../../hive-api/aioha';
import './StreamBoostButton.scss';

/**
 * Send a boost to a live streamer.
 *
 * The receiving half of boosts was already wired — <StreamVideo> renders
 * <BoostOverlay>, so boosts played over the stream — but nothing ever mounted
 * the SEND dialog, which made the feature look broken: viewers could see boosts
 * but had no way to send one.
 *
 * MUST be rendered inside <StandaloneWatch>: the room's boost config and guest
 * flag come from the stream context, and SendBoostDialog reads the API base and
 * signing wallet from the Hangouts provider above it.
 *
 * `variant` picks the shape for the surface it sits on:
 *   - `rail`    shorts-style action rail (mobile stream page)
 *   - `button`  a normal watch-page action button
 *   - `overlay` floats over the player, next to the viewer count
 */
export default function StreamBoostButton({ variant = 'button' }) {
  const { t } = useTranslation();
  const { roomName, boostConfig, isGuest } = useStreamContext();
  const authenticated = useAppStore((s) => s.authenticated);
  const [open, setOpen] = useState(false);

  // Boosts are real Hive transfers, so a guest or signed-out viewer has nothing
  // to send them with. Hide rather than disable — an inert boost button on a
  // stream reads as a bug.
  if (boostConfig?.enabled === false || !authenticated || isGuest) return null;

  const label = t('live.boost.label');
  return (
    <>
      {variant === 'rail' ? (
        <div className="actionItem" onClick={() => setOpen(true)}>
          <div className="actionButton"><Rocket size={24} /></div>
          <span className="actionLabel">{label}</span>
        </div>
      ) : variant === 'overlay' ? (
        <button
          type="button"
          className="stream-boost-btn stream-boost-btn--overlay"
          onClick={() => setOpen(true)}
          title={t('live.boost.sendTo', { user: roomName.split('-')[0] })}
        >
          <Rocket size={15} /><span>{label}</span>
        </button>
      ) : (
        <button type="button" className="pv-btn stream-boost-btn" onClick={() => setOpen(true)} title={t('live.boost.send')}>
          <Rocket size={14} /><span>{label}</span>
        </button>
      )}

      {open && (
        <SendBoostDialog
          roomName={roomName}
          /* Show 3Speak's HiveAuth waiting overlay while the tx is pending, so a
             HiveAuth user knows to open their app and sign. No-op for other
             providers (the wrapper checks the current provider itself). */
          signWrapper={withHiveAuthWaiting}
          // A room created before boosts were configurable has no block at all;
          // treat that as enabled with no minimum rather than refusing to open.
          boostConfig={boostConfig ?? { enabled: true, minBoostUsd: 0 }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
