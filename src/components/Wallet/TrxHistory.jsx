import React, { useEffect, useMemo, useState } from "react";
import { getHiveClient } from '../../utils/hiveNode';
import "./TrxHistory.scss";
import Skeleton from "./Skeleton";
import { useTranslation } from "react-i18next";
import { formatDate, formatTimeAgoCompact, formatNumber } from "../../i18n";
import { Segmented, EmptyState, Icon } from "../v2/ui";
import { cx } from "../v2/helpers";

const client = getHiveClient();

const BATCH_SIZE = 100;
const MAX_TRANSACTIONS = 100;

async function vestsToHP(vests) {
  const dgp = await client.database.getDynamicGlobalProperties();
  const totalVests = parseFloat(dgp.total_vesting_shares.split(" ")[0]);
  const totalHP = parseFloat(dgp.total_vesting_fund_hive.split(" ")[0]);
  return (vests * totalHP) / totalVests;
}

async function fetchAllTransactions(username) {
  let transactions = [];
  let start = -1;
  let attempts = 0;

  while (transactions.length < MAX_TRANSACTIONS && attempts < 10) {
    try {
      const batch = await client.database.getAccountHistory(username, start, BATCH_SIZE);

      const processed = await Promise.all(batch.map(async ([index, op]) => {
        const [type, data] = op.op;

        if (type === "transfer") {
          const isSend = data.from === username;
          const [amount, currency] = data.amount.split(" ");

          return {
            id: index,
            type: isSend ? "send" : "receive",
            amount: parseFloat(amount),
            coin: currency,
            address: isSend ? data.to : data.from,
            date: new Date(op.timestamp + "Z"),
            memo: data.memo,
          };
        }

        if (type === "claim_reward_balance") {
          const hive = data.reward_hive_balance ? parseFloat(data.reward_hive_balance.split(" ")[0]) : 0;
          const hbd = data.reward_hbd_balance ? parseFloat(data.reward_hbd_balance.split(" ")[0]) : 0;
          const hp = data.reward_vests
            ? await vestsToHP(parseFloat(data.reward_vests.split(" ")[0]))
            : 0;

          return {
            id: index,
            type: "claim",
            amount: {
              HIVE: hive,
              HBD: hbd,
              HP: hp,
            },
            date: new Date(op.timestamp + "Z"),
            memo: "Claimed Rewards",
          };
        }

        return null;
      }));

      transactions = [...transactions, ...processed.filter(Boolean)];
      start = batch[0][0] - BATCH_SIZE;
      if (start < 0) break;

      attempts++;
      await new Promise((resolve) => setTimeout(resolve, 300));
    } catch (error) {
      console.error("Error fetching transactions:", error);
      break;
    }
  }

  return transactions.sort((a, b) => b.date - a.date);
}

const amt = (n) => formatNumber(n, { minimumFractionDigits: 3, maximumFractionDigits: 3 });

const FILTERS = ["all", "rewards", "received", "sent"];
const MATCH = {
  all: () => true,
  rewards: (tx) => tx.type === "claim",
  received: (tx) => tx.type === "receive",
  sent: (tx) => tx.type === "send",
};

/**
 * The wallet's Activity list (design 21e, 25c): transfers in and out and
 * claimed rewards, newest first, in a fixed-height panel that scrolls inside.
 * `onLoaded(list)` hands the loaded list to the page (the earnings chart).
 */
function TrxHistory({ user, onLoaded }) {
  const { t } = useTranslation();
  const [isLoading, setIsLoading] = useState(true);
  const [transactions, setTransactions] = useState([]);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    const loadTransactions = async () => {
      try {
        setIsLoading(true);
        if (user) {
          const txns = await fetchAllTransactions(user);
          setTransactions(txns);
          onLoaded?.(txns);
        }
      } catch (err) {
        setError(t('wallet.history.loadFailed'));
        console.error(err);
      } finally {
        setIsLoading(false);
      }
    };

    loadTransactions();
  }, [user, t, onLoaded]);

  const shown = useMemo(() => transactions.filter(MATCH[filter]), [transactions, filter]);

  return (
    <section className="trx" id="wallet-activity" aria-labelledby="wallet-activity-title">
      <div className="trx__head">
        <h2 id="wallet-activity-title">{t('wallet.activity.title')}</h2>
        <Segmented
          block={false}
          size={28}
          className="trx__filter"
          label={t('wallet.activity.title')}
          value={filter}
          onChange={setFilter}
          options={FILTERS.map((f) => ({ value: f, label: t(`wallet.activity.filters.${f}`) }))}
        />
      </div>
      <div className="trx__list">
        {isLoading ? (
          <Skeleton />
        ) : error ? (
          <div className="v2-failure" role="alert"><b>{error}</b></div>
        ) : shown.length === 0 ? (
          <EmptyState icon="receipt_long" title={t('wallet.activity.emptyTitle')}>{t('wallet.activity.empty')}</EmptyState>
        ) : (
          shown.map((transaction) => {
            const incoming = transaction.type !== "send";
            const when = (
              <time dateTime={transaction.date.toISOString()} title={formatDate(transaction.date, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}>
                {formatTimeAgoCompact(transaction.date)}
              </time>
            );
            if (transaction.type === "claim") {
              const parts = [
                transaction.amount.HBD > 0 && `${amt(transaction.amount.HBD)} HBD`,
                transaction.amount.HP > 0 && `${amt(transaction.amount.HP)} HP`,
                transaction.amount.HIVE > 0 && `${amt(transaction.amount.HIVE)} HIVE`,
              ].filter(Boolean);
              return (
                <div key={transaction.id} className="trx__row">
                  <span className="trx__icon is-in"><Icon name="redeem" size={24} /></span>
                  <div className="trx__body">
                    <b>{t('wallet.history.claimedRewards')}</b>
                    <span>{t('wallet.history.types.claim')} · {when}</span>
                  </div>
                  <span className="trx__amt is-in">{parts.length ? parts.map((p) => <span key={p}>+{p}</span>) : "-"}</span>
                </div>
              );
            }
            return (
              <div key={transaction.id} className="trx__row">
                <span className={cx("trx__icon", incoming && "is-in")}>
                  <Icon name={incoming ? "south_west" : "send"} size={24} />
                </span>
                <div className="trx__body">
                  <b>{incoming ? t('wallet.activity.from', { user: transaction.address || "-" }) : t('wallet.activity.sentTo', { user: transaction.address || "-" })}</b>
                  <span>{transaction.memo ? <>{transaction.memo} · </> : null}{when}</span>
                </div>
                <span className={cx("trx__amt", incoming && "is-in")}>
                  {incoming ? "+" : "−"}{amt(transaction.amount)} {transaction.coin}
                </span>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

export default TrxHistory;
