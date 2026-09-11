import { Component } from "react";
import { reloadForUpdate } from "../utils/checkLatestVersion";

/* There was no error boundary anywhere above <Routes>, so anything a route threw
 * while rendering unmounted the whole tree and left the page background behind
 * with nothing drawn on it. Every such failure looked identical to the user: a
 * blank screen, no message, no way forward but a manual reload.
 *
 * This catches it and says so. The most common cause is not the page at all but a
 * chunk that could not be downloaded — lazyRoute() already retries and reloads
 * once for that, so anything reaching here has survived both.
 */
export default class RouteErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Keep the real stack in the console — the panel below is deliberately vague,
    // but debugging must not get harder than it was without a boundary.
    console.error("[route] render failed", error, info?.componentStack);
  }

  // A route error belongs to the location that produced it. Without this, one
  // broken page would keep showing its error over every route the user then
  // navigated to, because the boundary itself never unmounts.
  componentDidUpdate(prevProps) {
    if (this.state.error && prevProps.routeKey !== this.props.routeKey) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;

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
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>This page didn't load</h2>
        <p style={{ margin: 0, maxWidth: 420, fontSize: 14, lineHeight: 1.5, opacity: 0.75 }}>
          Part of the app failed to download. That usually means a new version was
          released while this tab was open. Reloading picks it up.
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
            Reload
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
            Go home
          </button>
        </div>
      </div>
    );
  }
}
