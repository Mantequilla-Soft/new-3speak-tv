import { useState } from 'react';
import { Icon } from '../v2/Icon';
import { cx } from '../v2/helpers';
import './GroupHero.scss';

/**
 * The header of a group page (a community or a badge): design 20c.
 *
 * A cyan-washed card, because cyan is community on 3Speak: the group's picture,
 * an eyebrow saying what kind of group it is, the name, one meta line, and on
 * the right the one thing a visitor came to decide (Join) followed by square
 * action tiles. On a phone the actions drop under the name as one row.
 *
 * Props
 *   avatar    picture URL; the first letter of `title` stands in without one
 *   round     a round picture (badges are medals) instead of the rounded square
 *   coin      the picture spins like a coin on hover (badge pages)
 *   eyebrow   "COMMUNITY", "BADGE"
 *   meta      the line under the name (counts, issuer)
 *   about     an optional sentence under the meta line
 *   action    the main button (render <GroupHeroJoin/> or nothing)
 *   tiles     [{ icon, label, onClick, href, title, disabled, active }]
 */
export default function GroupHero({ avatar, round = false, coin = false, eyebrow, title, meta, about, action, tiles = [], className }) {
  const [failed, setFailed] = useState(false);
  const letter = String(title || '?').trim().slice(0, 1).toUpperCase();
  return (
    <section className={cx('group-hero', className)}>
      <span className={cx('group-hero__pic', round && 'is-round', coin && 'is-coin')} aria-hidden="true">
        {avatar && !failed
          ? <img src={avatar} alt="" onError={() => setFailed(true)} />
          : <span className="group-hero__letter">{letter}</span>}
      </span>
      <div className="group-hero__text">
        {eyebrow && <div className="group-hero__eyebrow">{eyebrow}</div>}
        <h1 className="group-hero__title">{title}</h1>
        {meta && <div className="group-hero__meta">{meta}</div>}
        {about && <p className="group-hero__about">{about}</p>}
      </div>
      {(action || tiles.length > 0) && (
        <div className="group-hero__actions">
          {action}
          {tiles.map((tile) => {
            const El = tile.href ? 'a' : 'button';
            return (
              <El
                key={tile.label}
                className={cx('group-hero__tile', tile.active && 'is-on')}
                type={El === 'button' ? 'button' : undefined}
                href={tile.href}
                onClick={tile.onClick}
                title={tile.title || tile.label}
                disabled={El === 'button' ? tile.disabled : undefined}
                aria-pressed={tile.active ?? undefined}
              >
                <Icon name={tile.icon} size={24} fill={!!tile.active} />
                <span>{tile.label}</span>
              </El>
            );
          })}
        </div>
      )}
    </section>
  );
}

// The Join / Subscribed button: a 64px cyan fill (the community colour), or a
// quiet surface fill once you are in.
export function GroupHeroJoin({ joined, busy, onClick, label, joinedLabel, busyLabel, title }) {
  return (
    <button
      type="button"
      className={cx('group-hero__join', joined && 'is-joined')}
      onClick={onClick}
      disabled={busy}
      aria-pressed={!!joined}
      title={title}
    >
      <span>{busy ? busyLabel : joined ? joinedLabel : label}</span>
      <Icon name={busy ? 'progress_activity' : joined ? 'check' : 'group_add'} size={24} className={busy ? 'v2-spin' : undefined} />
    </button>
  );
}
