import { useCallback, useEffect, useRef, useState } from 'react';
import { FiChevronLeft, FiChevronRight, FiEdit2 } from 'react-icons/fi';
import { fetchSpotlight } from '../../utils/spotlight';
import { useTranslation } from 'react-i18next';
import './ProfileLinksPanel.scss';

// Collapse is a preference, not a per-profile state: someone who folds the
// column away means it for every profile they visit, and it survives reloads.
const COLLAPSE_KEY = 'links-panel-collapsed';
const readCollapsed = () => {
  try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; }
};

// The framed page paints whatever background, fills and text colours its owner
// chose, which is right on the standalone page and shouting on a profile.
// Beside the overview it wears the app's own palette instead — surfaces, text
// and borders all become 3Speak's, while the creator's layout, icons, imagery
// and copy stay theirs. The full-colour version is one click away on the
// standalone page.
//
// The frame is same-origin (nginx serves it from this host), so the override
// goes in as a stylesheet on the framed document rather than as a render flag
// the API would have to grow. `null` document = not ready or, one day, not
// same-origin; either way there is nothing to style and nothing to fix.
function applyHostTheme(frame) {
  let doc;
  try { doc = frame?.contentDocument; } catch { return; }   // cross-origin
  if (!doc?.head) return;
  const host = getComputedStyle(document.documentElement);
  const v = (name, fallback) => (host.getPropertyValue(name) || '').trim() || fallback;
  const css = `
    body {
      background: ${v('--bg-secondary', '#16181c')} !important;
      color: ${v('--text-primary', '#f1f5f9')} !important;
    }
    /* Shadows exist to lift text off a photo background there is no longer. */
    .nm, .hd, .bio, .h { text-shadow: none !important; }
    .hd, .bio { color: ${v('--text-secondary', '#94a3b8')} !important; }
    /* The avatar's coloured glow ring goes with the background it was lit for. */
    .av { box-shadow: none !important; }

    /* Every block surface becomes one app card: same fill, same border, no
       coloured glow. !important because per-block colours are written as
       inline styles by the renderer. Radius, spacing and layout are left
       alone — those are the creator's design, not its palette. */
    .lnk, .emb, .vcard, .chbtn {
      background: ${v('--bg-tertiary', '#242424')} !important;
      color: ${v('--text-primary', '#f1f5f9')} !important;
      border: 1px solid ${v('--border-color', '#3d3d3d')} !important;
      box-shadow: none !important;
    }
    /* Icon pucks carry their own fill per link; let the card show through. */
    .ic { background: transparent !important; color: inherit !important; }
    .emb-img { background: ${v('--bg-hover', 'rgba(255,255,255,0.08)')} !important; }
  `;
  let style = doc.getElementById('sp-host-theme');
  if (!style) {
    style = doc.createElement('style');
    style.id = 'sp-host-theme';
    doc.head.appendChild(style);
  }
  style.textContent = css;
}

/**
 * The creator's Spotlight links, beside the Overview tab on desktop.
 *
 * This is the REAL links page in a frame — the same standalone HTML nginx serves
 * at /links/<user>, iframed exactly the way the editor's "Live preview" does it.
 * Rendering the blocks a second time in React would drift from the page it is
 * supposed to be showing (theme background, avatar, headline, motion, latest-posts
 * feed are all resolved server-side), so it renders the page itself instead.
 *
 * The chain read is only there to answer "is there a page at all?": no links →
 * no panel, and the overview takes the full width back. The owner gets a short
 * prompt through to the editor instead, otherwise the feature is invisible to
 * exactly the person who can fill it.
 *
 * Mobile never mounts this — see ProfileOverview's desktop check.
 *
 * Collapsed, the column shrinks to a chevron that nudges sideways on a loop, so
 * a visitor still notices this profile HAS a links page (a folded-away panel
 * that gave no sign of itself would simply be lost).
 */
export default function ProfileLinksPanel({ username, isOwnProfile = false, onOpenTab }) {
  const { t } = useTranslation();
  const [state, setState] = useState({ loading: true, exists: false });
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const frameRef = useRef(null);

  const themeFrame = useCallback(() => applyHostTheme(frameRef.current), []);

  // Re-skin when the app switches between light and dark: the framed document
  // has no idea the host's tokens changed under it.
  useEffect(() => {
    const target = document.documentElement;
    const obs = new MutationObserver(themeFrame);
    obs.observe(target, { attributes: true, attributeFilter: ['data-theme', 'class'] });
    return () => obs.disconnect();
  }, [themeFrame]);

  const setFolded = (next) => {
    setCollapsed(next);
    try { localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0'); } catch { /* private mode */ }
  };

  useEffect(() => {
    if (!username) return undefined;
    let alive = true;
    setState({ loading: true, exists: false });
    fetchSpotlight(username)
      .then((r) => { if (alive) setState({ loading: false, exists: r.exists && !!r.page?.sections?.length }); })
      .catch(() => { if (alive) setState({ loading: false, exists: false }); });
    return () => { alive = false; };
  }, [username]);

  // No placeholder while it loads: most creators have no page yet, so a skeleton
  // would appear only to collapse again a moment later.
  if (state.loading) return null;

  if (!state.exists) {
    if (!isOwnProfile) return null;
    return (
      <aside className="profile-links-panel profile-links-panel--empty">
        <div className="plp-inner">
          <p className="plp-hint">{t('profile.links.emptyHint')}</p>
          <button type="button" className="plp-btn" onClick={() => onOpenTab?.('links')}>{t('profile.links.add')}</button>
        </div>
      </aside>
    );
  }

  if (collapsed) {
    return (
      <aside className="profile-links-panel profile-links-panel--collapsed">
        <button
          type="button"
          className="plp-handle"
          onClick={() => setFolded(false)}
          title={t('profile.links.show', { user: username })}
          aria-label={t('profile.links.show', { user: username })}
        >
          <FiChevronLeft size={18} />
        </button>
      </aside>
    );
  }

  return (
    <aside className="profile-links-panel">
      <div className="plp-inner">
        {/* Sits in the frame's top-left corner, over the page it folds away. */}
        <button
          type="button"
          className="plp-hide"
          onClick={() => setFolded(true)}
          title={t('profile.links.hide')}
          aria-label={t('profile.links.hide')}
        >
          <FiChevronRight size={16} />
        </button>

        {/* Its twin in the opposite corner, on your own profile only. */}
        {isOwnProfile ? (
          <button
            type="button"
            className="plp-edit"
            onClick={() => onOpenTab?.('links')}
            title={t('profile.links.edit')}
            aria-label={t('profile.links.edit')}
          >
            <FiEdit2 size={14} />
          </button>
        ) : null}

        {/* Same-origin, so SAMEORIGIN framing is fine; every link the page renders
            already carries target="_blank", so a click never navigates in here. */}
        <iframe
          ref={frameRef}
          className="plp-frame"
          src={`/links/${username}`}
          title={t('profile.links.frameTitle', { user: username })}
          loading="lazy"
          onLoad={themeFrame}
        />

        <div className="plp-foot">
          {/* A plain anchor, not a router Link: /links/<user> is served as
              standalone HTML by nginx (the React route is only a fallback). */}
          <a className="plp-open" href={`/links/${username}`} target="_blank" rel="noreferrer">
            {t('profile.links.open')}
          </a>
        </div>
      </div>
    </aside>
  );
}
