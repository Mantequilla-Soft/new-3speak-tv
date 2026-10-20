// Butter Auth accounts used in this browser, for the account switcher.
//
// Butter Auth keeps its own session on its domain, so switching back to one of
// these is the normal login popup, which then only asks to confirm the identity
// ("Continue as …"). Nothing secret is stored here: names only, newest first.
//
// Wallet accounts live in aioha's own list (aiohaOtherLogins); this is the
// Butter Auth half of the same "Change account" menu.

const KEY = 'butrauth_accounts';
const MAX = 6;

/** [{ name, incubation }] newest first. */
export function listButrauthAccounts() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(raw)
      ? raw.filter((a) => a && typeof a.name === 'string' && a.name).map((a) => ({ name: a.name, incubation: !!a.incubation }))
      : [];
  } catch {
    return [];
  }
}

function save(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX))); } catch { /* storage off */ }
}

/** Put `name` at the top of the list (a Hive account, or an incubation handle). */
export function rememberButrauthAccount(name, { incubation = false } = {}) {
  const n = String(name || '').trim().toLowerCase();
  if (!n) return;
  save([{ name: n, incubation: !!incubation }, ...listButrauthAccounts().filter((a) => a.name !== n)]);
}

export function forgetButrauthAccount(name) {
  const n = String(name || '').trim().toLowerCase();
  save(listButrauthAccounts().filter((a) => a.name !== n));
}
