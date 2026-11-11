import { Component } from "react";
import { reloadForUpdate } from "../utils/checkLatestVersion";
import { isChunkLoadError } from "../utils/staleChunk";
import { reportClientError } from "../utils/reportClientError";
import { t } from "../i18n";
import { Icon } from "./v2/Icon";

/* There was no error boundary anywhere above <Routes>, so anything a route threw
 * while rendering unmounted the whole tree and left the page background behind
 * with nothing drawn on it. Every such failure looked identical to the user: a
 * blank screen, no message, no way forward but a manual reload.
 *
 * This catches it and says so. A chunk that could not be downloaded is one cause
 * (lazyRoute() already reloads once for that, so anything reaching here has
 * survived both); a page that threw while rendering is the other, and that one
 * is a bug. The panel words them differently, shows the error under "Details",
 * and reports it (utils/reportClientError.js) so the bug can be found without
 * the visitor's console.
 */
// Design 30d: a 72 icon tile, a 48 headline, the muted line, the 56 buttons,
// then the details in a mono well. On a phone the block sits at the bottom of
// the screen, the headline is 28 and the buttons take the full width.
const ROUTE_ERROR_CSS = `
.route-error { min-height: 60vh; max-width: 640px; display: flex; flex-direction: column; align-items: flex-start; justify-content: center; padding: 48px 0; color: var(--text); }
.route-error__icon { width: 72px; height: 72px; border-radius: 24px; display: grid; place-items: center; background: var(--accent-tint-strong); color: var(--accent); }
.route-error__title { margin: 22px 0 0; font-size: 48px; font-weight: 900; letter-spacing: -.04em; line-height: 1; }
.route-error__body { margin: 10px 0 0; max-width: 520px; font-size: 16px; line-height: 1.5; color: var(--muted); }
.route-error__actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 24px; }
.route-error__actions .v2-btn { gap: 24px; padding: 0 16px 0 20px; }
.route-error__actions .v2-btn--secondary { font-weight: 700; }
.route-error__details { margin-top: 20px; max-width: 520px; padding: 8px 12px; border-radius: 12px; background: var(--surface); border: 1px solid var(--border); font-size: 12px; color: var(--muted); }
.route-error__details summary { cursor: pointer; font-weight: 700; }
.route-error__details code { display: block; margin-top: 8px; white-space: pre-wrap; word-break: break-word; font-size: 12px; }
@media (max-width: 767px) {
  .route-error { min-height: calc(100dvh - 160px); justify-content: flex-end; align-items: stretch; padding: 24px 0; }
  .route-error__icon { width: 60px; height: 60px; border-radius: 20px; }
  .route-error__icon .material-symbols-rounded { font-size: 32px !important; }
  .route-error__title { margin-top: 16px; font-size: 28px; letter-spacing: -.03em; }
  .route-error__body { margin-top: 6px; font-size: 13px; }
  .route-error__actions { flex-direction: column; margin-top: 18px; }
  .route-error__actions .v2-btn { width: 100%; justify-content: space-between; padding: 0 18px; }
  .route-error__details { align-self: flex-start; }
}
`;

export default class RouteErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, componentStack: "" };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Keep the real stack in the console too: debugging must not get harder than
    // it was without a boundary.
    console.error("[route] render failed", error, info?.componentStack);
    this.setState({ componentStack: info?.componentStack || "" });
    reportClientError({
      kind: isChunkLoadError(error) ? "chunk" : "render",
      error,
      componentStack: info?.componentStack,
    });
  }

  // A route error belongs to the location that produced it. Without this, one
  // broken page would keep showing its error over every route the user then
  // navigated to, because the boundary itself never unmounts.
  componentDidUpdate(prevProps) {
    if (this.state.error && prevProps.routeKey !== this.props.routeKey) {
      this.setState({ error: null, componentStack: "" });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;

    const { error, componentStack } = this.state;
    const isChunk = isChunkLoadError(error);
    // First component in the stack, e.g. "at Card3": usually enough to find it.
    const where = (componentStack.match(/at (\w+)/) || [])[1];
    const detail = `${error?.name || "Error"}: ${error?.message || String(error)}${where ? ` (${where})` : ""}`;

    // Design 30d. Layout is inline on purpose: a stylesheet chunk can fail to
    // load for exactly the same reasons a route chunk can, and this panel has to
    // render anyway. The look comes from the v2 classes and tokens, which live in
    // the main bundle (styles/design-system.scss), not in a route chunk. The few
    // phone rules ride along in a <style> of their own for the same reason.
    return (
      <div role="alert" className="route-error">
        <style>{ROUTE_ERROR_CSS}</style>
        <span className="route-error__icon" aria-hidden="true">
          <Icon name={isChunk ? "cloud_off" : "heart_broken"} size={40} />
        </span>
        <h2 className="route-error__title">
          {isChunk ? t('misc.routeError.title') : t('misc.routeError.brokenTitle')}
        </h2>
        <p className="route-error__body">
          {isChunk ? t('misc.routeError.body') : t('misc.routeError.brokenBody')}
        </p>
        <div className="route-error__actions">
          <button type="button" className="v2-btn v2-btn--primary h56 is-next" onClick={() => reloadForUpdate()}>
            <span className="v2-btn__label">{t('misc.routeError.reload')}</span>
            <Icon name="refresh" size={24} />
          </button>
          <button type="button" className="v2-btn v2-btn--secondary h56 is-next" onClick={() => { window.location.href = "/"; }}>
            <span className="v2-btn__label">{t('misc.routeError.goHome')}</span>
            <Icon name="home" size={24} />
          </button>
        </div>
        <details className="route-error__details">
          <summary>{t('misc.routeError.details')}</summary>
          <code className="mono">{detail}</code>
        </details>
      </div>
    );
  }
}
