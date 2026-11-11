import React, { useState, useEffect, useMemo, useCallback } from 'react';
import './Wallet.scss';
import TrxHistory from '../components/Wallet/TrxHistory';
import { useAppStore } from '../lib/store';
import { Client } from '@hiveio/dhive';
import TransferModal from '../components/Wallet/TransferModal';
import ProPlansPanel from '../components/Wallet/ProPlansPanel';
import { useNavigate, useParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { toastIn } from '../utils/toast';
import { ENABLE_SUBS } from '../utils/config';
import { IS_VSC_TESTNET, HIVE_TESTNET_NODES } from '../utils/vscContract';
import { getHiveClient } from '../utils/hiveNode';
import { getRcStatus, estimatePostRcCost } from '../utils/rcCheck';
import { broadcastWithAioha, KeyTypes } from '../hive-api/aioha';
import { useTranslation } from 'react-i18next';
import { formatNumber } from '../i18n';
import { Button, IconButton, Dialog, Icon } from '../components/v2/ui';
import { cx } from '../components/v2/helpers';

// Every toast from this module is headed "Wallet"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Wallet');

// Mainnet → the shared session-picked node client. Testnet keeps its own.
const client = IS_VSC_TESTNET
  ? new Client(HIVE_TESTNET_NODES, { timeout: 3000, failoverThreshold: 2, consoleOnFailover: true })
  : getHiveClient();

const usd = (n) => formatNumber(n, { style: 'currency', currency: 'USD' });
const amt = (n, digits = 3) => formatNumber(n, { minimumFractionDigits: digits, maximumFractionDigits: digits });

// The earnings chart: 15 bars of two days each, the newest on the right.
const BAR_DAYS = 2;
const BAR_COUNT = 15;

function Wallet() {
  const { t } = useTranslation();
  const { user: currentUser } = useAppStore();
  const { user } = useParams();
  const own = !!user && currentUser === user;
  const navigate = useNavigate();
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [showReceive, setShowReceive] = useState(false);
  const [selectedCoin, setSelectedCoin] = useState(null);
  const [hasKeychain, setHasKeychain] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [txns, setTxns] = useState(null);
  const [rc, setRc] = useState(null);

  const [balances, setBalances] = useState({
    hp: 0,
    hbd: 0,
    hive: 0,
    savings_hbd: 0
  });
  // Unclaimed author and curation rewards, straight from the account object.
  const [pending, setPending] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [usdPrices, setUsdPrices] = useState({
    HP: 0.85,
    HBD: 1.00
  });

  useEffect(() => {
    if (user) fetchBalances();
    fetchPrices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Resource credits, for the card beside the activity. Read only.
  useEffect(() => {
    if (!user || IS_VSC_TESTNET) return undefined;
    let alive = true;
    (async () => {
      const status = await getRcStatus(user);
      if (!alive || !status) return;
      let posts = null;
      try {
        const cost = await estimatePostRcCost();
        if (cost > 0) posts = Math.floor(status.currentMana / cost);
      } catch { /* the percentage alone is enough */ }
      if (alive) setRc({ pct: Math.max(0, Math.min(100, status.percentage)), posts });
    })();
    return () => { alive = false; };
  }, [user]);

  // /wallet/<user>#pro (the importer's Pro button, for one) lands on the Pro
  // plans. They sit below the balances, which load first and move them down.
  useEffect(() => {
    if (isLoading || window.location.hash !== '#pro') return undefined;
    const id = setTimeout(() => document.getElementById('pro')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
    return () => clearTimeout(id);
  }, [isLoading]);

  // Detect Hive Keychain extension presence (poll briefly to catch late installs)
  useEffect(() => {
    const check = () => setHasKeychain(typeof window !== 'undefined' && !!window.hive_keychain);
    check();
    const id = setInterval(check, 1000);
    // stop polling after 10s
    const stopId = setTimeout(() => clearInterval(id), 10000);
    return () => {
      clearInterval(id);
      clearTimeout(stopId);
    };
  }, []);

  const fetchBalances = async () => {
    try {
      setIsLoading(true);
      const [account] = await client.database.getAccounts([user]);
      const dgp = await client.database.getDynamicGlobalProperties();

      const vestsToHP = (vests) => {
        const totalVests = parseFloat(dgp.total_vesting_shares.split(' ')[0]);
        const totalHP = parseFloat(dgp.total_vesting_fund_hive.split(' ')[0]);
        return (vests * totalHP) / totalVests;
      };

      setBalances({
        hp: vestsToHP(parseFloat(account.vesting_shares.split(' ')[0])),
        hbd: parseFloat(account.hbd_balance.split(' ')[0]),
        hive: parseFloat(account.balance.split(' ')[0]),
        savings_hbd: parseFloat(account.savings_hbd_balance.split(' ')[0])
      });

      const num = (v) => parseFloat(String(v || '0').split(' ')[0]) || 0;
      setPending({
        hive: num(account.reward_hive_balance),
        hbd: num(account.reward_hbd_balance),
        hp: num(account.reward_vesting_hive),
        // the exact assets the claim op has to name
        raw: {
          reward_hive: account.reward_hive_balance,
          reward_hbd: account.reward_hbd_balance,
          reward_vests: account.reward_vesting_balance,
        },
      });

    } catch (err) {
      setError(t('wallet.errors.fetchBalances'));
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchPrices = async () => {
    try {
      const marketData = await client.call('market_history_api', 'get_ticker', {});

      // Extract the latest market price
      const hivePrice = parseFloat(marketData.latest);

      setUsdPrices({
        HP: hivePrice, // HP is valued as HIVE
        HBD: 1.00 // HBD is roughly pegged to 1 USD
      });
    } catch (error) {
      console.error("Error fetching market prices:", error);
    }
  };

  const coins = [
    {
      name: 'HIVE',
      balance: balances.hive,
      usdPrice: usdPrices.HP,
    },
    {
      name: 'HBD',
      balance: balances.hbd,
      usdPrice: usdPrices.HBD,
    }
  ];

  const handleTransfer = (coinType) => {
    if (!hasKeychain) {
      toast.error(t('wallet.errors.needKeychain'));
      return;
    }
    const coin = coins.find(c => c.name === coinType);
    setSelectedCoin(coin);
    setShowTransferModal(true);
  };

  const total = balances.hive * usdPrices.HP + balances.hp * usdPrices.HP + balances.hbd * usdPrices.HBD + balances.savings_hbd * usdPrices.HBD;
  const pendingUsd = pending ? pending.hbd * usdPrices.HBD + (pending.hive + pending.hp) * usdPrices.HP : 0;
  const hasPending = own && pending && (pending.hbd > 0 || pending.hive > 0 || pending.hp > 0);

  const claim = async () => {
    if (!pending?.raw || claiming) return;
    setClaiming(true);
    try {
      await broadcastWithAioha([['claim_reward_balance', { account: user, ...pending.raw }]], KeyTypes.Posting);
      toast.success(t('wallet.claim.done'));
      fetchBalances();
    } catch (err) {
      console.error('Claim failed:', err);
      toast.error(t('wallet.claim.failed', { error: err?.message || '' }));
    } finally {
      setClaiming(false);
    }
  };

  const scrollTo = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // Earnings, 30 days: rewards claimed and HIVE/HBD received, from the
  // activity the list below already loaded.
  const bars = useMemo(() => {
    const out = Array.from({ length: BAR_COUNT }, () => 0);
    if (!txns) return out;
    const now = txns.at;
    for (const tx of txns.list) {
      if (tx.type === 'send') continue;
      const days = (now - tx.date.getTime()) / 86400000;
      const slot = BAR_COUNT - 1 - Math.floor(days / BAR_DAYS);
      if (slot < 0 || slot >= BAR_COUNT) continue;
      const value = tx.type === 'claim'
        ? tx.amount.HBD * usdPrices.HBD + (tx.amount.HIVE + tx.amount.HP) * usdPrices.HP
        : tx.amount * (tx.coin === 'HBD' ? usdPrices.HBD : usdPrices.HP);
      out[slot] += value || 0;
    }
    return out;
  }, [txns, usdPrices]);
  const barMax = Math.max(...bars);
  const earned = bars.reduce((a, b) => a + b, 0);
  const onLoaded = useCallback((list) => setTxns({ list, at: Date.now() }), []);

  const acts = own ? [
    { id: 'send', icon: 'send', label: t('common.actions.send'), onClick: () => handleTransfer(balances.hbd > 0 ? 'HBD' : 'HIVE'), primary: true },
    { id: 'receive', icon: 'qr_code_2', label: t('wallet.receive.title'), onClick: () => setShowReceive(true) },
    { id: 'history', icon: 'history', label: t('wallet.activity.title'), onClick: () => scrollTo('wallet-activity') },
    ...(ENABLE_SUBS ? [{ id: 'pro', icon: 'workspace_premium', label: t('wallet.pro'), onClick: () => scrollTo('pro') }] : []),
  ] : [];

  const cards = [
    { id: 'hive', sym: 'H', name: 'HIVE', value: balances.hive * usdPrices.HP, amount: amt(balances.hive), send: 'HIVE' },
    { id: 'hbd', sym: '$', name: 'HBD', value: balances.hbd * usdPrices.HBD, amount: amt(balances.hbd), send: 'HBD' },
    { id: 'hp', sym: 'HP', name: t('wallet.coins.hp'), value: balances.hp * usdPrices.HP, amount: amt(balances.hp) },
    { id: 'savings', icon: 'savings', name: t('wallet.coins.savings'), value: balances.savings_hbd * usdPrices.HBD, amount: amt(balances.savings_hbd) },
  ];

  return (
    <div className="wallet-v2">
      <header className={cx('wallet-v2__bar', own && 'is-own')}>
        <IconButton icon="arrow_back" size={40} label={t('common.actions.back')} onClick={() => navigate(-1)} className="wallet-v2__bar-btn" />
        <h1>{own ? t('wallet.header.mine') : t('wallet.header.ofUser', { user })}</h1>
        <IconButton icon="history" size={40} label={t('wallet.activity.title')} onClick={() => scrollTo('wallet-activity')} className="wallet-v2__bar-btn" />
      </header>

      {error ? (
        <div className="v2-failure wallet-v2__error" role="alert"><b>{error}</b></div>
      ) : (
        <>
          <section className="wallet-v2__hero">
            <div className="wallet-v2__hero-main">
              <div className="wallet-v2__label">{t('wallet.total')}</div>
              {isLoading
                ? <div className="v2-skeleton wallet-v2__total-skel" aria-hidden />
                : <div className="wallet-v2__total num">{usd(total)}</div>}
              {usdPrices.HP > 0 && (
                <span className="wallet-v2__rate num">{t('wallet.rate', { price: usd(usdPrices.HP) })}</span>
              )}
            </div>
            {acts.length > 0 && (
              <div className="wallet-v2__acts">
                {acts.map((a) => (
                  <button key={a.id} type="button" className={cx('wallet-v2__act', a.primary && 'is-primary')} onClick={a.onClick}>
                    <Icon name={a.icon} size={28} />
                    <span>{a.label}</span>
                  </button>
                ))}
              </div>
            )}
          </section>

          {hasPending && (
            <section className="wallet-v2__claim">
              <Icon name="redeem" size={32} className="wallet-v2__claim-icon" />
              <div className="wallet-v2__claim-body">
                <b className="is-wide">{t('wallet.claim.ready', { amount: usd(pendingUsd) })}</b>
                <b className="is-narrow">{t('wallet.claim.readyShort', { amount: usd(pendingUsd) })}</b>
                <span className="num">
                  {[pending.hbd > 0 && `${amt(pending.hbd)} HBD`, pending.hive > 0 && `${amt(pending.hive)} HIVE`, pending.hp > 0 && `${amt(pending.hp)} HP`].filter(Boolean).join(' · ')}
                </span>
              </div>
              <Button variant="primary" size={56} className="wallet-v2__claim-btn" loading={claiming} disabled={claiming} onClick={claim} trailing="arrow_forward">
                {t('wallet.claim.button')}
              </Button>
            </section>
          )}

          <section className="wallet-v2__balances" aria-label={t('wallet.assets')}>
            {cards.map((c) => (
              <div key={c.id} className="wallet-v2__coin">
                <div className="wallet-v2__coin-head">
                  <span className="wallet-v2__sym">{c.icon ? <Icon name={c.icon} size={18} /> : c.sym}</span>
                  <div className="wallet-v2__coin-name">
                    <b>{c.name}</b>
                    <span className="wallet-v2__coin-amt is-narrow num">{isLoading ? '…' : c.amount}</span>
                  </div>
                  {own && c.send && (
                    <IconButton icon="send" size={32} variant="ghost" label={`${t('wallet.transfer')} ${c.name}`} onClick={() => handleTransfer(c.send)} className="wallet-v2__coin-send" />
                  )}
                </div>
                <div className="wallet-v2__coin-usd">{isLoading ? <span className="v2-skeleton is-line" aria-hidden /> : usd(c.value)}</div>
                <div className="wallet-v2__coin-amt is-wide num">{isLoading ? '' : c.amount}</div>
              </div>
            ))}
          </section>

          <div className="wallet-v2__grid">
            <TrxHistory user={user} onLoaded={onLoaded} />
            <aside className="wallet-v2__side">
              <div className="wallet-v2__card">
                <div className="wallet-v2__card-head">
                  <b>{t('wallet.earnings.title')}</b>
                  {txns && <span className="money">{usd(earned)}</span>}
                </div>
                <div className="wallet-v2__bars" aria-hidden>
                  {bars.map((v, i) => (
                    <div key={i} className={cx('wallet-v2__ebar', i === BAR_COUNT - 1 && 'is-now', !v && 'is-empty')}
                      style={{ height: barMax > 0 && v > 0 ? `${Math.max(8, (v / barMax) * 100)}%` : undefined }} />
                  ))}
                </div>
                <div className="wallet-v2__card-sub">{txns ? t('wallet.earnings.sub') : t('common.status.loading')}</div>
              </div>
              {rc && (
                <div className="wallet-v2__card">
                  <div className="wallet-v2__card-head">
                    <b>{t('wallet.rc.title')}</b>
                    <span className="wallet-v2__rc-pct num">{Math.round(rc.pct)}%</span>
                  </div>
                  <div className="wallet-v2__rc"><span style={{ width: `${rc.pct}%` }} /></div>
                  <div className="wallet-v2__card-sub">
                    {rc.posts != null ? t('wallet.rc.posts', { count: rc.posts }) : t('wallet.rc.sub')}
                  </div>
                </div>
              )}
            </aside>
          </div>

          {ENABLE_SUBS && own && <div id="pro" className="wallet-v2__pro"><ProPlansPanel /></div>}
        </>
      )}

      {showTransferModal && selectedCoin && (
        <TransferModal
          showModal={setShowTransferModal}
          selectedCoin={selectedCoin}
          balances={balances}
          recent={(txns?.list || []).filter((tx) => tx.type === 'send').map((tx) => tx.address)}
          prices={{ HIVE: usdPrices.HP, HBD: usdPrices.HBD }}
          fetchBalances={fetchBalances} />
      )}

      <Dialog open={showReceive} onClose={() => setShowReceive(false)} title={t('wallet.receive.title')} closeLabel={t('common.actions.close')} width={400}>
        <div className="wallet-v2__receive">
          <div className="wallet-v2__qr"><QRCodeSVG value={user || ''} size={168} bgColor="white" fgColor="black" includeMargin /></div>
          <div className="v2-well wallet-v2__receive-name num">@{user}</div>
          <p className="v2-meta">{t('wallet.receive.sub')}</p>
        </div>
        <Button variant="primary" size={48} block icon="content_copy" onClick={() => {
          navigator.clipboard?.writeText(user || '').then(() => toast.success(t('common.actions.copied'))).catch(() => {});
        }}>
          {t('wallet.receive.copy')}
        </Button>
      </Dialog>
    </div>
  );
}

export default Wallet;
