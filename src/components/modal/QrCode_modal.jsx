import "./QrCode_modal.scss"
import { QRCodeSVG } from 'qrcode.react'
import { useTranslation } from 'react-i18next'
import DialogShell from './DialogShell'

// Log in with Keychain on another device (design 25e, QR): the v2 dialog with
// the code in a bg well. The code itself stays black on white so every camera
// can read it, in both themes.
function QrCode_modal({ qrCode, openKeychainApp, onClose }) {
  const { t } = useTranslation();
  return (
    <DialogShell onClose={onClose} title={t('modals.qr.title')} width={440} zIndex={1100} className="qr-modal">
      <p className="qr-modal__lead">{t('modals.qr.scan')}</p>
      <div className="qr-modal__well">
        <button type="button" className="qr-modal__code" onClick={openKeychainApp} aria-label={t('modals.qr.click')}>
          <QRCodeSVG value={qrCode} size={180} bgColor="white" fgColor="black" includeMargin />
        </button>
        <button type="button" className="qr-modal__hint" onClick={openKeychainApp}>{t('modals.qr.click')}</button>
      </div>
    </DialogShell>
  )
}

export default QrCode_modal
