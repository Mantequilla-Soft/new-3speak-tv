import { Suspense } from 'react';
import lazyRoute from '../utils/lazyRoute';
import { useSearchParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../lib/store';
import { Segmented } from '../components/v2/ui';
import useJoinedCommunities from '../components/Groups/useJoinedCommunities';
import './Groups.scss';

// lazyRoute, not lazy: reloads once onto a new build after a deploy (see lazyRoute.js).
const CommunitiesRender = lazyRoute(() => import('../components/Communities/CommunitiesRender'), '../components/Communities/CommunitiesRender');
const BadgesRender = lazyRoute(() => import('../components/Badges/BadgesRender'), '../components/Badges/BadgesRender');

// Communities and badges are the same idea wearing different clothes: a marker
// that gathers people. A community is a group you join; a badge is one you are
// in by having earned it. They were two unrelated entries in a menu that no
// longer exists, so they live on one page now (design 19d).
//
// "Joined" is the communities list narrowed to the ones you are in, offered
// only to someone who can join anything.
//
// Collectives will join these once they exist. Not listed until then: a tab
// that only announces itself is a dead end for anyone who clicks it.
const TABS = [
  { id: 'communities', labelKey: 'common.nav.communities' },
  { id: 'joined', labelKey: 'communities.directory.joined', member: true },
  { id: 'badges', labelKey: 'misc.groups.badges' },
];

export default function Groups() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const user = useAppStore((st) => st.user);
  const incubationHandle = useAppStore((st) => st.incubationHandle);
  const member = !!(user || incubationHandle);
  const tabs = TABS.filter((item) => !item.member || member);
  const requested = params.get('tab');
  const tab = tabs.some((item) => item.id === requested) ? requested : 'communities';
  // Read here rather than in the list, so the Joined tab can show its count
  // before it is opened, and both community tabs share one set.
  const [mine, setMine] = useJoinedCommunities();

  // In the URL rather than in state, so a tab can be linked to and so the old
  // /communities and /badges addresses can land on the right one.
  const select = (id) => {
    const next = new URLSearchParams(params);
    if (id === 'communities') next.delete('tab');
    else next.set('tab', id);
    // replace: the tabs are one page, not entries in the back button.
    setParams(next, { replace: true });
  };

  return (
    <div className="groups-page">
      <Helmet>
        <title>{`3S | ${t('misc.groups.title')}`}</title>
      </Helmet>

      <header className="groups-head">
        <div className="groups-head-text">
          <h1>{t('misc.groups.title')}</h1>
          <p>{t('misc.groups.subtitle')}</p>
        </div>
        <Segmented
          className="groups-tabs"
          label={t('misc.groups.title')}
          options={tabs.map((item) => ({
            value: item.id,
            label: t(item.labelKey),
            count: item.id === 'joined' && mine.size ? mine.size : undefined,
          }))}
          value={tab}
          onChange={select}
          size={36}
          block={false}
          scroll
        />
      </header>

      {/* Only the open tab is mounted: each list fetches on mount, and there
          is no reason to pay for a list nobody is looking at. */}
      <Suspense fallback={null}>
        {(tab === 'communities' || tab === 'joined') && (
          <CommunitiesRender mine={mine} setMine={setMine} joinedOnly={tab === 'joined'} />
        )}
        {tab === 'badges' && <BadgesRender />}
      </Suspense>
    </div>
  );
}
