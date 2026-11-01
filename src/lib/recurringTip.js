// 💜 Monthly support: Hive's own `recurrent_transfer`. The chain sends the amount
// every `recurrence` hours, `executions` times, the first one right away, with no
// server of ours in between. Hive keeps ONE per sender → recipient (pair_id 0):
// a new one replaces the old one, and amount 0 stops it.
//
// Chain limits: recurrence >= 24 h, executions >= 2, and the whole run within
// 730 days, so 24 rounds of 30 days (720 days) is the longest choice.
//
// Not reported to the checker as a support: the payments arrive as
// fill_recurrent_transfer virtual ops, which /supports/record does not look for.
import { getRecurrentTransfers } from '../hive-api/hiveApi';

export const MONTH_HOURS = 720;
export const MONTH_CHOICES = [3, 6, 12, 24];

export function recurrentTransferOp({ from, to, amount, currency, memo = '', months }) {
  return ['recurrent_transfer', {
    from,
    to,
    amount: `${Number(amount).toFixed(3)} ${currency}`,
    memo,
    recurrence: MONTH_HOURS,
    executions: months,
    extensions: [],
  }];
}

// Amount 0 deletes it; recurrence and executions must still pass validation.
export function stopRecurrentTransferOp({ from, to, currency }) {
  return ['recurrent_transfer', {
    from, to, amount: `0.000 ${currency}`, memo: '', recurrence: MONTH_HOURS, executions: 2, extensions: [],
  }];
}

// When the last payment goes out: `start` is the first one, `count` the payments
// from there on.
export function lastPaymentDate(start, count, recurrenceHours = MONTH_HOURS) {
  return new Date(new Date(start).getTime() + Math.max(0, count - 1) * recurrenceHours * 3600 * 1000);
}

// The monthly support `from` already sends `to`, or null.
// → { amount: '5.000 HBD', currency, until: Date }
export async function findMonthlySupport(from, to) {
  if (!from || !to) return null;
  const list = await getRecurrentTransfers(from);
  const r = list.find((x) => x.to === to && !x.pair_id);
  if (!r) return null;
  // Hive gives trigger_date as UTC without a zone.
  const next = /Z$/.test(r.trigger_date) ? r.trigger_date : `${r.trigger_date}Z`;
  return {
    amount: r.amount,
    currency: String(r.amount).split(' ')[1] || 'HBD',
    until: lastPaymentDate(next, r.remaining_executions, r.recurrence),
  };
}

// "February 2027" in the viewer's language.
export const formatMonth = (date, lang) => {
  try { return new Intl.DateTimeFormat(lang || undefined, { month: 'long', year: 'numeric' }).format(date); }
  catch { return date.toISOString().slice(0, 7); }
};
