import { Suspense, lazy } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { useTranslation } from 'react-i18next';
import './Groups.scss';

const CommunitiesRender = lazy(() => import('../components/Communities/CommunitiesRender'));
const BadgesRender = lazy(() => import('../components/Badges/BadgesRender'));

// Communities and badges are the same idea wearing different clothes: a marker
// that gathers people. A community is a group you join; a badge is one you are
// in by having earned it. They were two unrelated entries in a menu that no
// longer exists, so they live on one page now.
//
// Collectives will join these once they exist. Not listed until then: a tab
// that only announces itself is a dead end for anyone who clicks it.
const TABS = [
  { id: 'communities', labelKey: 'common.nav.communities' },
  { id: 'badges', labelKey: 'misc.groups.badges' },
];

export default function Groups() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab');
  const tab = TABS.some((item) => item.id === requested) ? requested : 'communities';

  // In the URL rather than in state, so a tab can be linked to and so the old
  // /communities and /badges addresses can land on the right one.
  const select = (id) => {
    const next = new URLSearchParams(params);
    if (id === 'communities') next.delete('tab');
    else next.set('tab', id);
    // replace: the tabs are one page, not four entries in the back button.
    setParams(next, { replace: true });
  };

  return (
    <div className="groups-page">
      <Helmet>
        <title>{`3S | ${t('misc.groups.title')}`}</title>
      </Helmet>

      <header className="groups-head">
        <h1>{t('misc.groups.title')}</h1>
        <p>{t('misc.groups.subtitle')}</p>
      </header>

      <div className="groups-tabs" role="tablist" aria-label={t('misc.groups.title')}>
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={`groups-tab${tab === item.id ? ' is-active' : ''}`}
            onClick={() => select(item.id)}
          >
            {t(item.labelKey)}
          </button>
        ))}
      </div>

      {/* Only the open tab is mounted: both of these fetch on mount, and there
          is no reason to pay for a list nobody is looking at. */}
      <Suspense fallback={null}>
        {tab === 'communities' && <CommunitiesRender />}
        {tab === 'badges' && <BadgesRender />}
      </Suspense>
    </div>
  );
}
