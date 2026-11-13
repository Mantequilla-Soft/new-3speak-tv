import { useEffect } from "react";
import { StandaloneObsOverlay } from "@snapie/hangouts-react";

// Chrome-free OBS Browser Source overlay for a standalone OpenPods stream.
// The host copies the URL from the studio's restream panel and pastes it into
// OBS as a Browser Source. We serve it from OUR origin (preview.3speak.tv) so it
// runs the current SDK and targets whichever endpoint the stream is on, via the
// url+token in the query string — the shared hangout.3speak.tv/obs page is an
// older build that can't render our current streams.
export default function ObsOverlay() {
  // The app's base styles paint html/body with the theme ground; a Browser
  // Source must stay see-through (19i), so clear it while this page is up.
  useEffect(() => {
    const els = [document.documentElement, document.body];
    const prev = els.map((el) => el.style.background);
    els.forEach((el) => { el.style.background = "transparent"; });
    return () => els.forEach((el, i) => { el.style.background = prev[i]; });
  }, []);

  const p = new URLSearchParams(window.location.search);
  return (
    <StandaloneObsOverlay
      serverUrl={p.get("url") || ""}
      token={p.get("token") || ""}
      hostIdentity={p.get("host") || null}
    />
  );
}
