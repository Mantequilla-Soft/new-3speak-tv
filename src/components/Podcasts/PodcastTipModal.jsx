import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { QRCodeSVG } from 'qrcode.react';
import { Dialog, Button, Segmented, Banner } from '../v2/ui';
import { Icon } from '../v2/Icon';
import TipModal from '../tip-reward/TipModal';
import { useAppStore } from '../../lib/store';
import { isLightningInvoicePaid } from '../../lib/lightningTip';
import {
  PODCAST_PRESETS, splitSats, hiveAccountOf, tipOptions, hasWebln, requestAddressInvoice, payValueWithWebln,
} from '../../lib/podcastTips';
import { toastIn } from '../../utils/toast';
import './PodcastTipModal.scss';

/**
 * Tip an outside podcast episode the way its own RSS feed asks (lib/podcastTips.js).
 *
 * Props: track (episodeToTrack() shape: title, show, value, funding, feed_url),
 * initialSats (the amount picked before it opened, e.g. on the show page), onClose.
 * Shows nothing to pay when the feed has neither a value block nor a Hive
 * account, apart from the show's own funding links.
 */
export default function PodcastTipModal({ track, initialSats, onClose }) {
  const { t } = useTranslation();
  const user = useAppStore((s) => s.user);
  const value = track?.value || null;
  const hiveAccount = hiveAccountOf(value);
  const { recipients, single, payable } = useMemo(() => tipOptions(value), [value]);
  const webln = hasWebln();
  const [method, setMethod] = useState(payable ? 'lightning' : hiveAccount ? 'hive' : 'lightning');
  const [sats, setSats] = useState(String(initialSats || PODCAST_PRESETS[1]));
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

  const title = t('audio.podcasts.tip.heading', { show: track.show || track.title });
  // Footer actions of the amount step: cancel, then the browser wallet and/or the QR code.
  // The send button runs the width of the window, label left, icon right (24b);
  // the close button in the head cancels.
  const footer = !results && !invoice && payable ? (
    <>
      {webln && (
        <Button variant="primary" size={48} block onClick={payWebln} disabled={busy} loading={busy} trailing="bolt">
          {t('audio.podcasts.tip.sendWebln')}
        </Button>
      )}
      {/* The QR code stays on offer next to a browser wallet: people pay from
          their phone or v4v.app as well. */}
      {qrTarget && (
        <Button variant={webln ? 'secondary' : 'primary'} size={48} block onClick={payQr} disabled={busy} loading={busy && !webln} trailing={webln ? 'qr_code_2' : 'bolt'}>
          {!single
            ? t('audio.podcasts.tip.payMainOnly', { name: qrTarget.name || qrTarget.address })
            : webln ? t('audio.podcasts.tip.showQr') : t('engagement.tip.lightning.send')}
        </Button>
      )}
    </>
  ) : results ? (
    <Button variant="primary" block onClick={onClose}>{t('engagement.tip.lightning.done')}</Button>
  ) : null;

  return (
    <Dialog open onClose={onClose} title={title} tone="accent" width={460} footer={footer} closeLabel={t('common.actions.close')} className="podcast-tip-modal">
      {!results && !invoice && (payable && hiveAccount) && (
        <Segmented
          options={[
            { value: 'lightning', label: t('engagement.tip.methodLightning'), icon: 'bolt' },
            { value: 'hive', label: t('audio.podcasts.tip.hive', { account: hiveAccount }) },
          ]}
          value="lightning"
          scroll
          onChange={(v) => { if (v === 'hive') setMethod('hive'); }}
        />
      )}

      {results && (
        <div className={okCount ? 'v2-success podcast-tip-done' : 'v2-failure podcast-tip-done'}>
          <b className="podcast-tip-thanks">
            {okCount === results.length
              ? t('audio.podcasts.tip.thanks', { show: track.show })
              : okCount ? t('audio.podcasts.tip.partly', { ok: okCount, count: results.length }) : t('audio.podcasts.tip.failed')}
          </b>
          <ul className="podcast-tip-results">
            {results.map((r, i) => (
              <li key={i} className={r.ok ? 'ok' : 'failed'}>
                <span><Icon name={r.ok ? 'check' : 'close'} size={16} /> {r.name}</span>
                <span className="num">{t('audio.podcasts.tip.sats', { count: r.sats })}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!results && invoice && (
        <div className="podcast-tip-invoice">
          <p className="podcast-tip-note">{t('audio.podcasts.tip.scan', { sats: invoice.sats.toLocaleString(), name: invoice.name })}</p>
          {/* A QR code must stay dark on light for a camera to read it, in both themes. */}
          <a className="podcast-tip-qr" href={`lightning:${invoice.pr}`} aria-label={t('engagement.tip.lightning.openWallet')}>
            <QRCodeSVG value={`lightning:${invoice.pr}`.toUpperCase()} size={220} marginSize={2} bgColor="white" fgColor="black" />
          </a>
          <div className="podcast-tip-row">
            <Button variant="secondary" icon="content_copy" onClick={copyInvoice}>{t('engagement.tip.lightning.copy')}</Button>
            <Button variant="primary" as="a" href={`lightning:${invoice.pr}`} trailing="open_in_new">{t('engagement.tip.lightning.openWallet')}</Button>
          </div>
          {invoice.verifiable && (
            <p className="podcast-tip-waiting">
              <Icon name="progress_activity" size={16} className="v2-spin" />
              {t('engagement.tip.lightning.waiting')}
            </p>
          )}
          <Button variant="ghost" block onClick={onClose}>{t('engagement.tip.lightning.done')}</Button>
        </div>
      )}

      {!results && !invoice && payable && (
        <>
          <div className="v2-field">
            <span className="v2-eyebrow">{t('engagement.tip.lightning.amountLabel').replace(/:\s*$/, '')}</span>
            <div className="podcast-tip-presets">
              {PODCAST_PRESETS.map((p) => (
                <button type="button" key={p} className={`podcast-tip-preset num${String(p) === sats ? ' is-on' : ''}`} aria-pressed={String(p) === sats} onClick={() => setSats(String(p))} aria-label={t('audio.podcasts.tip.sats', { count: p })}>
                  {p >= 1000 ? `${Number((p / 1000).toFixed(1))}K` : p}
                </button>
              ))}
            </div>
            <label className="v2-amount">
              <input type="number" min="1" step="1" inputMode="numeric" value={sats} onChange={(e) => setSats(e.target.value)} aria-label={t('engagement.tip.lightning.amountLabel')} />
              <Icon name="bolt" size={20} className="podcast-tip-bolt" />
            </label>
          </div>

          <div className="v2-field">
            <label className="v2-eyebrow" htmlFor="podcast-tip-msg">{t('audio.podcasts.tip.messageLabel').replace(/:\s*$/, '')}</label>
            <input id="podcast-tip-msg" className="v2-input" type="text" maxLength={250} placeholder={t('audio.podcasts.tip.messagePlaceholder')} value={message} onChange={(e) => setMessage(e.target.value)} />
          </div>

          {preview.length > 1 && (
            <div className="podcast-tip-split">
              <span className="v2-eyebrow">{t('audio.podcasts.tip.splitLabel').replace(/:\s*$/, '')}</span>
              <ul>
                {preview.map((r, i) => (
                  <li key={i}><span>{r.name || r.address}</span><b className="num">{t('audio.podcasts.tip.sats', { count: r.sats })}</b></li>
                ))}
              </ul>
            </div>
          )}

          <Banner tone="info" icon="bolt">
            {webln
              ? t('audio.podcasts.tip.weblnNote')
              : single
                ? t('audio.podcasts.tip.qrNote', { name: single.name || single.address })
                : <>{t('audio.podcasts.tip.needsWebln', { count: recipients.length })}{mainAddress && ` ${t('audio.podcasts.tip.mainOnly', { name: mainAddress.name || mainAddress.address })}`}</>}
          </Banner>
        </>
      )}

      {!results && !invoice && track.funding?.length > 0 && (
        <div className="podcast-tip-funding">
          <span className="v2-eyebrow">{t('audio.podcasts.tip.funding').replace(/:\s*$/, '')}</span>
          {track.funding.map((f) => (
            <a key={f.url} href={f.url} target="_blank" rel="noopener noreferrer nofollow"><Icon name="open_in_new" size={14} /> {f.text || f.url}</a>
          ))}
        </div>
      )}
    </Dialog>
  );
}
