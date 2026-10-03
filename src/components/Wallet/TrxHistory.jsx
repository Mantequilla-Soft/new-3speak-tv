import React, { useEffect, useState } from "react";
import { getHiveClient } from '../../utils/hiveNode';
import "./TrxHistory.scss";
import { Client } from "@hiveio/dhive";
import Skeleton from "./Skeleton";
import { HIVE_API_NODES } from "../../utils/config";
import { useTranslation } from "react-i18next";
import { formatDate } from "../../i18n";

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

function TrxHistory({ user }) {
  const { t } = useTranslation();
  const [isLoading, setIsLoading] = useState(true);
  const [transactions, setTransactions] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    const loadTransactions = async () => {
      try {
        setIsLoading(true);
        if (user) {
          const txns = await fetchAllTransactions(user);
          setTransactions(txns);
        }
      } catch (err) {
        setError(t('wallet.history.loadFailed'));
        console.error(err);
      } finally {
        setIsLoading(false);
      }
    };

    loadTransactions();
  }, [user, t]);

  return (
    <div className="transaction-history">
      <h2>{t('wallet.history.title')}</h2>
      <div className="history-table">
        {isLoading ? (
          <Skeleton />
        ) : error ? (
          <div className="error-message">{error}</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>{t('wallet.history.cols.type')}</th>
                <th>{t('wallet.history.cols.amount')}</th>
                <th>{t('wallet.history.cols.account')}</th>
                <th>{t('wallet.history.cols.date')}</th>
                <th>{t('wallet.history.cols.memo')}</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((transaction) => (
                <tr key={transaction.id}>
                  <td>
                    <div className="tx-type">
                      <span className={`tx-icon ${transaction.type}`}>
                        <i
                          className={`fas fa-${
                            transaction.type === "send"
                              ? "arrow-up"
                              : transaction.type === "claim"
                              ? "gift"
                              : "arrow-down"
                          }`}
                        ></i>
                      </span>
                      {transaction.type === "send"
                        ? t('wallet.history.types.transfer')
                        : transaction.type === "claim"
                        ? t('wallet.history.types.claim')
                        : t('wallet.history.types.received')}
                    </div>
                  </td>
                  <td>
                    {transaction.type === "claim" ? (
                      <span className="tx-amount">
                        {transaction.amount.HBD > 0 &&
                          `${transaction.amount.HBD.toFixed(3)} HBD `}
                        {transaction.amount.HP > 0 &&
                          `${transaction.amount.HP.toFixed(3)} HP `}
                        {transaction.amount.HIVE > 0 &&
                          `${transaction.amount.HIVE.toFixed(3)} HIVE`}
                      </span>
                    ) : (
                      <span className="tx-amount">
                        {transaction.amount.toFixed(3)} {transaction.coin}
                      </span>
                    )}
                  </td>
                  <td>
                    <span className="tx-address">
                      {transaction.address || "-"}
                    </span>
                  </td>
                  <td>
                    {formatDate(transaction.date, {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  <td>
                    <span className="memo">{(transaction.type === "claim" ? t('wallet.history.claimedRewards') : transaction.memo) || "-"}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default TrxHistory;
