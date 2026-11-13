import { Component, Suspense, useState } from 'react';

/* Helpers for components that are code-split with React.lazy() but are NOT
 * routes: dialogs, pickers, players that only matter once someone opens them.
 * Keeping them out of the first download is what makes the home page fast.
 *
 * Routes use utils/lazyRoute.js, which reloads the page when a chunk fails.
 * That is wrong here: the user may be halfway through typing a comment when
 * they open the emoji picker. So a chunk that fails to load (a deploy replaced
 * it, the network dropped) just leaves that piece out and logs it; the rest of
 * the page keeps working.
 */

class QuietBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(err) {
    console.error(`[lazy] ${this.props.name || 'component'} failed`, err);
  }

  render() {
    return this.state.failed ? (this.props.fallback ?? null) : this.props.children;
  }
}

/** Suspense + an error boundary that renders `fallback` (default nothing). */
export function LazyBoundary({ children, fallback = null, name }) {
  return (
    <QuietBoundary fallback={fallback} name={name}>
      <Suspense fallback={fallback}>{children}</Suspense>
    </QuietBoundary>
  );
}

/** Renders `children` (a lazy component) only from the first time `when` is
 * true, then keeps it mounted, so a dialog's close animation and state behave
 * exactly as before. Until then nothing is downloaded. */
export default function MountWhenOpened({ when, children, fallback = null, name }) {
  const [opened, setOpened] = useState(Boolean(when));
  if (when && !opened) setOpened(true);
  return opened ? <LazyBoundary fallback={fallback} name={name}>{children}</LazyBoundary> : null;
}
