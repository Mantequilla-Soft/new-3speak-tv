import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MdRedeem, MdVolunteerActivism, MdBolt } from 'react-icons/md';
import AccountImg from '../HiveAvatar/AccountImg';
import { useSupporters, useSupported, formatSupportTotal } from '../../lib/supports';
import './Supporters.scss';

// One chip: the other account's avatar, the total, and an icon whose SHAPE
// says which way the support went, so it reads without colour: a gift for
// support received, a hand giving a heart for support given. (Arrows read as
// a value going up or down.)
// `account` null: the anonymous Lightning tips, all in one chip that links nowhere.
function SupportChip({ account, total, direction, label }) {
  const Arrow = direction === 'in' ? MdRedeem : MdVolunteerActivism;
  const inner = (
    <>
      {account
        ? <AccountImg account={account} alt="" loading="lazy" className="sp-badge-img" />
        : <MdBolt className="sp-badge-img sp-badge-bolt" aria-hidden="true" />}
      <span className="sp-badge-amount">{total}</span>
      <Arrow className="sp-badge-dir" aria-hidden="true" />
    </>
  );
  if (!account) {
    return <span className={`sp-badge sp-badge--${direction}`} title={label} aria-label={label}>{inner}</span>;
  }
  return (
    <Link to={`/@${account}`} className={`sp-badge sp-badge--${direction}`} title={label} aria-label={label}>
      {inner}
    </Link>
  );
}

/**
 * The profile's support row, in the badge block: first the people who tipped
 * this profile on a video (incoming), then the creators this
 * profile has tipped (outgoing), biggest totals first. "See all" opens the
 * Supporters tab (incoming). Renders nothing when there is neither.
 */
export default function SupportersBadges({ username, onOpen }) {
  const { t } = useTranslation();
  const { data: inData } = useSupporters(username);
  const { data: outData } = useSupported(username);

  const incoming = inData?.supporters || [];
  const outgoing = outData?.supported || [];
  if (!incoming.length && !outgoing.length) return null;
  const moreIn = Math.max((inData?.total || 0) - incoming.length, 0);
  const moreOut = Math.max((outData?.total || 0) - outgoing.length, 0);

  return (
    <div className="sp-badges">
      {incoming.map((s) => (
        <SupportChip
          key={`in-${s.tipper || '⚡'}`}
          account={s.tipper}
          total={formatSupportTotal(s.hbd_total, s.sats_total)}
          direction="in"
          label={s.tipper
            ? t('profile.supports.incomingTitle', { user: s.tipper, profile: username, amount: formatSupportTotal(s.hbd_total, s.sats_total, { compact: false }) })
            : t('profile.supports.incomingTitleLightning', { profile: username, amount: formatSupportTotal(s.hbd_total, s.sats_total, { compact: false }) })}
        />
      ))}
      {moreIn > 0 && <span className="sp-badges-more">+{moreIn}</span>}
      {incoming.length > 0 && onOpen && (
        <button type="button" className="sp-badges-all" onClick={onOpen}>
          {t('common.actions.seeAll')}
        </button>
      )}
      {incoming.length > 0 && outgoing.length > 0 && <span className="sp-badges-sep" aria-hidden="true" />}
      {outgoing.map((s) => (
        <SupportChip
          key={`out-${s.author}`}
          account={s.author}
          total={formatSupportTotal(s.hbd_total, s.sats_total)}
          direction="out"
          label={t('profile.supports.outgoingTitle', { user: s.author, profile: username, amount: formatSupportTotal(s.hbd_total, s.sats_total, { compact: false }) })}
        />
      ))}
      {moreOut > 0 && <span className="sp-badges-more">+{moreOut}</span>}
    </div>
  );
}
