import React from 'react'
import "./Auth_modal.scss"
import { KeychainSDK, KeychainKeyTypes} from 'keychain-sdk';
import { useAppStore } from '../../lib/store';
import { useTranslation } from 'react-i18next';
import { Dialog, Button, Icon, IconButton } from '../v2/ui';

function Auth_modal({isOpenAuth, closeAuth, onSuccess}) {
    const { t } = useTranslation();
    const {user} = useAppStore();
  const  handleAuth3speak = async ()=>{
    try
  {
    const keychain = new KeychainSDK(window);
    const formParamsAsObject = {
     "data": {
          "username": user,
          "authorizedUsername": "threespeak",
          "role" : KeychainKeyTypes.posting,
          "weight": 1
     }
}
    
    const addaccountauthority = await keychain.addAccountAuthority( formParamsAsObject.data);
    console.log({ addaccountauthority });
    // Call onSuccess to indicate authorization was granted
    if (onSuccess) {
      onSuccess();
    }
    closeAuth();
  } catch (error) {
    console.log({ error });
    // On error, still close but don't call onSuccess
    closeAuth();
  }

  }
  // 42a "Authorize 3Speak": the key in cyan, the title, why, and one cyan
  // action; the X (or Escape) is the way out.
  return (
    <Dialog
      open={!!isOpenAuth}
      onClose={closeAuth}
      title={t('modals.auth.title')}
      head={false}
      width={420}
      className="auth-modal"
      footer={(
        <Button variant="cyan" size={40} block onClick={handleAuth3speak}>{t('modals.auth.authorize')}</Button>
      )}
    >
      <div className="auth-modal__top">
        <Icon name="key" size={28} className="auth-modal__icon" />
        <IconButton icon="close" label={t('common.actions.close')} size={32} variant="ghost" round onClick={closeAuth} />
      </div>
      <h2 className="auth-modal__title">{t('modals.auth.title')}</h2>
      <p className="auth-modal__text">{t('modals.auth.text')}</p>
    </Dialog>
  )
}

export default Auth_modal
