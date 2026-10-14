import { Component } from "react";
import { reloadForUpdate } from "../utils/checkLatestVersion";
import { isChunkLoadError } from "../utils/staleChunk";
import { reportClientError } from "../utils/reportClientError";
import { t } from "../i18n";

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

    // Inline styles on purpose: a stylesheet chunk can fail to load for exactly
    // the same reasons a route chunk can, and this panel has to render anyway.
    return (
      <div
        style={{
          minHeight: "60vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 14,
          padding: "48px 20px",
          textAlign: "center",
          color: "var(--text-primary, #e8e8e8)",
        }}
      >
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>
          {isChunk ? t('misc.routeError.title') : t('misc.routeError.brokenTitle')}
        </h2>
        <p style={{ margin: 0, maxWidth: 420, fontSize: 14, lineHeight: 1.5, opacity: 0.75 }}>
          {isChunk ? t('misc.routeError.body') : t('misc.routeError.brokenBody')}
        </p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
          <button
            onClick={() => reloadForUpdate()}
            style={{
              padding: "9px 20px",
              borderRadius: 8,
              border: "1px solid var(--accent-primary, #e53935)",
              background: "transparent",
              color: "var(--accent-primary, #e53935)",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {t('misc.routeError.reload')}
          </button>
          <button
            onClick={() => { window.location.href = "/"; }}
            style={{
              padding: "9px 20px",
              borderRadius: 8,
              border: "1px solid var(--border-color, #333)",
              background: "transparent",
              color: "var(--text-primary, #e8e8e8)",
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            {t('misc.routeError.goHome')}
          </button>
        </div>
        <details style={{ maxWidth: 520, fontSize: 12, opacity: 0.7, textAlign: "left" }}>
          <summary style={{ cursor: "pointer", textAlign: "center" }}>{t('misc.routeError.details')}</summary>
          <code style={{ display: "block", marginTop: 8, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{detail}</code>
        </details>
      </div>
    );
  }
}
