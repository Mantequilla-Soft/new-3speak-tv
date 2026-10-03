import { useEffect, useRef } from 'react';
import { toastIn } from '../../utils/toast';
import { useAppStore } from '../../lib/store';
import { fetchGraduatedFollows, ackGraduatedFollow } from '../../lib/incubation';
import { followWithAioha } from '../../hive-api/aioha';
import { useTranslation } from 'react-i18next';

const toast = toastIn('Follows');

/**
 * "Someone you follow here just got a real Hive account."
 *
 * A follow of an incubating handle can never reach the chain: when it was made
 * there was no account to follow, and only the follower could sign it anyway.
 * So the moment that creator graduates, the follow is stranded and neither side
 * knows. This is the only thing that closes that loop.
 *
 * Renders nothing. It asks once per session, per signed-in viewer, and speaks
 * through a toast with the action attached, so it never competes for the modal
 * slot the welcome and graduation prompts share.
 */
export default function GraduatedFollowsPrompt() {
  const { t } = useTranslation();
  const authenticated = useAppStore((s) => s.authenticated);
  const user = useAppStore((s) => s.user);
  const incubationHandle = useAppStore((s) => s.incubationHandle);
  const askedRef = useRef(false);

  useEffect(() => {
    if (!authenticated || askedRef.current) return undefined;
    if (!user && !incubationHandle) return undefined;
    askedRef.current = true;

    let alive = true;
    fetchGraduatedFollows()
      .then(({ items }) => {
        if (!alive || !items?.length) return;
        for (const it of items) {
          toast(t('incubation.graduatedFollows.message', { handle: it.handle, hiveUsername: it.hiveUsername }), {
            title: t('incubation.graduatedFollows.title'),
            duration: 15000,
            action: {
              // Only a Hive user can sign a real follow. An incubating follower
              // gets the news and the name; their own follow moves on chain when
              // they graduate and replay it.
              label: user ? t('incubation.graduatedFollows.followForReal') : t('incubation.graduatedFollows.gotIt'),
              onClick: async () => {
                try {
                  if (user) await followWithAioha(it.hiveUsername, true);
                  await ackGraduatedFollow(it.handle);
                  if (user) toast.success(t('incubation.graduatedFollows.nowFollowing', { hiveUsername: it.hiveUsername }));
                } catch (err) {
                  toast.error(err?.message || t('incubation.graduatedFollows.followFailed'));
                }
              },
            },
            // Dismissing is an answer too: asking again every session for
            // someone they have decided not to follow would be nagging.
            onDismiss: () => { ackGraduatedFollow(it.handle).catch(() => {}); },
          });
        }
      })
      .catch(() => { /* nothing to say if we cannot ask */ });
    return () => { alive = false; };
  }, [authenticated, user, incubationHandle, t]);

  return null;
}
