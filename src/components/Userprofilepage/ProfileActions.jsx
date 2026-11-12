import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Dialog, DockTile, EmptyState, Menu, MenuRow, Segmented } from '../v2/ui';
import Card3 from '../Cards/Card3';
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
// `shortLabel` replaces the label on the narrowest phones (≤380px, owner
// 2026-11-12: Message reads "DM" there); the accessible name stays the label.
export function ProfileTile({ icon, label, shortLabel, as: El, className, ...rest }) {
  const shown = shortLabel
    ? <><span className="ph-tile__long">{label}</span><span className="ph-tile__short">{shortLabel}</span></>
    : label;
  const content = (
    <>
      <Icon name={icon} size={24} />
      <span>{shown}</span>
    </>
  );
  if (El) {
    return <El className={cx('v2-dock ph-tile', className)} aria-label={label} {...rest}>{content}</El>;
  }
  return <DockTile className={cx('ph-tile', className)} icon={<Icon name={icon} size={24} />} label={shown} aria-label={label} {...rest} />;
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
 * The profile tabs as one segmented track that scrolls sideways (20b, 37a),
 * with "Search this channel" at the end of the row. `tabs` are { value, label }.
 * The boards draw the tabs without counts or icons, so none are shown.
 */
export function ProfileTabs({ tabs, value, onChange, label, search }) {
  const ref = useRef(null);
  // A deep link can land on a late tab: bring the selected one into view.
  useEffect(() => {
    const el = ref.current?.querySelector('[aria-selected="true"]');
    el?.scrollIntoView?.({ inline: 'nearest', block: 'nearest', behavior: 'smooth' });
  }, [value]);
  return (
    <div className="ph-tabs" ref={ref}>
      <Segmented
        options={tabs.map(({ value: v, label: l, disabled }) => ({ value: v, label: l, disabled }))}
        value={value}
        onChange={onChange}
        block={false}
        scroll
        size={36}
        label={label}
        className="ph-tabs__track"
      />
      {search}
    </div>
  );
}

/**
 * "Search this channel" (20b): a 40px field at the right of the tab row. It
 * filters what the page has already loaded; the results replace the tab's
 * content while there is a query (ProfileSearchResults).
 */
export function ProfileSearch({ value, onChange }) {
  const { t } = useTranslation();
  const label = t('profile.search.placeholder');
  return (
    <div className="ph-search" role="search">
      <Icon name="search" size={20} />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape' && value) { e.preventDefault(); onChange(''); } }}
        placeholder={label}
        aria-label={label}
        enterKeyHint="search"
      />
      {value ? (
        <button type="button" className="ph-search__clear" onClick={() => onChange('')} aria-label={t('profile.search.clear')} title={t('profile.search.clear')}>
          <Icon name="close" size={16} />
        </button>
      ) : null}
    </div>
  );
}

const fold = (s) => String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const searchText = (v) => fold([
  v.title,
  Array.isArray(v.tags) ? v.tags.join(' ') : v.tags,
  v.category,
].filter(Boolean).join(' '));

/** Loaded videos and Shorts whose title or tags hold every word of `query`. */
export function matchChannel(list, query) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return list.filter((v) => {
    const hay = searchText(v);
    return words.every((w) => hay.includes(w));
  });
}

/**
 * What "Search this channel" found among the uploads the page holds. Older
 * uploads are one click away while the list has more pages.
 */
export function ProfileSearchResults({
  query, videos = [], shorts = [], hasMore = false, loadingMore = false, onMore,
  getContentForVideo, isWatched, getViewCount, username,
}) {
  const { t } = useTranslation();
  const foundVideos = useMemo(() => matchChannel(videos, query), [videos, query]);
  const foundShorts = useMemo(() => matchChannel(shorts, query), [shorts, query]);
  const total = foundVideos.length + foundShorts.length;
  return (
    <section className="ph-results" aria-live="polite">
      <div className="ph-results__head">
        <h3>{t('profile.search.results', { count: total, query: query.trim() })}</h3>
        {hasMore ? (
          <Button variant="secondary" size={32} icon="history" loading={loadingMore} onClick={onMore}>
            {t('profile.search.older')}
          </Button>
        ) : null}
      </div>
      {total === 0 ? (
        <EmptyState icon="search_off" title={t('profile.search.empty', { query: query.trim() })} />
      ) : null}
      {foundVideos.length ? (
        <Card3 videos={foundVideos} getContentForVideo={getContentForVideo} isWatched={isWatched} getViewCount={getViewCount} hideAuthor />
      ) : null}
      {foundShorts.length ? (
        <div className="ph-results__shorts">
          <Card3 videos={foundShorts} shortsGrid linkPrefix="/shorts" linkQuery={username ? `&user=${username}` : ''} getViewCount={getViewCount} />
        </div>
      ) : null}
    </section>
  );
}
