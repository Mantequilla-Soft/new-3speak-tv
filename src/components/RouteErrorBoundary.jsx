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
    // the main bundle (styles/design-system.scss), not in a route chunk.
    return (
      <div
        role="alert"
        style={{
          minHeight: "60vh",
          maxWidth: 640,
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          justifyContent: "center",
          gap: 12,
          padding: "48px 0",
          color: "var(--text)",
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 72, height: 72, borderRadius: 24, display: "grid", placeItems: "center",
            background: "var(--accent-tint-strong)", color: "var(--accent)",
          }}
        >
          <Icon name={isChunk ? "cloud_off" : "heart_broken"} size={40} />
        </span>
        <h2 className="v2-heading-lg" style={{ margin: "10px 0 0" }}>
          {isChunk ? t('misc.routeError.title') : t('misc.routeError.brokenTitle')}
        </h2>
        <p style={{ margin: 0, maxWidth: 520, fontSize: 16, lineHeight: 1.5, color: "var(--muted)" }}>
          {isChunk ? t('misc.routeError.body') : t('misc.routeError.brokenBody')}
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
          <button type="button" className="v2-btn v2-btn--primary h56 is-next" style={{ gap: 24 }} onClick={() => reloadForUpdate()}>
            <span className="v2-btn__label">{t('misc.routeError.reload')}</span>
            <Icon name="refresh" size={22} />
          </button>
          <button type="button" className="v2-btn v2-btn--secondary h56 is-next" style={{ gap: 24 }} onClick={() => { window.location.href = "/"; }}>
            <span className="v2-btn__label">{t('misc.routeError.goHome')}</span>
            <Icon name="home" size={22} />
          </button>
        </div>
        <details
          style={{
            marginTop: 8, maxWidth: 520, padding: "8px 12px", borderRadius: 12,
            background: "var(--surface)", border: "1px solid var(--border)",
            fontSize: 12, color: "var(--muted)",
          }}
        >
          <summary style={{ cursor: "pointer", fontWeight: 700 }}>{t('misc.routeError.details')}</summary>
          <code className="mono" style={{ display: "block", marginTop: 8, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{detail}</code>
        </details>
      </div>
    );
  }
}
