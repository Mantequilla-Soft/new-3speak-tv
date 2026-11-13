import "./QrCode_modal.scss"
import { QRCodeSVG } from 'qrcode.react'
import { useTranslation } from 'react-i18next'
import DialogShell from './DialogShell'
import { Icon } from '../v2/Icon'

// Log in with Keychain on another device (design 25e, QR): the v2 dialog with
// the code in a bg well. The code itself stays black on white so every camera
// can read it, in both themes.
function QrCode_modal({ qrCode, openKeychainApp, onClose }) {
  const { t } = useTranslation();
  return (
    <DialogShell onClose={onClose} title={t('modals.qr.title')} width={440} zIndex={1100} className="qr-modal">
      {/* 25e: the code on its white tile, and beside it what to do with it and
          the one action, as a secondary button. */}
      <div className="qr-modal__row">
        <button type="button" className="qr-modal__code" onClick={openKeychainApp} aria-label={t('modals.qr.click')}>
          <QRCodeSVG value={qrCode} size={140} bgColor="white" fgColor="black" />
        </button>
        <div className="qr-modal__side">
          <p className="qr-modal__lead">{t('modals.qr.scan')}</p>
          <button type="button" className="v2-btn v2-btn--secondary h44 qr-modal__hint" onClick={openKeychainApp}>
            <span className="v2-btn__label">{t('modals.qr.click')}</span>
            <Icon name="open_in_new" size={18} />
          </button>
        </div>
      </div>
    </DialogShell>
  )
}

export default QrCode_modal
