import { formatNumber } from '../../i18n';

/**
 * The points card's "How to earn" list, grouped (habits, watching and
 * listening, creating, engaging, recognition, growing, live), with the amounts
 * the live server pays: hangouts GET /points/awards/config (`cfg`) for the
 * awards, the account's points info (`earn`) for streaming, watching and
 * chatting. A way to earn shows only when the server names its amount, so an
 * older server lists only what it pays.
 *
 * `cfg` may name an award as a number (its amount) or as an object, at the top
 * level, under `kinds` or under `awards`:
 *   { amount, perUnit|perMinute, maxPerDay, perDay, max, maxEver, perHbd,
 *     minViewers, amounts: { "7": 20, "30": 100 } }
 * (`perDay` = how many a day, `maxPerDay` = points a day at most.)
 */

const NUM_KEYS = {
  amount: ['amount', 'points'],
  perUnit: ['perUnit', 'perMinute', 'perMin'],
  maxPerDay: ['maxPerDay', 'dayMax', 'dailyMax', 'maxDay'],
  perDay: ['perDay', 'countPerDay', 'dailyCount', 'limitPerDay'],
  max: ['max', 'cap'],
  maxEver: ['maxEver', 'ever'],
  perHbd: ['perHbd'],
  minViewers: ['minViewers'],
};

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** One award's config, normalized, or null when the server does not name it. */
export function awardConfig(cfg, kind) {
  if (!cfg || typeof cfg !== 'object') return null;
  const raw = cfg.kinds?.[kind] ?? cfg.awards?.[kind] ?? cfg[kind];
  if (isNum(raw)) return { amount: raw };
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  for (const [name, keys] of Object.entries(NUM_KEYS)) {
    const k = keys.find((x) => isNum(raw[x]));
    if (k) out[name] = raw[k];
  }
  const amounts = raw.amounts || raw.milestones;
  if (amounts && typeof amounts === 'object') {
    out.amounts = {};
    for (const [k, v] of Object.entries(amounts)) if (isNum(v)) out.amounts[k] = v;
  }
  return out;
}

const n = (v) => formatNumber(v);

/** Groups of { key, label, rate } rows; empty groups are left out. */
export function buildEarnGroups(t, earn = {}, cfg = null) {
  const e = earn || {};
  const c = (kind) => awardConfig(cfg, kind) || {};
  // An award's amount: the config first, then the account's points info.
  const amountOf = (kind) => c(kind).amount ?? (isNum(e[kind]) ? e[kind] : undefined);
  const label = (key, opts) => t(`wallet.points.earn.${key}`, opts);
  const rows = [];
  const add = (group, key, rate, opts) => { if (rate) rows.push({ group, key, label: label(key, opts), rate }); };

  // A flat amount per award, its limit a day or ever when the server says.
  const each = (kind) => {
    const a = amountOf(kind);
    if (!(a > 0)) return null;
    const cf = c(kind);
    if (cf.perDay > 0) return t('wallet.points.rate.eachUpTo', { n: n(a), max: n(cf.perDay) });
    if (cf.maxEver > 0) return t('wallet.points.rate.eachMax', { n: n(a), max: n(cf.maxEver) });
    return t('wallet.points.rate.each', { n: n(a) });
  };
  const once = (kind) => (amountOf(kind) > 0 ? t('wallet.points.rate.once', { n: n(amountOf(kind)) }) : null);
  const perDay = (kind) => (amountOf(kind) > 0 ? t('wallet.points.rate.perDay', { n: n(amountOf(kind)) }) : null);
  const perMinute = (kind) => {
    const cf = c(kind);
    const per = cf.perUnit ?? cf.amount;
    if (!(per > 0)) return null;
    return cf.maxPerDay > 0
      ? t('wallet.points.rate.perMinuteUpTo', { n: n(per), max: n(cf.maxPerDay) })
      : t('wallet.points.rate.perMinute', { n: n(per) });
  };

  // Habits
  add('habits', 'login', perDay('login'));
  {
    const s = c('streak').amounts || {};
    const d7 = s['7'] ?? s.day7;
    const d30 = s['30'] ?? s.day30;
    add('habits', 'streak', d7 > 0 && d30 > 0 ? t('wallet.points.rate.streak', { a: n(d7), b: n(d30) }) : null);
  }
  add('habits', 'week5', amountOf('week5') > 0 ? t('wallet.points.rate.perWeek', { n: n(amountOf('week5')) }) : null);
  add('habits', 'anniv', amountOf('anniv') > 0 ? t('wallet.points.rate.perYear', { n: n(amountOf('anniv')) }) : null);
  add('habits', 'quest', each('quest'));
  add('habits', 'pwa', once('pwa'));

  // Watching and listening
  add('watching', 'first5', perDay('first5'));
  add('watching', 'vodtime', perMinute('vodtime'));
  add('watching', 'finish', each('finish'));
  add('watching', 'listen', perMinute('listen'));
  add('watching', 'premiere', each('premiere'));
  add('watching', 'playlist', each('playlist'));

  // Creating
  add('creating', 'first', each('first'));
  add('creating', 'storystreak', each('storystreak'));
  add('creating', 'challenge', each('challenge'));
  {
    const a = amountOf('remix');
    const day = c('remix').perDay ?? (isNum(cfg?.remixPerDay) ? cfg.remixPerDay : e.remixPerDay);
    add('creating', 'remix', a > 0 ? t('wallet.points.rate.eachUpTo', { n: n(a), max: n(day ?? 0) }) : null);
  }
  add('creating', 'premheld', each('premheld'));

  // Engaging
  add('engaging', 'tag', each('tag'));
  add('engaging', 'pollvote', each('pollvote'));
  add('engaging', 'reply', each('reply'));
  add('engaging', 'community', each('community'));
  {
    const cf = c('tip');
    const a = amountOf('tip');
    if (a > 0) {
      let rate;
      if (cf.perHbd > 0 && cf.max > 0) rate = t('wallet.points.rate.tipMax', { n: n(a), per: n(cf.perHbd), max: n(cf.max) });
      else if (cf.perHbd > 0) rate = t('wallet.points.rate.tip', { n: n(a), per: n(cf.perHbd) });
      else rate = t('wallet.points.rate.each', { n: n(a) });
      add('engaging', 'tip', rate);
    }
  }
  add('engaging', 'clip', each('clip'));

  // Recognition
  add('recognition', 'rank', amountOf('rank') > 0 ? t('wallet.points.rate.perBoard', { n: n(amountOf('rank')) }) : null);
  add('recognition', 'reach', each('reach'), { n: n(c('reach').minViewers ?? 20) });
  add('recognition', 'remixed', each('remixed'));
  add('recognition', 'peak10', once('peak10'));

  // Growing
  {
    const m = c('followers').amounts || {};
    const steps = ['10', '100', '1000'].filter((k) => m[k] > 0);
    add('growing', 'followers', steps.length ? steps.map((k) => n(m[k])).join(' / ') : null,
      { a: n(10), b: n(100), c: n(1000) });
  }
  add('growing', 'referral', amountOf('referral') > 0 ? n(amountOf('referral')) : null);
  add('growing', 'invited', amountOf('invited') > 0 ? n(amountOf('invited')) : null);

  // Live
  add('live', 'watch', isNum(e.watchPerMin) ? t('wallet.points.rate.perMinute', { n: n(e.watchPerMin) }) : null);
  add('live', 'chat', isNum(e.chatPerWord) ? t('wallet.points.rate.perWord', { n: n(e.chatPerWord) }) : null);
  add('live', 'stream', isNum(e.streamPerMin) ? t('wallet.points.rate.perMinute', { n: n(e.streamPerMin) }) : null);
  add('live', 'raid', isNum(e.raid) ? n(e.raid) : null);
  add('live', 'boost', isNum(e.boostMax) ? t('wallet.points.rate.upTo', { n: n(e.boostMax) }) : null);
  add('live', 'collab', each('collab'));
  add('live', 'raided', each('raided'));
  add('live', 'party', perDay('party'));

  // Watching and listening count only for people who opted into viewer or
  // listener rewards: that is the consent to keep a name with what they watch.
  const notes = {
    watching: t('wallet.points.earnNote.watching', {
      watch: t('settings.viewerRewards.title'), listen: t('settings.viewerRewards.listenAlso'),
    }),
  };
  return GROUPS
    .map((g) => ({
      id: g, title: t(`wallet.points.earnGroup.${g}`), rows: rows.filter((r) => r.group === g),
      ...(notes[g] ? { note: notes[g] } : {}),
    }))
    .filter((g) => g.rows.length);
}

export const GROUPS = ['habits', 'watching', 'creating', 'engaging', 'recognition', 'growing', 'live'];

const QUEST_KEY_RE = /^wallet\.points\.quests\.[\w-]+$/;

/**
 * A weekly quest's title: the i18n key the server names (`titleKey`), then
 * wallet.points.quests.<id>, else a generic "Weekly quest". Never the raw key.
 */
export function questTitle(t, i18n, quest) {
  const keys = [];
  if (quest?.titleKey && QUEST_KEY_RE.test(quest.titleKey)) keys.push(quest.titleKey);
  if (quest?.id && /^[\w-]+$/.test(quest.id)) keys.push(`wallet.points.quests.${quest.id}`);
  const hit = keys.find((k) => i18n?.exists?.(k));
  return hit ? t(hit) : t('wallet.points.questsPanel.generic');
}
