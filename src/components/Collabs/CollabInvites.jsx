import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { useMyCollabInvites, respondToCollab } from '../../lib/collabs';
import HiveAvatar from '../HiveAvatar/HiveAvatar';
import { Button } from '../v2/ui';
import { toastIn } from '../../utils/toast';
import './CollabInvites.scss';

const toast = toastIn('Video');

/**
 * Pending collab invites on your own channel page (lib/collabs.js): who invited
 * you to which post, with Accept and Decline. Accepted posts then show on this
 * channel; the same invites are in the bell. Nothing when there are none.
 */
export default function CollabInvites({ user }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const invites = useMyCollabInvites(user).filter((i) => i.status === 'pending');
  const [busy, setBusy] = useState(null);
  if (!invites.length) return null;

  const answer = async (inv, accept) => {
    setBusy(`${inv.author}/${inv.permlink}`);
    try {
      await respondToCollab(user, inv.author, inv.permlink, accept);
      toast.success(accept ? t('social.collab.acceptedToast', { user: inv.author }) : t('social.collab.declinedToast'));
      qc.invalidateQueries({ queryKey: ['collab-invites', user] });
      qc.invalidateQueries({ queryKey: ['checker-notifications', user] });
    } catch {
      toast.error(t('social.collab.answerFailed'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="v2-card collab-invites" aria-label={t('social.collab.invitesTitle')}>
      <h3 className="collab-invites__title">{t('social.collab.invitesTitle')}</h3>
      <ul>
        {invites.map((inv) => {
          const key = `${inv.author}/${inv.permlink}`;
          return (
            <li key={key} className="collab-invite">
              <HiveAvatar username={inv.author} size="small" alt="" badgeSize={0} />
              <span className="collab-invite__text">
                <b>{t('social.notifs.collabInvite', { user: inv.author })}</b>
                <Link to={`/watch?v=${key}`}>{inv.title || inv.permlink}</Link>
              </span>
              <span className="collab-invite__actions">
                <Button variant="primary" size={32} disabled={busy === key} onClick={() => answer(inv, true)}>{t('social.collab.accept')}</Button>
                <Button variant="secondary" size={32} disabled={busy === key} onClick={() => answer(inv, false)}>{t('social.collab.decline')}</Button>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
