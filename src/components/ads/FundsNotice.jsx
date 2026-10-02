import { useEffect, useState } from 'react';
import { FaWallet, FaExternalLinkAlt } from 'react-icons/fa';
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
  { name: 'Upbit', url: 'https://upbit.com/exchange?code=CRIX.UPBIT.KRW-HIVE', note: 'HIVE/KRW, Korea' },
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
      <h2 id="mkt-funds-title"><FaWallet aria-hidden="true" /> You need HIVE or HBD to book an ad</h2>
      <p>
        Your wallet <strong>@{user}</strong> has no HIVE or HBD yet. Ads are paid in either one,
        straight from this account.
      </p>
      <p className="mkt-funds-rates">
        <span className="mkt-funds-pill">1 HBD = 1 US dollar</span>
        <span className="mkt-funds-pill is-muted">
          {Number(hbdPerHive) > 0
            ? `1 HIVE ≈ ${Number(hbdPerHive).toFixed(3)} HBD today, moves with the market`
            : 'HIVE moves with the market'}
        </span>
      </p>

      <h3>Buy HIVE on an exchange</h3>
      <div className="mkt-funds-exchanges">
        {EXCHANGES.map((x) => (
          <a key={x.name} className="mkt-funds-btn" href={x.url} target="_blank" rel="noopener noreferrer">
            <strong>{x.name} <FaExternalLinkAlt aria-hidden="true" /></strong>
            <span>{x.note}</span>
          </a>
        ))}
      </div>

      <h3>How to get it into your account</h3>
      <ol className="mkt-funds-steps">
        <li>On the exchange, buy <strong>HIVE</strong>. Most sell it for USDT, which you can usually buy there by card or bank transfer.</li>
        <li>
          Withdraw it: choose the <strong>HIVE</strong> network and enter your Hive account
          name <strong>{user}</strong> as the address. <strong>Leave the memo empty</strong>: a memo is only
          needed when sending <em>to</em> an exchange.
        </li>
        <li>It usually arrives within a few minutes. Each exchange sets its own minimum and fee.</li>
      </ol>

      <p className="mkt-fine">
        3Speak is not affiliated with any of these exchanges and does not promote
        cryptocurrency. This is not financial advice: check the rules and fees that apply
        where you live before you buy anything.
      </p>
    </section>
  );
}
