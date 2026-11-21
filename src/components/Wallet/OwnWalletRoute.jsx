import { useEffect, useRef } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../lib/store';
import { Button, EmptyState } from '../v2/ui';

/**
 * /wallet with no account in it: the signed-in user's own wallet.
 *
 * The query and the hash travel along, so /wallet#pro (the Pro plans) lands on
 * /wallet/<user>#pro. Without this route /wallet fell through to the not-found
 * page, so a shared "/wallet#pro" link only worked with the name filled in.
 *
 * Signed out (or incubating, which has no Hive wallet yet): the login modal
 * opens once and the page offers it again. Once a Hive account signs in, `user`
 * is set and the redirect happens on its own. The persisted store has `user`
 * from the first render, so a signed-in visitor never sees the prompt.
 */
export default function OwnWalletRoute({ openLoginModal }) {
  const { t } = useTranslation();
  const user = useAppStore((s) => s.user);
  const { search, hash } = useLocation();
  const askedOnce = useRef(false);

  useEffect(() => {
    if (user || askedOnce.current || !openLoginModal) return;
    askedOnce.current = true;
    openLoginModal();
  }, [user, openLoginModal]);

  if (user) {
    return <Navigate to={`/wallet/${encodeURIComponent(user)}${search}${hash}`} replace />;
  }

  return (
    <EmptyState
      icon="account_balance_wallet"
      title={t('common.status.loginRequired')}
      action={openLoginModal && (
        <Button variant="primary" onClick={() => openLoginModal()}>
          {t('common.actions.login')}
        </Button>
      )}
    />
  );
}
