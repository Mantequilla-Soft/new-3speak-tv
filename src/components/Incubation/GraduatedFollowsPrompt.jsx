import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toastIn } from '../../utils/toast';
import { useAppStore } from '../../lib/store';
import { fetchGraduatedFollows, ackGraduatedFollow } from '../../lib/incubation';
import { followWithAioha } from '../../hive-api/aioha';
import { useTranslation } from 'react-i18next';
import { Button } from '../v2/ui';
import './GraduatedFollowsPrompt.scss';

const toast = toastIn('Follows');

/**
 * "Someone you follow here just got a real Hive account."
 *
 * A follow of an incubating handle can never reach the chain: when it was made
 * there was no account to follow, and only the follower could sign it anyway.
 * So the moment that creator graduates, the follow is stranded and neither side
 * knows. This is the only thing that closes that loop.
 *
 * It asks once per session, per signed-in viewer, as the 46c card: a small
 * floating card in the corner (never the modal slot the welcome and graduation
 * prompts share), one upgraded account at a time, "Got it" beside a cyan
 * "Follow for real". "Got it" is an answer too: asking again every session for
 * someone they have decided not to follow would be nagging. An incubating
 * viewer cannot sign a follow, so they only get the news and "Got it"; their
 * own follow moves on chain when they graduate and replay it.
 */
export default function GraduatedFollowsPrompt() {
  const { t } = useTranslation();
  const authenticated = useAppStore((s) => s.authenticated);
  const user = useAppStore((s) => s.user);
  const incubationHandle = useAppStore((s) => s.incubationHandle);
  const askedRef = useRef(false);
  const [queue, setQueue] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!authenticated || askedRef.current) return undefined;
    if (!user && !incubationHandle) return undefined;
    askedRef.current = true;

    let alive = true;
    fetchGraduatedFollows()
      .then(({ items }) => {
        if (alive && items?.length) setQueue(items);
      })
      .catch(() => { /* nothing to say if we cannot ask */ });
    return () => { alive = false; };
  }, [authenticated, user, incubationHandle]);

  const current = queue[0];
  if (!current) return null;

  const next = () => setQueue((q) => q.slice(1));

  const gotIt = () => {
    ackGraduatedFollow(current.handle).catch(() => {});
    next();
  };

  const followForReal = async () => {
    setBusy(true);
    try {
      await followWithAioha(current.hiveUsername, true);
      await ackGraduatedFollow(current.handle);
      toast.success(t('incubation.graduatedFollows.nowFollowing', { hiveUsername: current.hiveUsername }));
      next();
    } catch (err) {
      toast.error(err?.message || t('incubation.graduatedFollows.followFailed'));
    } finally {
      setBusy(false);
    }
  };

  const title = t('incubation.graduatedFollows.title');
  return createPortal(
    <section className="grad-follows" role="status" aria-label={title}>
      <b className="grad-follows__title">{title}</b>
      <p className="grad-follows__text">
        {t('incubation.graduatedFollows.message', { handle: current.handle, hiveUsername: current.hiveUsername })}
      </p>
      <div className="grad-follows__actions">
        <Button variant="secondary" size={36} center onClick={gotIt} disabled={busy}>
          {t('incubation.graduatedFollows.gotIt')}
        </Button>
        {user && (
          <Button variant="cyan" size={36} center onClick={followForReal} disabled={busy} loading={busy}>
            {t('incubation.graduatedFollows.followForReal')}
          </Button>
        )}
      </div>
    </section>,
    document.body,
  );
}
