import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DockTile, Menu, MenuRow, Segmented } from '../v2/ui';
import { Icon } from '../v2/Icon';
import { cx } from '../v2/helpers';
import useLayoutMediaQuery from '../../hooks/useLayoutMediaQuery';
import './ProfileActions.scss';

/**
 * The pieces of the channel header and tab bar shared by the public profile
 * (UserProfilePage) and your own (ProfilePage), drawn from the v2 primitives
 * (designs 20b and 37a).
 */

// A 64px action tile (Message, Tip, Share…). `as="a"` for links.
export function ProfileTile({ icon, label, as: El, className, ...rest }) {
  const content = (
    <>
      <Icon name={icon} size={24} />
      <span>{label}</span>
    </>
  );
  if (El) {
    return <El className={cx('v2-dock ph-tile', className)} aria-label={label} {...rest}>{content}</El>;
  }
  return <DockTile className={cx('ph-tile', className)} icon={<Icon name={icon} size={24} />} label={label} aria-label={label} {...rest} />;
}

/**
 * "More": the rest of a profile's actions as a menu (37a). A popover on
 * desktop, a bottom sheet on phones. `items` are { icon, label, onClick?, href?,
 * external?, danger?, hidden? }; a hidden item is skipped.
 */
export function ProfileMoreMenu({ items, title }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const isPhone = useLayoutMediaQuery('(max-width: 767px)');
  const wrapRef = useRef(null);
  const shown = items.filter((i) => i && !i.hidden);

  // Desktop popover: closes on an outside click or Escape.
  useEffect(() => {
    if (!open || isPhone) return undefined;
    const onDown = (e) => { if (!wrapRef.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, isPhone]);

  if (!shown.length) return null;

  const rows = shown.map((it) => {
    const run = () => { setOpen(false); it.onClick?.(); };
    return it.href ? (
      <MenuRow
        key={it.label}
        as="a"
        href={it.href}
        icon={it.icon}
        danger={it.danger}
        title={it.title}
        onClick={() => setOpen(false)}
        {...(it.external ? { target: '_blank', rel: 'noreferrer' } : {})}
      >
        {it.label}
      </MenuRow>
    ) : (
      <MenuRow key={it.label} icon={it.icon} danger={it.danger} title={it.title} onClick={run} disabled={it.disabled}>
        {it.label}
      </MenuRow>
    );
  });

  return (
    <div className="ph-more" ref={wrapRef}>
      <ProfileTile
        icon="more_horiz"
        label={t('profile.page.more')}
        aria-haspopup="menu"
        aria-expanded={open}
        title={title}
        onClick={() => setOpen((o) => !o)}
      />
      {open && !isPhone ? <Menu className="ph-more__menu">{rows}</Menu> : null}
      {isPhone ? (
        <Dialog open={open} onClose={() => setOpen(false)} title={title || t('profile.page.more')} closeLabel={t('common.actions.close')}>
          <div className="ph-more__sheet" role="menu">{rows}</div>
        </Dialog>
      ) : null}
    </div>
  );
}

/**
 * The profile tabs as one segmented track that scrolls sideways (37a), with
 * Wallet at the end: it navigates away, so it is a quiet button, not a tab.
 * `tabs` are { value, label, count?, icon? }.
 */
export function ProfileTabs({ tabs, value, onChange, walletLabel, onWallet, label }) {
  const ref = useRef(null);
  // A deep link can land on a late tab: bring the selected one into view.
  useEffect(() => {
    const el = ref.current?.querySelector('[aria-selected="true"]');
    el?.scrollIntoView?.({ inline: 'nearest', block: 'nearest', behavior: 'smooth' });
  }, [value]);
  return (
    <div className="ph-tabs" ref={ref}>
      <Segmented
        options={tabs.map((tb) => ({ ...tb, count: tb.count > 0 ? tb.count : undefined }))}
        value={value}
        onChange={onChange}
        block={false}
        scroll
        label={label}
        className="ph-tabs__track"
      />
      {onWallet ? (
        <button type="button" className="v2-btn v2-btn--ghost h40 ph-tabs__wallet" onClick={onWallet} aria-label={walletLabel} title={walletLabel}>
          <Icon name="account_balance_wallet" size={18} />
          <span className="v2-btn__label">{walletLabel}</span>
        </button>
      ) : null}
    </div>
  );
}
