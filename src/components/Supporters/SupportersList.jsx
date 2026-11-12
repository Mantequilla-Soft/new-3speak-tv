import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Icon } from '../v2/Icon';
import { Button, IconButton, Segmented } from '../v2/ui';
import AccountImg from '../HiveAvatar/AccountImg';
import TimeAgo from '../TimeAgo/TimeAgo';
import BarLoader from '../Loader/BarLoader';
import { fetchSupports, fetchSupportsGiven, supportItemLink, formatHbd, formatSats, formatSupportTotal, useSupported } from '../../lib/supports';
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
  // 37a: an eye on the row; the label is its name and tooltip.
  return (
    <IconButton
      icon={hidden ? 'visibility' : 'visibility_off'}
      label={label}
      variant="ghost"
      size={36}
      round
      className="sp-card-hide"
      onClick={onClick}
      disabled={busy}
    />
  );
}

// One tip as a row (37a): the other side's squircle avatar, their name, the
// video and when, the amount in accent mono, and the owner's eye. `person` is
// the tipper on Received, the creator who got it on Given. `canHide`: your
// own Received tab.
function SupportCard({ item, person, canHide }) {
  const { t } = useTranslation();
  const link = supportItemLink(item);
  const title = item.video?.title || t('profile.supports.untitled');
  return (
    <article className={`sp-card${item.hidden ? ' is-hidden' : ''}`}>
      {person ? (
        <Link to={`/@${person}`} className="sp-card-av" aria-hidden="true" tabIndex={-1}>
          <AccountImg account={person} alt="" loading="lazy" />
        </Link>
      ) : (
        // A Lightning tip whose payer can't be told (not paid from Hive).
        <span className="sp-card-av sp-card-av--anon" aria-hidden="true"><Icon name="bolt" size={18} fill /></span>
      )}
      <div className="sp-card-body">
        {person ? (
          <Link to={`/@${person}`} className="sp-card-name">@{person}</Link>
        ) : (
          <span className="sp-card-name">{t('profile.supports.lightningSupporter')}</span>
        )}
        <div className="sp-card-meta">
          {item.hidden ? (
            <span className="sp-card-hidden-label">{t('profile.supports.hiddenLabel')}</span>
          ) : (
            <Link to={link} className="sp-card-title" title={title}>{title}</Link>
          )}
          <span className="sp-card-time"><TimeAgo date={item.tippedAt || item.createdAt} /></span>
          {item.currency === 'HIVE' && (
            <span className="sp-card-paid">{t('profile.supports.paidInHive', { amount: Number(item.amount).toFixed(3) })}</span>
          )}
        </div>
        {typeof item.memo === 'string' && item.memo.trim() && <TipMemo text={item.memo} />}
      </div>
      <div className="sp-card-amount">
        {item.currency === 'SATS'
          ? <span className="sp-pill"><Icon name="bolt" size={14} fill />{formatSats(item.amount)}</span>
          : <span className="sp-pill">{formatHbd(item.hbd_value)}</span>}
      </div>
      {canHide && <HideTipButton item={item} />}
    </article>
  );
}

// "Who @user supports" (31e): the creators this profile tipped, each once,
// with a cyan ring, how often and how much. Above the list on both sub-tabs
// (owner 2026-11-12: it stays when Received is picked).
function SupportsSummary({ user }) {
  const { t } = useTranslation();
  const { data } = useSupported(user);
  const list = data?.supported || [];
  if (!list.length) return null;
  return (
    <section className="sp-who v2-card">
      <div className="sp-who-head">
        <h3>{t('profile.supports.whoTitle', { user })}</h3>
        <span className="sp-who-count">{data?.total ?? list.length}</span>
      </div>
      <div className="sp-who-grid">
        {list.map((s, i) => (
          <Link key={s.author} to={`/@${s.author}`} className="sp-who-row">
            <span className={`sp-who-av ${i % 2 ? 'is-cyan' : 'is-accent'}`}><AccountImg account={s.author} alt="" loading="lazy" /></span>
            <span className="sp-who-text">
              <b>@{s.author}</b>
              <span>{t('profile.supports.tipped', { count: s.count || 1 })} · {formatSupportTotal(s.hbd_total, s.sats_total)}</span>
            </span>
          </Link>
        ))}
      </div>
    </section>
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
  const subLabel = (label, page) => (page
    ? t('profile.supports.subTabTotal', { label, amount: formatSupportTotal(page.total_hbd, page.total_sats) })
    : label);

  const items = (active.data?.pages || []).flatMap((p) => p?.items || []);
  let body;
  if (active.isLoading) {
    body = <BarLoader />;
  } else if (active.isError) {
    body = (
      <div className="sp-list-empty">
        <p>{t('common.status.error')}</p>
        <Button variant="secondary" size={36} icon="refresh" className="sp-list-more" onClick={() => active.refetch()}>{t('common.actions.retry')}</Button>
      </div>
    );
  } else if (!items.length) {
    const key = dir === 'given'
      ? (isOwnProfile ? 'profile.supports.emptyGivenOwn' : 'profile.supports.emptyGiven')
      : (isOwnProfile ? 'profile.supports.emptyReceivedOwn' : 'profile.supports.emptyReceived');
    body = <div className="sp-list-empty"><Icon name="volunteer_activism" size={24} /><p>{t(key, { user })}</p></div>;
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
          <Button variant="secondary" className="sp-list-more" onClick={() => active.fetchNextPage()} disabled={active.isFetchingNextPage} loading={active.isFetchingNextPage} trailing="expand_more">
            {active.isFetchingNextPage ? t('common.status.loading') : t('common.actions.loadMore')}
          </Button>
        )}
      </>
    );
  }

  return (
    <div className="sp-list">
      <SupportsSummary user={user} />
      {/* 37a: one card, "Supporters" with Received / Given (each with its
          total) on the right, then a row per tip. */}
      <section className="sp-panel v2-card">
        <div className="sp-panel-head">
          <h3>{t('profile.tabs.supporters')}</h3>
          <Segmented
            block={false}
            scroll
            value={dir}
            onChange={selectDir}
            label={t('profile.tabs.supporters')}
            className="sp-subtabs"
            options={[
              { value: 'received', label: subLabel(t('profile.supports.received'), firstPage(received)) },
              { value: 'given', label: subLabel(t('profile.supports.given'), firstPage(given)) },
            ]}
          />
        </div>
        {body}
      </section>
    </div>
  );
}
