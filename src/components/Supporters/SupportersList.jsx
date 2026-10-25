import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { MdGraphicEq, MdRedeem, MdVolunteerActivism, MdVisibilityOff, MdVisibility } from 'react-icons/md';
import AccountImg from '../HiveAvatar/AccountImg';
import TimeAgo from '../TimeAgo/TimeAgo';
import BarLoader from '../Loader/BarLoader';
import { fixVideoThumbnail } from '../../utils/fixThumbnails';
import { fetchSupports, fetchSupportsGiven, supportItemLink, formatHbd, formatHbdCompact } from '../../lib/supports';
import { setSupportHidden } from '../../lib/supportsHide';
import { toastIn } from '../../utils/toast';
import './Supporters.scss';

// Every toast from this module is headed "Supporters". See utils/toast.js.
const toast = toastIn('Supporters');

const PAGE_SIZE = 20;

// The tipper's memo as a plain React text node (never markdown or HTML: it is
// whatever anyone typed into a transfer). Clamped to two lines; tap for all.
function TipMemo({ text }) {
  const [open, setOpen] = useState(false);
  const toggle = () => setOpen((v) => !v);
  return (
    <p
      className={`sp-card-memo${open ? ' is-open' : ''}`}
      role="button"
      tabIndex={0}
      aria-expanded={open}
      onClick={toggle}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } }}
    >
      {text}
    </p>
  );
}

// One direction's tips, paged. Received = tips TO `user`, given = tips FROM them.
// `withHidden`: also list the tips `user` hid (their own Received tab only).
function useSupportsList(user, dir, withHidden = false) {
  return useInfiniteQuery({
    queryKey: [dir === 'given' ? 'supports-given' : 'supports', user, withHidden ? 'with-hidden' : 'visible'],
    queryFn: ({ pageParam = 1 }) => (dir === 'given'
      ? fetchSupportsGiven(user, pageParam, PAGE_SIZE)
      : fetchSupports(user, pageParam, PAGE_SIZE, { includeHidden: withHidden })),
    getNextPageParam: (last) => (last && last.page * last.limit < last.total ? last.page + 1 : undefined),
    initialPageParam: 1,
    enabled: !!user,
    staleTime: 2 * 60 * 1000,
    refetchOnMount: 'always', // same reason as useSupporters()
  });
}

// Hide / unhide one tip on your own Received tab. Signed as the creator
// (lib/supportsHide.js); everything that counts tips is refetched after.
function HideTipButton({ item }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const hidden = item.hidden === true;
  const onClick = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await setSupportHidden({ author: item.author, trxId: item.trx_id, hidden: !hidden });
      toast.success(hidden ? t('profile.supports.unhiddenToast') : t('profile.supports.hiddenToast'));
      for (const key of [['supports', item.author], ['supporters', item.author], ['supports-given', item.tipper], ['supported', item.tipper]]) {
        queryClient.invalidateQueries({ queryKey: key });
      }
    } catch (err) {
      toast.error(err?.message || t('profile.supports.hideFailed'));
    } finally {
      setBusy(false);
    }
  };
  const label = hidden ? t('profile.supports.unhideTip') : t('profile.supports.hideTip');
  const Icon = hidden ? MdVisibility : MdVisibilityOff;
  return (
    <button type="button" className="sp-card-hide" onClick={onClick} disabled={busy} title={label}>
      <Icon aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}

// One tip as a card. `person` is the other side: the tipper on Received, the
// creator who got it on Given. `canHide`: your own Received tab.
function SupportCard({ item, person, canHide }) {
  const { t } = useTranslation();
  const link = supportItemLink(item);
  const isAudio = item.kind === 'audio';
  const thumb = !isAudio && item.video?.thumbnail ? fixVideoThumbnail({ thumbnail: item.video.thumbnail }) : null;
  const title = item.video?.title || t('profile.supports.untitled');
  return (
    <article className={`sp-card${item.hidden ? ' is-hidden' : ''}`}>
      <Link to={link} className="sp-card-thumb" aria-label={title}>
        {thumb ? <img src={thumb} alt="" loading="lazy" /> : <MdGraphicEq className="sp-card-thumb-icon" />}
      </Link>
      <div className="sp-card-body">
        <Link to={link} className="sp-card-title" title={title}>{title}</Link>
        <div className="sp-card-meta">
          <Link to={`/@${person}`} className="sp-card-tipper">
            <AccountImg account={person} alt="" loading="lazy" />
            <span>@{person}</span>
          </Link>
          <span className="sp-card-time"><TimeAgo date={item.tippedAt || item.createdAt} /></span>
        </div>
        <div className="sp-card-amount">
          <span className="sp-pill">{formatHbd(item.hbd_value)}</span>
          {item.currency === 'HIVE' && (
            <span className="sp-card-paid">{t('profile.supports.paidInHive', { amount: Number(item.amount).toFixed(3) })}</span>
          )}
        </div>
        {typeof item.memo === 'string' && item.memo.trim() && <TipMemo text={item.memo} />}
        {(item.hidden || canHide) && (
          <div className="sp-card-foot">
            {item.hidden && <span className="sp-card-hidden-label">{t('profile.supports.hiddenLabel')}</span>}
            {canHide && <HideTipButton item={item} />}
          </div>
        )}
      </div>
    </article>
  );
}

/**
 * The profile's Supporters tab, in two sub-tabs: Received (tips this profile
 * got on its videos) and Given (tips it sent to other
 * creators), newest first. Each header carries its total. The sub-tab lives in
 * the URL (`?tab=supports&dir=given`); with none set, Received when it has any
 * tips, else Given.
 */
export default function SupportersList({ user, isOwnProfile }) {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const received = useSupportsList(user, 'received', !!isOwnProfile);
  const given = useSupportsList(user, 'given');

  const firstPage = (q) => q.data?.pages?.[0];
  const receivedTotal = firstPage(received)?.total || 0;
  const givenTotal = firstPage(given)?.total || 0;

  const urlDir = searchParams.get('dir');
  const bothLoaded = !received.isLoading && !given.isLoading;
  const dir = urlDir === 'given' || urlDir === 'received'
    ? urlDir
    : (bothLoaded && !receivedTotal && givenTotal ? 'given' : 'received');

  // Write the chosen sub-tab into the URL, keeping the rest (`tab` and friends).
  const selectDir = (next) => {
    const params = new URLSearchParams(searchParams);
    params.set('dir', next);
    setSearchParams(params, { replace: true });
  };

  // A profile whose only tips are given lands on Given; put that in the URL too,
  // so back-navigation returns to the same sub-tab.
  useEffect(() => {
    if (!urlDir && bothLoaded && !receivedTotal && givenTotal) selectDir('given');
  }, [urlDir, bothLoaded, receivedTotal, givenTotal]); // eslint-disable-line react-hooks/exhaustive-deps

  const active = dir === 'given' ? given : received;
  const subTab = (key, Icon, label, page) => (
    <button
      type="button"
      role="tab"
      aria-selected={dir === key}
      className={`sp-subtab${dir === key ? ' active' : ''}`}
      onClick={() => selectDir(key)}
    >
      <Icon className="sp-subtab-icon" aria-hidden="true" />
      {page
        ? t('profile.supports.subTabTotal', { label, amount: formatHbdCompact(page.total_hbd) })
        : label}
    </button>
  );

  const items = (active.data?.pages || []).flatMap((p) => p?.items || []);
  let body;
  if (active.isLoading) {
    body = <BarLoader />;
  } else if (active.isError) {
    body = (
      <div className="sp-list-empty">
        <p>{t('common.status.error')}</p>
        <button type="button" className="sp-list-more" onClick={() => active.refetch()}>{t('common.actions.retry')}</button>
      </div>
    );
  } else if (!items.length) {
    const key = dir === 'given'
      ? (isOwnProfile ? 'profile.supports.emptyGivenOwn' : 'profile.supports.emptyGiven')
      : (isOwnProfile ? 'profile.supports.emptyReceivedOwn' : 'profile.supports.emptyReceived');
    body = <div className="sp-list-empty"><p>{t(key, { user })}</p></div>;
  } else {
    body = (
      <>
        <div className="sp-grid">
          {items.map((item) => (
            <SupportCard
              key={item.trx_id}
              item={item}
              person={dir === 'given' ? item.author : item.tipper}
              canHide={!!isOwnProfile && dir === 'received'}
            />
          ))}
        </div>
        {active.hasNextPage && (
          <button type="button" className="sp-list-more" onClick={() => active.fetchNextPage()} disabled={active.isFetchingNextPage}>
            {active.isFetchingNextPage ? t('common.status.loading') : t('common.actions.loadMore')}
          </button>
        )}
      </>
    );
  }

  return (
    <div className="sp-list">
      <div className="sp-subtabs" role="tablist">
        {subTab('received', MdRedeem, t('profile.supports.received'), firstPage(received))}
        {subTab('given', MdVolunteerActivism, t('profile.supports.given'), firstPage(given))}
      </div>
      {body}
    </div>
  );
}
