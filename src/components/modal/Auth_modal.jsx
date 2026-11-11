import React from 'react'
import "./Auth_modal.scss"
import { KeychainSDK, KeychainKeyTypes} from 'keychain-sdk';
import { useAppStore } from '../../lib/store';
import { useTranslation } from 'react-i18next';
import { Dialog, Button, Icon } from '../v2/ui';

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
  return (
    <Dialog
      open={!!isOpenAuth}
      onClose={closeAuth}
      title={t('modals.auth.title')}
      width={420}
      footer={(
        <>
          <Button variant="ghost" onClick={closeAuth}>{t('common.actions.cancel')}</Button>
          <Button variant="cyan" icon="key" onClick={handleAuth3speak}>{t('modals.auth.authorize')}</Button>
        </>
      )}
    >
      <Icon name="key" size={28} className="auth-modal__icon" />
      <p className="auth-modal__text">{t('modals.auth.text')}</p>
    </Dialog>
  )
}

export default Auth_modal
