import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { IconButton } from '../v2/ui';
import './QrScanSheet.scss';

/**
 * The camera, full screen, reading QR codes for the wallet's Send window
 * (owner 2026-11-12). Every code it sees goes to `onResult(text)`; the caller
 * decides whether it names an account (lib/scannedRecipient.js) and closes
 * this, or leaves it open and passes a `note` to show ("not an account").
 *
 * qr-scanner (~60 KB with its decoder) is only loaded when this opens. It uses
 * the browser's own QR reader where there is one (Chrome on Android) and its
 * own decoder elsewhere (iPhones, Firefox).
 */
export default function QrScanSheet({ onResult, onClose, note }) {
  const { t } = useTranslation();
  const videoRef = useRef(null);
  const resultRef = useRef(onResult);
  const [failed, setFailed] = useState(false);
  useEffect(() => { resultRef.current = onResult; }, [onResult]);

  useEffect(() => {
    let scanner = null;
    let gone = false;
    (async () => {
      try {
        const { default: QrScanner } = await import('qr-scanner');
        if (gone || !videoRef.current) return;
        scanner = new QrScanner(videoRef.current, (res) => resultRef.current?.(res?.data ?? res), {
          preferredCamera: 'environment',
          returnDetailedScanResult: true,
          highlightScanRegion: true,
          highlightCodeOutline: true,
        });
        await scanner.start();
        if (gone) { scanner.stop(); scanner.destroy(); }
      } catch (err) {
        console.error('[qr] camera failed', err);
        if (!gone) setFailed(true);
      }
    })();
    return () => {
      gone = true;
      try { scanner?.stop(); scanner?.destroy(); } catch { /* already stopped */ }
    };
  }, []);

  // Escape closes the camera, not the Send window under it.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return createPortal(
    <div className="qr-scan" role="dialog" aria-modal="true" aria-label={t('wallet.transferModal.scan')}>
      <video ref={videoRef} className="qr-scan__video" muted playsInline />
      <IconButton icon="close" label={t('common.actions.close')} size={44} variant="media" round className="qr-scan__close" onClick={onClose} />
      <p className={`qr-scan__hint${failed || note ? ' is-alert' : ''}`} role="status">
        {failed ? t('wallet.transferModal.scanNoCamera') : (note || t('wallet.transferModal.scanHint'))}
      </p>
    </div>,
    document.body,
  );
}
