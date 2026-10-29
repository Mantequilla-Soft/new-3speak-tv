import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { QRCodeSVG } from 'qrcode.react';
import { LineSpinner } from 'ldrs/react';
import 'ldrs/react/LineSpinner.css';
import ModalHeader from '../ModalHeader/ModalHeader';
import TipModal from '../tip-reward/TipModal';
import { useAppStore } from '../../lib/store';
import { isLightningInvoicePaid } from '../../lib/lightningTip';
import {
  PODCAST_PRESETS, splitSats, hiveAccountOf, tipOptions, hasWebln, requestAddressInvoice, payValueWithWebln,
} from '../../lib/podcastTips';
import { toastIn } from '../../utils/toast';
import '../tip-reward/TipModal.scss';
import './PodcastTipModal.scss';

/**
 * Tip an outside podcast episode the way its own RSS feed asks (lib/podcastTips.js).
 *
 * Props: track (episodeToTrack() shape: title, show, value, funding, feed_url),
 * onClose. Shows nothing to pay when the feed has neither a value block nor a
 * Hive account, apart from the show's own funding links.
 */
export default function PodcastTipModal({ track, onClose }) {
  const { t } = useTranslation();
  const user = useAppStore((s) => s.user);
  const value = track?.value || null;
  const hiveAccount = hiveAccountOf(value);
  const { recipients, single, payable } = useMemo(() => tipOptions(value), [value]);
  const webln = hasWebln();
  const [method, setMethod] = useState(payable ? 'lightning' : hiveAccount ? 'hive' : 'lightning');
  const [sats, setSats] = useState(String(PODCAST_PRESETS[1]));
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [invoice, setInvoice] = useState(null);
  const [results, setResults] = useState(null);

  // The biggest Lightning-address share: who a QR code can still reach when the
  // feed splits between several recipients and there is no WebLN wallet.
  const mainAddress = useMemo(() => recipients
    .filter((r) => r.type === 'lnaddress' && !r.fee)
    .sort((a, b) => b.split - a.split)[0] || null, [recipients]);
  const qrTarget = single || mainAddress;

  // While a QR invoice is on screen, ask whether it was paid (works where the
  // address's host offers LUD-21 verify, e.g. Alby).
  useEffect(() => {
    if (!invoice?.hash || !invoice.verifiable) return undefined;
    let stopped = false;
    let timer;
    const check = async () => {
      if (stopped) return;
      if (!document.hidden && await isLightningInvoicePaid(invoice.hash).catch(() => false)) {
        if (!stopped) setResults([{ name: invoice.name, sats: invoice.sats, ok: true }]);
        return;
      }
      timer = setTimeout(check, 3000);
    };
    timer = setTimeout(check, 3000);
    return () => { stopped = true; clearTimeout(timer); };
  }, [invoice]);

  const amount = () => {
    const n = Number(sats);
    if (!Number.isInteger(n) || n < 1) {
      toastIn('Tip').error(t('engagement.tip.lightning.errors.amount'));
      return null;
    }
    return n;
  };

  const payWebln = async () => {
    const total = amount();
    if (!total) return;
    setBusy(true);
    try {
      const res = await payValueWithWebln({
        value, total, message: message.trim(), show: track.show, episode: track.title, feedUrl: track.feed_url, sender: user || undefined,
      });
      setResults(res);
    } catch (err) {
      toastIn('Tip').error(err?.message || t('audio.podcasts.tip.failed'));
    } finally {
      setBusy(false);
    }
  };

  const payQr = async () => {
    const total = amount();
    if (!total || !qrTarget) return;
    setBusy(true);
    try {
      const inv = await requestAddressInvoice({ address: qrTarget.address, sats: total, comment: message.trim() });
      setInvoice({ ...inv, name: qrTarget.name || qrTarget.address });
    } catch (err) {
      toastIn('Tip').error(err.code === 'amount_out_of_range'
        ? t('engagement.tip.lightning.errors.tooMuch', { max: err.max })
        : t('engagement.tip.lightning.errors.invoiceFailed'));
    } finally {
      setBusy(false);
    }
  };

  const copyInvoice = async () => {
    try {
      await navigator.clipboard.writeText(invoice.pr);
      toastIn('Tip').success(t('engagement.tip.lightning.copied'));
    } catch {
      toastIn('Tip').error(t('engagement.tip.lightning.errors.copyFailed'));
    }
  };

  if (method === 'hive' && hiveAccount) {
    return <TipModal recipient={hiveAccount} memoLink={track.link || undefined} isOpen onClose={onClose} />;
  }

  const preview = splitSats(recipients, Number(sats) > 0 ? Number(sats) : 0);
  const okCount = results ? results.filter((r) => r.ok).length : 0;

  return (
    <div className="tip-modal podcast-tip-modal">
      <div className="modal-content-trx">
        <ModalHeader
          className="tip-modal-header"
          title={t('audio.podcasts.tip.heading', { show: track.show || track.title })}
          onClose={onClose}
        />

        {!results && !invoice && (payable && hiveAccount) && (
          <div className="tip-method-switch" role="tablist">
            <button type="button" role="tab" aria-selected className="active">⚡ {t('engagement.tip.methodLightning')}</button>
            <button type="button" role="tab" aria-selected={false} onClick={() => setMethod('hive')}>
              {t('audio.podcasts.tip.hive', { account: hiveAccount })}
            </button>
          </div>
        )}

        {results && (
          <div className="tip-modal-in podcast-tip-done">
            <p className="podcast-tip-thanks">
              {okCount === results.length
                ? t('audio.podcasts.tip.thanks', { show: track.show })
                : okCount ? t('audio.podcasts.tip.partly', { ok: okCount, count: results.length }) : t('audio.podcasts.tip.failed')}
            </p>
            <ul className="podcast-tip-results">
              {results.map((r, i) => (
                <li key={i} className={r.ok ? 'ok' : 'failed'}>
                  <span>{r.ok ? '✓' : '✗'} {r.name}</span>
                  <span>{t('audio.podcasts.tip.sats', { count: r.sats })}</span>
                </li>
              ))}
            </ul>
            <div className="actions">
              <button className="send-btn" onClick={onClose}>{t('engagement.tip.lightning.done')}</button>
            </div>
          </div>
        )}

        {!results && invoice && (
          <div className="tip-modal-in">
            <div className="lightning-invoice">
              <p className="tip-method-note">{t('audio.podcasts.tip.scan', { sats: invoice.sats.toLocaleString(), name: invoice.name })}</p>
              <a className="qr-wrap" href={`lightning:${invoice.pr}`} aria-label={t('engagement.tip.lightning.openWallet')}>
                <QRCodeSVG value={`lightning:${invoice.pr}`.toUpperCase()} size={220} marginSize={2} bgColor="#ffffff" fgColor="#000000" />
              </a>
              <div className="actions">
                <button className="cancel-btn" onClick={copyInvoice}>{t('engagement.tip.lightning.copy')}</button>
                <a className="send-btn" href={`lightning:${invoice.pr}`}>{t('engagement.tip.lightning.openWallet')}</a>
              </div>
              {invoice.verifiable && (
                <p className="lightning-waiting">
                  <LineSpinner size="12" stroke="2" speed="1" color="currentColor" />
                  {t('engagement.tip.lightning.waiting')}
                </p>
              )}
              <button type="button" className="lightning-done" onClick={onClose}>{t('engagement.tip.lightning.done')}</button>
            </div>
          </div>
        )}

        {!results && !invoice && payable && (
          <div className="tip-modal-in">
            <div className="form">
              <div className="field">
                <label>{t('engagement.tip.lightning.amountLabel')}</label>
                <div className="sats-presets">
                  {PODCAST_PRESETS.map((p) => (
                    <button type="button" key={p} className={String(p) === sats ? 'active' : ''} onClick={() => setSats(String(p))}>
                      {p.toLocaleString()}
                    </button>
                  ))}
                </div>
                <input type="number" min="1" step="1" inputMode="numeric" value={sats} onChange={(e) => setSats(e.target.value)} />
              </div>

              <div className="field">
                <label>{t('audio.podcasts.tip.messageLabel')}</label>
                <input type="text" maxLength={250} placeholder={t('audio.podcasts.tip.messagePlaceholder')} value={message} onChange={(e) => setMessage(e.target.value)} />
              </div>

              {preview.length > 1 && (
                <div className="podcast-tip-split">
                  <span className="podcast-tip-split-label">{t('audio.podcasts.tip.splitLabel')}</span>
                  <ul>
                    {preview.map((r, i) => (
                      <li key={i}><span>{r.name || r.address}</span><span>{t('audio.podcasts.tip.sats', { count: r.sats })}</span></li>
                    ))}
                  </ul>
                </div>
              )}

              {webln ? (
                <p className="tip-method-note">{t('audio.podcasts.tip.weblnNote')}</p>
              ) : single ? (
                <p className="tip-method-note">{t('audio.podcasts.tip.qrNote', { name: single.name || single.address })}</p>
              ) : (
                <p className="tip-method-note">
                  {t('audio.podcasts.tip.needsWebln', { count: recipients.length })}
                  {mainAddress && ` ${t('audio.podcasts.tip.mainOnly', { name: mainAddress.name || mainAddress.address })}`}
                </p>
              )}

              <div className="actions">
                <button className="cancel-btn" onClick={onClose}>{t('common.actions.cancel')}</button>
                {webln && (
                  <button className="send-btn" onClick={payWebln} disabled={busy}>
                    {busy ? <LineSpinner size="14" stroke="2" speed="1" color="currentColor" /> : t('audio.podcasts.tip.sendWebln')}
                  </button>
                )}
                {/* The QR code stays on offer next to a browser wallet: people pay from
                    their phone or v4v.app as well. */}
                {qrTarget && (
                  <button className={webln ? 'cancel-btn' : 'send-btn'} onClick={payQr} disabled={busy}>
                    {busy && !webln
                      ? <LineSpinner size="14" stroke="2" speed="1" color="currentColor" />
                      : !single
                        ? t('audio.podcasts.tip.payMainOnly', { name: qrTarget.name || qrTarget.address })
                        : webln ? t('audio.podcasts.tip.showQr') : t('engagement.tip.lightning.send')}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {!results && !invoice && track.funding?.length > 0 && (
          <div className="tip-modal-in podcast-tip-funding">
            <span className="podcast-tip-split-label">{t('audio.podcasts.tip.funding')}</span>
            {track.funding.map((f) => (
              <a key={f.url} href={f.url} target="_blank" rel="noopener noreferrer nofollow">{f.text || f.url}</a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
