import { useEffect, useState } from 'react';
import { FaWallet, FaExternalLinkAlt } from 'react-icons/fa';
import { useTranslation, Trans } from 'react-i18next';
import { fetchBalances } from '../../hive-api/api';

/* Exchanges with an active HIVE market, checked against two listing sites on
 * 2026-10-01 (coinlore, coinranking): ordered by volume and reach. HTX lists HIVE
 * too but trades almost nothing, so it is left out. HBD is barely listed anywhere
 * (Upbit only), which is why this tells people to buy HIVE: ads can be paid in it.
 * Re-check before adding or reordering. */
const EXCHANGES = [
  { name: 'Binance', url: 'https://www.binance.com/en/trade/HIVE_USDT', note: 'HIVE/USDT' },
  { name: 'MEXC', url: 'https://www.mexc.com/exchange/HIVE_USDT', note: 'HIVE/USDT' },
  { name: 'Gate', url: 'https://www.gate.com/trade/HIVE_USDT', note: 'HIVE/USDT' },
  { name: 'Bitget', url: 'https://www.bitget.com/spot/HIVEUSDT', note: 'HIVE/USDT' },
  { name: 'Upbit', url: 'https://upbit.com/exchange?code=CRIX.UPBIT.KRW-HIVE', note: 'HIVE/KRW, Korea', noteKey: 'ads.funds.upbitNote' },
];

/**
 * "You need HIVE or HBD to book an ad", for a signed-in account whose wallet holds
 * neither. Booking is paid straight from the account, so an empty wallet is the one
 * thing that stops a first ad, and somebody new to Hive has no idea where HIVE comes
 * from. Hidden whenever the balance cannot be read: better silent than wrong.
 */
// `hbdPerHive` is the chain's median price from the rate card (the same figure a
// HIVE payment is valued at), shown so "moves with the market" has today's number.
export default function FundsNotice({ user, hbdPerHive = null }) {
  const { t } = useTranslation();
  const [empty, setEmpty] = useState(false);

  useEffect(() => {
    let alive = true;
    if (!user) return undefined;
    fetchBalances(user).then((b) => {
      if (!alive || !b) return;
      setEmpty(!(b.hive > 0) && !(b.hbd > 0));
    }).catch(() => { /* unknown balance: say nothing */ });
    return () => { alive = false; };
  }, [user]);

  if (!user || !empty) return null;

  return (
    <section className="mkt-panel mkt-funds" aria-labelledby="mkt-funds-title">
      <h2 id="mkt-funds-title"><FaWallet aria-hidden="true" /> {t('ads.funds.title')}</h2>
      <p>
        <Trans i18nKey="ads.funds.empty" values={{ user }} components={{ b: <strong /> }} />
      </p>
      <p className="mkt-funds-rates">
        <span className="mkt-funds-pill">{t('ads.funds.hbdUsd')}</span>
        <span className="mkt-funds-pill is-muted">
          {Number(hbdPerHive) > 0
            ? t('ads.funds.hiveRate', { rate: Number(hbdPerHive).toFixed(3) })
            : t('ads.funds.hiveMoves')}
        </span>
      </p>

      <h3>{t('ads.funds.buyTitle')}</h3>
      <div className="mkt-funds-exchanges">
        {EXCHANGES.map((x) => (
          <a key={x.name} className="mkt-funds-btn" href={x.url} target="_blank" rel="noopener noreferrer">
            <strong>{x.name} <FaExternalLinkAlt aria-hidden="true" /></strong>
            <span>{x.noteKey ? t(x.noteKey) : x.note}</span>
          </a>
        ))}
      </div>

      <h3>{t('ads.funds.howTitle')}</h3>
      <ol className="mkt-funds-steps">
        <li><Trans i18nKey="ads.funds.step1" components={{ b: <strong /> }} /></li>
        <li>
          <Trans i18nKey="ads.funds.step2" values={{ user }} components={{ b: <strong />, em: <em /> }} />
        </li>
        <li>{t('ads.funds.step3')}</li>
      </ol>

      <p className="mkt-fine">
        {t('ads.funds.disclaimer')}
      </p>
    </section>
  );
}
