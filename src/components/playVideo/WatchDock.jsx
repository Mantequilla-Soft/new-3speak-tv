import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DockTile, Dialog, MenuRow } from '../v2/ui';
import { Icon } from '../v2/Icon';
import { cx } from '../v2/helpers';
import './WatchDock.scss';

// One action. `lock` (lockProps from PlayVideo) is spread last so a locked
// action keeps its title and refuses the click with the reason.
const actionProps = (item, onClick) => ({
  onClick,
  title: item.title || undefined,
  'aria-label': item.ariaLabel || undefined,
  disabled: item.disabled || undefined,
  ...(item.lock || {}),
});

/**
 * The action dock under the player (Watch v2, 02): 60px tiles for the main
 * actions, and a "More" tile that opens the video action menu (07d): a grid of
 * tiles for the extras, then rows, the destructive one in accent. On a wide
 * screen the menu is a popover under the tile; on a narrow one it is a sheet.
 *
 * tiles / moreTiles / moreRows: [{ id, icon, label, onClick(e, close), active,
 * tone, fill, title, ariaLabel, disabled, lock, danger, wideOnly, narrowOnly,
 * keepOpen }]. `keepOpen` leaves the menu open after the click (the reblog's
 * first tap only arms it); the handler gets `close` to shut it itself.
 */
export default function WatchDock({ tiles, moreTiles = [], moreRows = [], wide, className }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const close = () => setOpen(false);

  // Popover: a click outside or Esc closes it. The sheet brings its own.
  useEffect(() => {
    if (!open || !wide) return undefined;
    const onDown = (e) => { if (!wrapRef.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, wide]);

  const visible = (item) => item && !(wide ? item.narrowOnly : item.wideOnly);
  const extraTiles = moreTiles.filter(visible);
  const extraRows = moreRows.filter(visible);
  const hasMore = extraTiles.length + extraRows.length > 0;

  const runMenu = (item) => (e) => {
    if (!item.keepOpen) close();
    item.onClick?.(e, close);
  };

  const menu = (
    <div className="wv2-more">
      {extraTiles.length > 0 && (
        <div className="wv2-more__grid">
          {extraTiles.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              className={cx('wv2-more__tile', item.active && `is-on is-${item.tone || 'accent'}`)}
              {...actionProps(item, runMenu(item))}
            >
              <Icon name={item.icon} size={24} fill={!!item.active} />
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      )}
      {extraRows.length > 0 && (
        <div className="wv2-more__rows">
          {extraRows.map((item) => (
            <MenuRow key={item.id} icon={item.icon} danger={item.danger} on={item.active} {...actionProps(item, runMenu(item))}>
              {item.label}
            </MenuRow>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className={cx('wv2-dock', className)} ref={wrapRef}>
      <div className="wv2-dock__tiles">
        {tiles.filter(visible).map((item) => (
          <DockTile
            key={item.id}
            icon={item.icon}
            label={item.label}
            active={item.active}
            tone={item.tone}
            fill={item.fill}
            className={cx(`wv2-dock__${item.id}`)}
            {...actionProps(item, (e) => item.onClick?.(e, close))}
          />
        ))}
        {hasMore && (
          <DockTile
            icon="more_horiz"
            label={t('spotlight.icons.plus')}
            active={open}
            tone="cyan"
            fill={false}
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          />
        )}
      </div>
      {open && wide && (
        <div className="v2-menu wv2-dock__menu" role="menu">{menu}</div>
      )}
      {!wide && (
        <Dialog open={open} onClose={close} title={t('spotlight.icons.plus')} closeLabel={t('common.actions.close')} className="wv2-more-sheet">
          {menu}
        </Dialog>
      )}
    </div>
  );
}
