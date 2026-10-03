import React, { useRef, useLayoutEffect, useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { IoClose } from 'react-icons/io5'
import HiveAvatar from '../HiveAvatar/HiveAvatar'

import "./BeneficiariesTooltip.scss"
import { getHiveUrl } from '../../utils/hiveNode'

// Median HIVE price (HBD per 1 HIVE), fetched once per session.
let cachedHivePrice = null;
async function fetchHivePrice() {
  if (cachedHivePrice != null) return cachedHivePrice;
  try {
    const res = await fetch(getHiveUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'condenser_api.get_current_median_history_price', params: [], id: 1 }),
    });
    const j = await res.json();
    const base = parseFloat(j?.result?.base);    // e.g. "0.240 HBD"
    const quote = parseFloat(j?.result?.quote);  // e.g. "1.000 HIVE"
    if (base > 0 && quote > 0) cachedHivePrice = base / quote;
  } catch { /* ignore — HIVE/HP rows just won't render */ }
  return cachedHivePrice;
}

function BeneficiariesTooltip({ beneficiaries, payoutInfo, displayTotal, anchorRef, pinned, onClose }) {
  const { t } = useTranslation();
  const tipRef = useRef(null);
  const navigate = useNavigate();
  const [pos, setPos] = useState(null);
  const [hivePrice, setHivePrice] = useState(cachedHivePrice);

  useEffect(() => {
    if (hivePrice != null) return;
    let alive = true;
    fetchHivePrice().then((p) => { if (alive && p != null) setHivePrice(p); });
    return () => { alive = false; };
  }, [hivePrice]);

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
  }, [anchorRef, beneficiaries, pinned, payoutInfo, displayTotal]);

  // Close on click outside or scroll when pinned
  useEffect(() => {
    if (!pinned) return;
    const handleClick = (e) => {
      if (tipRef.current?.contains(e.target)) return;
      if (anchorRef?.current?.contains(e.target)) return;
      onClose?.();
    };
    const handleScroll = () => onClose?.();
    document.addEventListener('mousedown', handleClick);
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      document.removeEventListener('mousedown', handleClick);
      window.removeEventListener('scroll', handleScroll);
    };
  }, [pinned, onClose, anchorRef]);

  const isPaidOut = payoutInfo?.isPaidOut;

  // Use displayTotal (total_hive_reward from 3speak API) as the source of truth
  // since Hive's total_payout_value only includes the HBD portion (not vesting/HP).
  const totalPayout = displayTotal || 0;
  // Hive splits 50% to curators, 50% to author
  const curatorPayout = totalPayout * 0.5;
  const authorPayout = totalPayout * 0.5;

  const totalBeneWeight = beneficiaries.reduce((sum, b) => sum + b.weight, 0);
  const beneShare = (authorPayout * totalBeneWeight) / 100;
  const authorNet = authorPayout - beneShare;
  const showBreakdown = totalPayout > 0;

  // Estimated token split — ONLY while the post is pending. Take the pending
  // payout in HBD, convert to HIVE via the median price, split in half → HIVE
  // (liquid) + HP (powered up). Once paid out the exact HIVE/HP isn't available
  // from the post, so these rows are skipped.
  const pendingHBD = !payoutInfo?.isPaidOut ? (payoutInfo?.pendingPayout || 0) : 0;
  const halfHive = hivePrice && pendingHBD > 0 ? (pendingHBD / hivePrice) / 2 : null;

  const content = (
    <div
      ref={tipRef}
      className={`beneficiaries-tooltip${pinned ? ' pinned' : ''}`}
      style={pos ? { top: pos.top, left: pos.left, opacity: 1 } : { opacity: 0 }}
    >
      <div className="beneficiaries-tooltip-header">
        <span>
          {showBreakdown
            ? isPaidOut ? t('engagement.payout.breakdown') : t('engagement.payout.estimatedBreakdown')
            : t('engagement.payout.beneficiaries')}
        </span>
        {pinned && (
          <button type="button" className="beneficiaries-tooltip-close" onClick={onClose}>
            <IoClose size={14} />
          </button>
        )}
      </div>

      {showBreakdown && (
        <div className="beneficiaries-tooltip-breakdown">
          <div className="beneficiaries-tooltip-breakdown-row">
            <span className="beneficiaries-tooltip-breakdown-label">{t('engagement.payout.curators')}</span>
            <span className="beneficiaries-tooltip-breakdown-value">
              {!isPaidOut && '~'}${curatorPayout.toFixed(2)}
            </span>
          </div>
          <div className="beneficiaries-tooltip-breakdown-row">
            <span className="beneficiaries-tooltip-breakdown-label">{t('engagement.payout.author')}</span>
            <span className="beneficiaries-tooltip-breakdown-value">
              {!isPaidOut && '~'}${authorNet.toFixed(2)}
            </span>
          </div>
        </div>
      )}

      {halfHive != null && (
        <div className="beneficiaries-tooltip-breakdown beneficiaries-tooltip-tokens">
          <div className="beneficiaries-tooltip-breakdown-row">
            <span className="beneficiaries-tooltip-breakdown-label">HIVE</span>
            <span className="beneficiaries-tooltip-breakdown-value">~{halfHive.toFixed(3)}</span>
          </div>
          <div className="beneficiaries-tooltip-breakdown-row">
            <span className="beneficiaries-tooltip-breakdown-label">HP</span>
            <span className="beneficiaries-tooltip-breakdown-value">~{halfHive.toFixed(3)}</span>
          </div>
        </div>
      )}

      <div className="beneficiaries-tooltip-list">
        {showBreakdown && beneficiaries.length > 0 && (
          <div className="beneficiaries-tooltip-section-label">{t('engagement.payout.beneficiaries')}</div>
        )}
        {beneficiaries.map((b, index) => (
          <div key={index} className="beneficiaries-tooltip-row">
            <HiveAvatar
              username={b.account}
              size="small"
              imgClassName="beneficiaries-tooltip-avatar"
              alt=""
              badgeSize={10}
            />
            <a
              className="beneficiaries-tooltip-user"
              href={`/@${b.account}`}
              onClick={(e) => { e.preventDefault(); navigate(`/@${b.account}`); onClose?.(); }}
            >
              @{b.account}
            </a>
            <span className="beneficiaries-tooltip-pct">
              {b.weight}%
              {showBreakdown && (
                <span className="beneficiaries-tooltip-amount">
                  {!isPaidOut && '~'}${((authorPayout * b.weight) / 100).toFixed(2)}
                </span>
              )}
            </span>
          </div>
        ))}
      </div>

      {showBreakdown && (
        <div className="beneficiaries-tooltip-total">
          <span>{isPaidOut ? t('engagement.payout.total') : t('engagement.payout.totalEstimated')}</span>
          <span>{!isPaidOut && '~'}${totalPayout.toFixed(2)}</span>
        </div>
      )}
    </div>
  );

  return createPortal(content, document.body);
}

export default BeneficiariesTooltip
