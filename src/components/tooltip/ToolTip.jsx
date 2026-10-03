import React, { useRef, useLayoutEffect, useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { IoClose } from 'react-icons/io5'
import HiveAvatar from '../HiveAvatar/HiveAvatar'

import "./ToolTip.scss"

// Reusable voters tooltip. Used by the vote counter (rows carry `reward`, shown
// as $) and by the watch-page topic chips (rows carry `weight` 0–10000, shown as
// a %). Optional `title` overrides the header, `emptyText` the empty state, and
// `footer` renders a pinned-only action row (e.g. an "Open tag feed" button).
function ToolTip({
  tooltipVoters, anchorRef, pinned, onClose,
  title, pinnedTitle, emptyText, footer,
}) {
  const { t } = useTranslation();
  const tipRef = useRef(null);
  const navigate = useNavigate();
  const [pos, setPos] = useState(null);

  useLayoutEffect(() => {
    if (!anchorRef?.current || !tipRef.current) return;
    const anchor = anchorRef.current.getBoundingClientRect();
    const tip = tipRef.current.getBoundingClientRect();
    const gap = 8;

    let top = anchor.top - tip.height - gap;
    let left = anchor.left + anchor.width / 2 - tip.width / 2;

    // Keep within viewport
    if (top < 8) top = anchor.bottom + gap;
    if (left < 8) left = 8;
    if (left + tip.width > window.innerWidth - 8)
      left = window.innerWidth - tip.width - 8;

    setPos({ top: top + window.scrollY, left });
  }, [anchorRef, tooltipVoters, pinned]);

  // Close on click outside when pinned. Scrolling keeps it open — the tooltip
  // is absolutely positioned at page coordinates, so it scrolls with the page.
  useEffect(() => {
    if (!pinned) return;
    const handleClick = (e) => {
      if (tipRef.current?.contains(e.target)) return;
      if (anchorRef?.current?.contains(e.target)) return;
      onClose?.();
    };
    document.addEventListener('mousedown', handleClick);
    return () => {
      document.removeEventListener('mousedown', handleClick);
    };
  }, [pinned, onClose, anchorRef]);

  const content = (
    <div
      ref={tipRef}
      className={`votes-tooltip${pinned ? ' pinned' : ''}`}
      style={pos ? { top: pos.top, left: pos.left, opacity: 1 } : { opacity: 0 }}
    >
      <div className="votes-tooltip-header">
        <span>
          {pinned
            ? (pinnedTitle || t('engagement.voters.pinnedTitle', { count: tooltipVoters.length }))
            : (title || t('engagement.voters.topVoters'))}
        </span>
        {pinned && (
          <button className="votes-tooltip-close" onClick={onClose}>
            <IoClose size={14} />
          </button>
        )}
      </div>
      <div className="votes-tooltip-list">
        {(pinned ? tooltipVoters : tooltipVoters.slice(0, 10)).map((voter, index) => (
          <div key={index} className="votes-tooltip-row">
            <HiveAvatar
              username={voter.username}
              size="small"
              imgClassName="votes-tooltip-avatar"
              alt=""
              badgeSize={10}
            />
            <a
              className="votes-tooltip-user"
              href={`/@${voter.username}`}
              onClick={(e) => { e.preventDefault(); navigate(`/@${voter.username}`); onClose?.(); }}
            >
              @{voter.username}
            </a>
            {voter.reward != null && (
              <span className="votes-tooltip-reward">${voter.reward.toFixed(3)}</span>
            )}
            {voter.reward == null && voter.weight != null && (
              <span className="votes-tooltip-reward">{Math.round(voter.weight / 100)}%</span>
            )}
          </div>
        ))}
        {tooltipVoters.length === 0 && (
          <div className="votes-tooltip-empty">{emptyText === undefined ? t('engagement.voters.noVotes') : emptyText}</div>
        )}
      </div>
      {pinned && footer && (
        <div className="votes-tooltip-footer">{footer}</div>
      )}
    </div>
  );

  return createPortal(content, document.body);
}

export default ToolTip
