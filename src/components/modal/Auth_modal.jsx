import React from 'react'
import "./Auth_modal.scss"
import { KeychainSDK, KeychainKeyTypes} from 'keychain-sdk';
import { useAppStore } from '../../lib/store';
import { useTranslation } from 'react-i18next';

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
    <div className={`modal ${isOpenAuth ? "open" : ""}`}>
      <div className="overlay" onClick={closeAuth}></div>
      <div
        className={`modal-content auth-bg ${isOpenAuth ? "open" : ""}`}
        onClick={(e) => e.stopPropagation()} // Prevent click on modal from closing it
      >
        <div className="modal-header auth-bg">
          <h2>{t('modals.auth.title')}</h2>
          <button className="close-btn auth-bg" onClick={closeAuth}>
            &times;
          </button>
        </div>
        <div className="modal-body auth-bg">
          <p>{t('modals.auth.text')}</p>
          <button onClick={handleAuth3speak}>{t('modals.auth.authorize')}</button>
          
        </div>
      </div>
    </div>
    
  )
}

export default Auth_modal