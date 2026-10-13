import { CHECKER_URL } from './config';
import { APP_VERSION } from '../version';

/**
 * Send what broke a page to the checker (routes/clientErrors.js), so a crash a
 * visitor only sees as "This page didn't load" can be found and fixed. Path only
 * (no query string, it can carry tokens), no account name. Fire and forget:
 * sendBeacon survives the reload that usually follows, and text/plain needs no
 * CORS preflight.
 */
export function reportClientError({ kind, error, componentStack }) {
  try {
    const payload = JSON.stringify({
      kind,
      route: window.location.pathname,
      message: String(error?.message || error || '').slice(0, 500),
      stack: String(error?.stack || '').slice(0, 4000),
      componentStack: String(componentStack || '').slice(0, 3000),
      appVersion: APP_VERSION,
    });
    const url = `${CHECKER_URL}/client-errors`;
    if (navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([payload], { type: 'text/plain' }));
    } else {
      fetch(url, { method: 'POST', body: payload, keepalive: true, headers: { 'Content-Type': 'text/plain' } }).catch(() => {});
    }
  } catch {
    // reporting must never be what breaks the page
  }
}
