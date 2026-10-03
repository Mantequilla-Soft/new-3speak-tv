import { useEffect, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { IoClose } from 'react-icons/io5';
import { CHECKER_URL } from '../../utils/config';
import './SubscriberTicker.scss';

const avatar = (u) => `/img/u/${u}/avatar/small`;

/**
 * Horizontal news-ticker of active 3Speak Pro subscribers. Click → popup
 * with the full list. Renders nothing until at least one subscriber loads.
 */
export default function SubscriberTicker() {
  const [subs, setSubs] = useState([]);
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    fetch(`${CHECKER_URL}/premium?limit=2000`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setSubs(Array.isArray(d.subscribers) ? d.subscribers : []); })
      .catch(() => { /* best-effort */ });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  // Duplicate the list so the marquee loops seamlessly.
  const loop = useMemo(() => [...subs, ...subs], [subs]);
  if (subs.length === 0) return null;

  const goProfile = (u) => { setOpen(false); navigate(`/p/${u}`); };

  return (
    <>
      <div
        className="sub-ticker"
        onClick={() => setOpen(true)}
        title="See all 3Speak Pro subscribers"
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter') setOpen(true); }}
      >
        <span className="sub-ticker-label">
          <i className="fa-solid fa-crown" /> {subs.length} Pro subscriber{subs.length !== 1 ? 's' : ''}
        </span>
        <div className="sub-ticker-viewport">
          <div
            className="sub-ticker-track"
            style={{ animationDuration: `${Math.max(20, subs.length * 3)}s` }}
          >
            {loop.map((s, i) => (
              <span className="sub-ticker-item" key={`${s.username}-${i}`}>
                <img src={avatar(s.username)} alt="" loading="lazy" />
                @{s.username}
              </span>
            ))}
          </div>
        </div>
      </div>

      {open && createPortal(
        <div className="sub-modal-overlay" onClick={() => setOpen(false)}>
          <div className="sub-modal" onClick={(e) => e.stopPropagation()}>
            <div className="sub-modal-header">
              <h3><i className="fa-solid fa-crown" /> 3Speak Pro subscribers ({subs.length})</h3>
              <button className="sub-modal-close" onClick={() => setOpen(false)} aria-label="Close">
                <IoClose size={20} />
              </button>
            </div>
            <div className="sub-modal-list">
              {subs.map((s) => (
                <button
                  type="button"
                  className="sub-modal-item"
                  key={s.username}
                  onClick={() => goProfile(s.username)}
                >
                  <img src={avatar(s.username)} alt="" loading="lazy" />
                  <span className="sub-modal-name">@{s.username}</span>
                </button>
              ))}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
