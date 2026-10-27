import React from 'react'
import "./QrCode_modal.scss"
import { QRCodeSVG } from 'qrcode.react'
import { useTranslation } from 'react-i18next'
import ModalHeader from '../ModalHeader/ModalHeader'

function QrCode_modal({qrCode, openKeychainApp, onClose}) {
  const { t } = useTranslation();
  return (
    <div className={`modal `}>
        <div className="overlay" onClick={onClose}></div>
        <div
        className={`modal-content  `}
        onClick={(e) => e.stopPropagation()} 
         >
              <ModalHeader title={t('modals.qr.title')} onClose={onClose} />
              <div style={{ textAlign: 'center' }}>
                  <p>{t('modals.qr.scan')}</p>
                  <div onClick={openKeychainApp} style={{ cursor: 'pointer', display: 'inline-block' }}>
                      <div style={{ background: '#ffffff', padding: '16px', borderRadius: '8px', display: 'inline-block' }}>
                        <QRCodeSVG value={qrCode} size={180} bgColor="#ffffff" fgColor="#000000" includeMargin={true} />
                      </div>
                      <p style={{ fontSize: '0.8rem', marginTop: '0.5rem', color: '#007bff' }}>
                          {t('modals.qr.click')}
                      </p>
                  </div>
              </div>
        </div>
        </div>
            
  )
}

export default QrCode_modal