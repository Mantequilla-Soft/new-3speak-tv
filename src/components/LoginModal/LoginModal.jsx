import { useEffect, useState } from "react";
import { useSignupPossible } from '../../utils/signupPossible';
import { withReferrer, getStoredInvite } from '../../utils/referral';
import { withLocale } from '../../utils/butrauthPopup';
import { AiohaModal, useAioha } from "@aioha/react-ui";
import { Providers, KeyTypes } from "@aioha/aioha";
import { createPortal } from "react-dom";
import { useTranslation, Trans } from "react-i18next";
import { ENABLE_METAMASK_SNAP, ENABLE_BUTRAUTH } from "../../utils/config";
import { useAppStore } from "../../lib/store";
import AccountImg from "../HiveAvatar/AccountImg";
import { listButrauthAccounts, forgetButrauthAccount } from "../../utils/butrauthAccounts";
import { toastIn } from "../../utils/toast";
import { Dialog, Button, IconButton, Banner, Icon } from "../v2/ui";
import CommunityPanel from "./CommunityPanel";
import "./LoginModal.scss";
// The look of aioha's own wallet modal (#aioha-modal), in the v2 design.
import "./aioha-v2.scss";

const toast = toastIn('Sign in');

// aioha provider ids → the names people know them by.
const PROVIDER_NAMES = {
  keychain: 'Keychain', hiveauth: 'HiveAuth', hivesigner: 'HiveSigner', ledger: 'Ledger',
  peakvault: 'PeakVault', metamasksnap: 'MetaMask', custom: 'Wallet',
};

// The wallets on the "Log in" tile of the chooser (42a). Proper names, not copy.
const WALLET_LIST = ['Keychain', 'HiveAuth', 'HiveSigner', 'PeakVault', 'Ledger', ...(ENABLE_METAMASK_SNAP ? ['MetaMask Snap'] : [])].join(', ');

// aioha's provider tiles, by the name it prints → the Material Symbol shown in
// place of its logo (§11 "Sign with": one icon set on the screen).
const PROVIDER_ICONS = {
  keychain: 'extension', 'peak vault': 'account_balance_wallet', peakvault: 'account_balance_wallet',
  hiveauth: 'qr_code_2', hivesigner: 'open_in_new', ledger: 'usb', metamask: 'wallet',
  'metamask snap': 'wallet', 'view only': 'visibility',
};

/**
 * Custom login modal wrapper that adds Butter Auth + MetaMask Snap login options to AiohaModal
 */
function LoginModal({ displayed, onLogin, onClose, loginOptions, intent }) {
  const { t } = useTranslation();
  const [topContainer, setTopContainer] = useState(null);
  const [bottomContainer, setBottomContainer] = useState(null);
  const [asideContainer, setAsideContainer] = useState(null);
  // 'choose' = sign-up / log-in chooser screen; 'providers' = wallet/provider list.
  const [step, setStep] = useState('choose');
  const { aioha } = useAioha();
  const { user, LogOut } = useAppStore();
  const incubationHandle = useAppStore((s) => s.incubationHandle);
  const [, setAccountsVersion] = useState(0);
  // aioha's modal keeps whatever page it showed last (e.g. "Add Account" after a
  // switch made from our own list); a fresh instance per opening always starts
  // on the account overview.
  const [aiohaKey, setAiohaKey] = useState(0);
  useEffect(() => { if (displayed) setAiohaKey((k) => k + 1); }, [displayed]);

  // Logged in via Butter Auth → the chooser offers logout instead of
  // sign-up/login (matches the "Logout" item the nav shows for these users).
  const isManteAuth = typeof window !== 'undefined' && localStorage.getItem("manteauth_login") === "true";

  const handleLogout = async () => {
    try { await LogOut(user); } catch { /* ignore */ }
    onClose?.();
  };

  // ── account switching ────────────────────────────────────────────────────
  // Wallet accounts are aioha's own list (also the wallet a Butter Auth login
  // parked there, see endWalletSession); Butter Auth accounts are the names
  // used in this browser (utils/butrauthAccounts). A Butter Auth account comes
  // back through the normal popup, where Butter Auth only asks to continue.
  const currentName = String(user || incubationHandle || '').toLowerCase();
  const walletAccounts = displayed
    ? Object.entries(aioha.getOtherLogins?.() || {}).map(([name, provider]) => ({ name, provider }))
    : [];
  const butrAccounts = displayed && ENABLE_BUTRAUTH
    ? listButrauthAccounts().filter((a) => a.name !== currentName)
    : [];

  const switchToWallet = (name) => {
    let ok;
    try { ok = aioha.switchUser(name); } catch { ok = false; }
    if (!ok) {
      // An expired HiveAuth/HiveSigner login cannot be resumed: log in again.
      toast.error(t('auth.loginModal.switchExpired'));
      setStep('providers');
      return;
    }
    // Same path as a fresh wallet login: ends the Butter Auth session, sets the
    // user, closes the modal.
    onLogin?.({ success: true, username: name, provider: aioha.getCurrentProvider?.() });
  };

  const forgetButr = (name) => {
    forgetButrauthAccount(name);
    setAccountsVersion((v) => v + 1);
  };

  // On open, route to the nav's intent so DESKTOP skips the "Welcome" chooser:
  //  - aioha wallet already logged in ("Change account") → provider list
  //  - Butter Auth session                               → change / log out screen
  //  - nav "Sign up"                                     → Butter Auth signup popup
  //  - nav "Log in"                                      → provider list
  //  - no intent (mobile bottom-nav, /login route)       → login/signup chooser
  useEffect(() => {
    if (!displayed) return;
    if (aioha.isLoggedIn()) { setStep('providers'); return; }
    if (isManteAuth) { setStep('choose'); return; }
    if (intent === 'signup' && ENABLE_BUTRAUTH) { setStep('signup'); startButrauthFlow(true); return; }
    if (intent === 'login') { setStep('providers'); return; }
    setStep('choose');
  }, [displayed, aioha, intent]);

  // Start the Butter Auth flow in a popup (state='popup' → ManteAuthCallback
  // signals back via a localStorage 'storage' event handled in App). Falls back
  // to a full-page redirect if the popup is blocked.
  const startButrauthFlow = async (signup = false) => {
    try {
      const res = await fetch('/api/manteauth/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        // signup:true → butrauth jumps straight to account creation (screen_hint=signup)
        // invite: the code from a 3speak.tv/invite/<code> link, if the visitor
        // came through one (utils/referral.js). Same hand-off as openButrauthPopup.
        body: JSON.stringify({ redirect_uri: window.location.origin + '/callback', state: 'popup', signup, invite: getStoredInvite() }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data.error || 'Failed to start Butter Auth login');
      // Same referral hand-off as openButrauthPopup. Both paths, or attribution
      // works only for whichever button the user happened to press.
      const url = withLocale(withReferrer(data.url));
      // Sized to the screen (capped) rather than a fixed 480x720: the signup
      // flow is tall (explainer, provider buttons, captcha) and was scrolling
      // inside a small popup.
      const w = Math.min(640, Math.max(420, Math.round(window.screen.availWidth * 0.42)));
      const h = Math.min(980, Math.max(660, Math.round(window.screen.availHeight * 0.92)));
      const left = window.screenX + Math.max(0, (window.outerWidth - w) / 2);
      const top = window.screenY + Math.max(0, (window.outerHeight - h) / 2);
      const popup = window.open(url, 'butrauth-login', `width=${w},height=${h},left=${left},top=${top}`);
      if (!popup) { window.location.href = url; return; } // popup blocked → full-page redirect
      // Keep a handle so the opener can close the popup once login completes,
      // more reliable than the popup closing itself after the cross-origin hop.
      window.__butrauthLoginPopup = popup;
    } catch (err) {
      console.error('Butter Auth start error:', err);
    }
  };

  // Inject the Butter Auth section into the aioha modal after it renders.
  // Only on the provider-selection page (has <ul> with wallet providers).
  useEffect(() => {
    if (!displayed || step !== 'providers') {
      setTopContainer(null);
      setBottomContainer(null);
      setAsideContainer(null);
      return;
    }

    // aioha's own English → the app's words (and the app's language).
    const replaceAiohaText = () => {
      const modal = document.querySelector('#aioha-modal');
      if (!modal) return;
      const swaps = {
        'Scan the QR code using a HiveAuth-compatible mobile app.': t('auth.loginModal.hiveAuthQrHint'),
        'Connect with one of our available Hive wallet providers.': t('auth.loginModal.loginWithWallet'),
      };
      modal.querySelectorAll('p').forEach((p) => {
        const next = swaps[p.textContent.trim()];
        if (next) p.textContent = next;
      });
    };

    // aioha's provider tiles are <a>s without an href: not reachable by keyboard.
    // Make each one a focusable button, and tag it with the Material Symbol
    // that replaces its logo (aioha-v2.scss draws it from data-icon).
    const tagProviders = () => {
      document.querySelectorAll('#aioha-modal ul > li > a').forEach((a) => {
        if (a.dataset.v2) return;
        a.dataset.v2 = '1';
        const name = (a.querySelector('span.flex-1')?.textContent || a.textContent || '').trim().toLowerCase();
        if (PROVIDER_ICONS[name]) a.dataset.icon = PROVIDER_ICONS[name];
        a.setAttribute('role', 'button');
        a.tabIndex = 0;
        a.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); a.click(); }
        });
      });
    };

    // The community half of the split login window (07e), on every aioha page.
    const injectAside = () => {
      const panel = document.querySelector('#aioha-modal > div > div');
      if (!panel) return;
      let aside = [...panel.children].find((c) => c.classList.contains('login-aside'));
      if (!aside) {
        aside = document.createElement('div');
        aside.className = 'login-aside';
      }
      if (panel.firstChild !== aside) panel.insertBefore(aside, panel.firstChild);
      setAsideContainer(aside);
    };

    const injectMetaMaskButton = () => {
      const modal = document.querySelector('#aioha-modal');
      if (!modal) return;
      const providerList = modal.querySelector('ul');
      if (!providerList) return;
      // Don't add if already injected
      if (providerList.querySelector('.metamask-snap-item')) return;

      // Clone style from existing provider items
      const existingItem = providerList.querySelector('li > a');
      if (!existingItem) return;

      const li = document.createElement('li');
      const a = document.createElement('a');
      a.className = existingItem.className;
      a.style.cursor = 'pointer';
      a.innerHTML = `
        <img src="https://upload.wikimedia.org/wikipedia/commons/3/36/MetaMask_Fox.svg"
             alt="MetaMask" style="width:32px;height:32px;" />
        <span class="flex-1 ms-3 whitespace-nowrap">MetaMask Snap</span>
      `;
      a.classList.add('metamask-snap-item');
      a.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        // Prompt for username then trigger MetaMask Snap login
        const username = prompt(t('auth.loginModal.enterUsername'));
        if (!username) return;
        try {
          // MetaMask Snap must login with Active key: contract calls require
          // Active authority and the snap derives different keys per role.
          const result = await aioha.login(Providers.MetaMaskSnap, username.trim(), {
            msg: loginOptions?.msg || 'Login',
            keyType: KeyTypes.Active,
          });
          if (result.success) {
            onLogin?.(result);
          } else {
            alert(result.error || t('auth.loginModal.metamaskFailed'));
          }
        } catch (err) {
          alert(err.message || t('auth.loginModal.metamaskFailed'));
        }
      });
      li.appendChild(a);
      providerList.appendChild(li);
    };

    // aioha's "Switch User" page is a table of its wallet accounts; the Butter
    // Auth accounts used in this browser join it as rows in the same markup
    // (a clone of aioha's own row), badge "butter auth". A click opens the
    // Butter Auth popup; finishing it parks the wallet (endWalletSession).
    const injectButrauthAccounts = () => {
      if (!ENABLE_BUTRAUTH) return;
      const tbody = document.querySelector('#aioha-modal table tbody');
      if (!tbody) return;
      const accounts = listButrauthAccounts();
      const rows = [...tbody.querySelectorAll('tr.butrauth-switch-row')];
      if (rows.length === accounts.length && rows.every((r, i) => r.dataset.name === accounts[i].name)) return;
      rows.forEach((r) => r.remove());
      const sample = tbody.querySelector('tr:not(.butrauth-switch-row)');
      for (const acc of accounts) {
        let tr;
        if (sample && sample.cells.length >= 2) {
          tr = sample.cloneNode(true);
          const nameEl = tr.cells[0].querySelector('div') || tr.cells[0];
          nameEl.textContent = acc.name;
          const badge = tr.cells[1].querySelector('span') || tr.cells[1];
          badge.textContent = 'butter auth';
          if (tr.cells[2]) tr.cells[2].innerHTML = '';
        } else {
          tr = document.createElement('tr');
          tr.innerHTML = '<td></td><td><span>butter auth</span></td>';
          tr.cells[0].textContent = acc.name;
        }
        tr.classList.add('butrauth-switch-row');
        tr.dataset.name = acc.name;
        tr.style.cursor = 'pointer';
        tr.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          startButrauthFlow();
        });
        tbody.appendChild(tr);
      }
    };

    // Watch the modal for page changes (Switch User, Add account, ...). It may not
    // exist yet when this effect runs (a reopened modal mounts a moment later),
    // so attach as soon as it does.
    let observer = null;
    let watched = null;
    const watchModal = () => {
      const m = document.querySelector('#aioha-modal');
      if (!m || m === watched || !observer) return;
      observer.disconnect();
      observer.observe(m, { childList: true, subtree: true });
      watched = m;
    };

    const injectButton = () => {
      watchModal();
      injectAside();
      injectButrauthAccounts();
      replaceAiohaText();
      if (ENABLE_METAMASK_SNAP) injectMetaMaskButton();
      tagProviders();
      const modalContent = document.querySelector('#aioha-modal > div > div');
      if (modalContent) {
        // Only show on provider selection page (check for provider list)
        const providerList = modalContent.querySelector('ul');
        if (!providerList) {
          // Not on provider selection page: tear the injected sections back down.
          modalContent.querySelector('.login-top-section')?.remove();
          modalContent.querySelector('.login-bottom-section')?.remove();
          setTopContainer(null);
          setBottomContainer(null);
          return;
        }

        // TOP section (Recommended + ButrAuth) goes ABOVE the wallet-provider
        // list so ButrAuth is the prominent, first-seen option. Insert into the
        // list's ACTUAL parent: the <ul> is a descendant of modalContent, not
        // necessarily a direct child.
        const listParent = providerList.parentNode;
        let top = modalContent.querySelector('.login-top-section');
        if (!top) {
          top = document.createElement('div');
          top.className = 'login-top-section';
        }
        if (listParent && (top.parentNode !== listParent || top.nextElementSibling !== providerList)) {
          listParent.insertBefore(top, providerList);
        }
        setTopContainer(top);

        // BOTTOM section ("No account? Sign up", 07e) right after the list.
        let bottom = modalContent.querySelector('.login-bottom-section');
        if (!bottom) {
          bottom = document.createElement('div');
          bottom.className = 'login-bottom-section';
        }
        if (listParent && providerList.nextElementSibling !== bottom) {
          listParent.insertBefore(bottom, providerList.nextSibling);
        }
        setBottomContainer(bottom);
      }
    };

    // Try with delays to ensure modal is rendered
    const timeouts = [
      setTimeout(injectButton, 50),
      setTimeout(injectButton, 150),
      setTimeout(injectButton, 300),
      setTimeout(injectButton, 800),
      setTimeout(injectButton, 1600),
    ];

    observer = new MutationObserver(() => {
      injectButton();
    });
    watchModal();

    return () => {
      timeouts.forEach(clearTimeout);
      observer.disconnect();
    };
  }, [displayed, step, t]);

  // aioha's wallet modal has no Escape key of its own; ours do (Dialog).
  useEffect(() => {
    if (!displayed || step !== 'providers') return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [displayed, step, onClose]);

  // Butter Auth is offered on the provider list in every state, also on "Change
  // account" from a wallet session: a Butter Auth login ends the wallet session
  // (endWalletSession, called where the login completes).
  const showLoginExtras = displayed && step === 'providers';
  // Asked once per page load and shared by every entry point.
  const signupPossible = useSignupPossible();
  // "No account? Sign up" under the wallets: only for somebody signed out.
  const offerSignupOnWallets = ENABLE_BUTRAUTH && signupPossible.possible && !currentName && !isManteAuth && !aioha.isLoggedIn();

  const chooserOpen = !!displayed && (step === 'choose' || step === 'signup');
  const chooserTitle = step === 'signup'
    ? t('auth.loginModal.openingSignup')
    : isManteAuth ? t('auth.loginModal.signedInTitle') : t('auth.loginModal.welcomeTitle');

  const cancel = <Button variant="ghost" block className="login-split__cancel" onClick={onClose}>{t('common.actions.cancel')}</Button>;

  // The "You're signed in" change-account screen for Butter Auth users (42a).
  const signedInBody = (
    <>
      <p className="login-split__sub">
        {user
          ? <Trans i18nKey="auth.loginModal.signedInAs" values={{ user }} components={{ b: <strong /> }} />
          : t('auth.loginModal.signedIn')}
      </p>
      {(walletAccounts.length > 0 || butrAccounts.length > 0) && (
        <div className="login-switch">
          <div className="v2-eyebrow">{t('auth.loginModal.switchTo')}</div>
          <ul className="login-switch__list">
            {walletAccounts.map((a) => (
              <li key={`w:${a.name}`} className="login-switch__row">
                <button type="button" className="login-switch__item" onClick={() => switchToWallet(a.name)}>
                  <AccountImg className="login-switch__avatar" account={a.name} alt="" />
                  <span className="login-switch__text">
                    <span className="login-switch__name">@{a.name}</span>
                    <span className="login-switch__via">{PROVIDER_NAMES[a.provider] || a.provider}</span>
                  </span>
                  <Icon name="chevron_right" size={18} className="login-switch__go" />
                </button>
              </li>
            ))}
            {butrAccounts.map((a) => (
              <li key={`b:${a.name}`} className="login-switch__row">
                <button type="button" className="login-switch__item" onClick={() => startButrauthFlow()}>
                  {a.incubation
                    ? <span className="login-switch__avatar login-switch__avatar--initial">{a.name.charAt(0).toUpperCase()}</span>
                    : <AccountImg className="login-switch__avatar" account={a.name} alt="" />}
                  <span className="login-switch__text">
                    <span className="login-switch__name">{a.incubation ? a.name : `@${a.name}`}</span>
                    <span className="login-switch__via">Butter Auth</span>
                  </span>
                </button>
                <IconButton
                  icon="close"
                  size={32}
                  variant="ghost"
                  round
                  className="login-switch__forget"
                  onClick={() => forgetButr(a.name)}
                  label={t('auth.loginModal.forgetAccount')}
                />
              </li>
            ))}
          </ul>
        </div>
      )}
      <Button variant="secondary" block icon="person_add" onClick={() => setStep('providers')}>
        {t('auth.loginModal.addAccount')}
      </Button>
      <Button variant="danger" block icon="logout" onClick={handleLogout}>
        {t('common.actions.logout')}
      </Button>
      <div className="login-split__spacer" />
      {cancel}
    </>
  );

  // "Welcome to 3Speak": sign up (recommended) or log in (42a).
  const welcomeBody = (
    <>
      <p className="login-split__sub">
        {ENABLE_BUTRAUTH ? t('auth.loginModal.welcomeSubSignup') : t('auth.loginModal.welcomeSubLogin')}
      </p>

      {/* Hidden when Butter Auth says no account can be created from this
          address: a capped network, or a VPN. Offering the button anyway means
          somebody signs in, picks a name, generates keys and is refused at the
          last step. The check fails OPEN, so a failed request still shows it. */}
      {ENABLE_BUTRAUTH && signupPossible.possible && (
        <button type="button" className="login-option is-recommended" onClick={() => startButrauthFlow(true)}>
          <Icon name="person_add" size={22} className="login-option__icon" />
          <span className="login-option__body">
            <b>{t('common.actions.signUp')} <span className="login-option__aside">{t('auth.loginModal.recommended')}</span></b>
            <span>{t('auth.loginModal.signupSubtitle')}</span>
          </span>
          <Icon name="arrow_forward" size={18} className="login-option__go" />
        </button>
      )}
      {ENABLE_BUTRAUTH && !signupPossible.possible && (
        <Banner tone="warn" icon={signupPossible.reason === 'datacenter_ip' ? 'vpn_lock' : 'public_off'}>
          {signupPossible.reason === 'datacenter_ip'
            ? t('auth.loginModal.signupBlockedVpn')
            : t('auth.loginModal.signupBlockedNetwork')}
        </Banner>
      )}

      <button type="button" className="login-option" onClick={() => setStep('providers')}>
        <Icon name="login" size={22} className="login-option__icon" />
        <span className="login-option__body">
          <b>{ENABLE_BUTRAUTH ? t('auth.loginModal.loginWithButrauthOrWallet') : t('auth.loginModal.loginWithWallet')}</b>
          <span>{WALLET_LIST}</span>
        </span>
        <Icon name="arrow_forward" size={18} className="login-option__go" />
      </button>
      <div className="login-split__spacer" />
      {cancel}
    </>
  );

  // Signup intent from the nav: the Butter Auth account-creation popup is
  // already opening; this is just the fallback if it was blocked.
  const signupBody = (
    <>
      <div className="login-split__status">
        <Icon name="progress_activity" size={18} className="v2-spin" />
        <span>{t('auth.loginModal.openingSignupHint')}</span>
      </div>
      <Button variant="secondary" block icon="open_in_new" onClick={() => startButrauthFlow(true)}>
        {t('auth.loginModal.reopenSignup')}
      </Button>
      <Button variant="secondary" block icon="login" onClick={() => setStep('providers')}>
        {t('auth.loginModal.loginInstead')}
      </Button>
      <div className="login-split__spacer" />
      {cancel}
    </>
  );

  return (
    <>
      {/* Chooser: the "You're signed in" change-account screen for Butter Auth
          users, and (for logged-out users with no explicit nav intent, i.e.
          mobile bottom-nav / the /login route) the Welcome login-or-signup pick.
          Desktop nav buttons pass an intent and skip this entirely. Same split
          window (07e) as the wallet list it leads to, so nothing jumps. */}
      <Dialog
        open={chooserOpen}
        onClose={onClose}
        title={chooserTitle}
        head={false}
        width={640}
        className="login-split"
        bodyClassName="login-split__body"
      >
        <CommunityPanel />
        <div className="login-split__main">
          <div className="login-split__head">
            <h2 className="login-split__title">{chooserTitle}</h2>
            <IconButton icon="close" label={t('common.actions.close')} variant="ghost" round onClick={onClose} />
          </div>
          <div className="login-split__content">
            {step === 'signup' ? signupBody : isManteAuth ? signedInBody : welcomeBody}
          </div>
        </div>
      </Dialog>
      <AiohaModal
        key={aiohaKey}
        displayed={displayed && step === 'providers'}
        onLogin={onLogin}
        onClose={onClose}
        loginTitle={t('common.actions.login')}
        loginOptions={loginOptions}
      />
      {showLoginExtras && asideContainer && createPortal(<CommunityPanel />, asideContainer)}
      {showLoginExtras && topContainer && ENABLE_BUTRAUTH && createPortal(
        <button
          type="button"
          className="butrauth-login-btn"
          onClick={(e) => { e.stopPropagation(); startButrauthFlow(); }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <img src="/butrauth-logo.png" alt="" width={28} height={28} />
          <span className="butrauth-text">
            <span className="butrauth-title">Butter Auth <span className="recommended-suffix">{t('auth.loginModal.recommended')}</span></span>
            <span className="butrauth-subtitle">{t('auth.loginModal.butrauthSubtitle')}</span>
          </span>
          <Icon name="arrow_forward" size={18} className="butrauth-go" />
        </button>,
        topContainer
      )}
      {showLoginExtras && bottomContainer && offerSignupOnWallets && createPortal(
        <p className="login-signup-line">
          {t('auth.loginModal.noAccount')}{' '}
          <button
            type="button"
            className="login-signup-line__link"
            onClick={(e) => { e.stopPropagation(); setStep('signup'); startButrauthFlow(true); }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {t('common.actions.signUp')}
          </button>
        </p>,
        bottomContainer
      )}
    </>
  );
}

export default LoginModal;
