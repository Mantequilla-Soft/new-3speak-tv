import React, { useEffect, useRef, useState } from 'react';
import { getHiveClient } from '../../utils/hiveNode';
import TimeAgo from '../TimeAgo/TimeAgo';
import { useAppStore } from '../../lib/store';
import GroupSort, { sortBy } from '../Groups/GroupSort';
import SkeletonLoader from './SkeletonLoader';
import './CommunitiesRender.scss';
import { Link } from 'react-router-dom';
import { FEED_URL, CHECKER_URL } from '../../utils/config';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import AccountImg from '../HiveAvatar/AccountImg';
import { useTranslation } from 'react-i18next';
import { formatNumber } from '../../i18n';
import { toastIn } from '../../utils/toast';
import { Button, EmptyState } from '../v2/ui';
import { Icon } from '../v2/Icon';
import { cx } from '../v2/helpers';
import useJoinedCommunities from '../Groups/useJoinedCommunities';
import { canSubscribe, setCommunitySubscription } from './communitySubscribe';

// Every toast from this module is headed "Community"; see utils/toast.js.
const toast = toastIn('Community');

// The banner strip on top of each card (19d). Bridge's community list carries
// no cover image, so each card gets one of four colours, drawn as a 135deg
// fade to the frame colour and picked from the name so a community keeps its
// colour between visits. The Join button wears the same colour.
const BANNER_TONES = ['cyan', 'accent', 'ink', 'muted'];

// Topic chips after the sorts (19d). Hive communities carry no topic, so a
// topic narrows the loaded list to the ones whose title or description talks
// about it. [tags.labels key, words that count]
const TOPICS = [
  ['nature', ['nature', 'wildlife', 'animal', 'outdoor', 'garden', 'plant', 'bird', 'hiking', 'photograph']],
  ['gaming', ['gam', 'esport', 'splinterlands', 'play']],
  ['technology', ['tech', 'programming', 'code', 'coding', 'developer', 'software', 'linux', 'science']],
  ['food', ['food', 'cook', 'recipe', 'kitchen', 'eat', 'vegan', 'bak']],
  ['music', ['music', 'song', 'band', 'dj', 'beat', 'audio', 'podcast', 'sound']],
  ['cryptocurrency', ['crypto', 'bitcoin', 'btc', 'finance', 'defi', 'token', 'trading', 'invest', 'leo']],
];
const aboutTopic = (c, words) => {
  const hay = `${c?.title || ''} ${c?.name || ''} ${c?.about || ''}`.toLowerCase();
  return words.some((w) => new RegExp(`\\b${w}`).test(hay));
};
const toneOf = (name = '') => BANNER_TONES[[...name].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7) % BANNER_TONES.length];

const client = getHiveClient();

// Per community: videos posted today / this week / in 30 days on 3Speak, and the
// newest few (different creators first). One cached checker call for the whole
// directory, not one per card.
const fetchActivity = async () => {
  const { data } = await axios.get(`${FEED_URL}/feeds/communities/activity`);
  return data?.communities || {};
};

// Details for communities the directory did not load, a few at a time so a
// long list does not open dozens of RPC calls at once.
async function fetchCommunities(names) {
  const out = [];
  for (let i = 0; i < names.length; i += 8) {
    const batch = await Promise.all(names.slice(i, i + 8).map((name) =>
      client.call('bridge', 'get_community', { name, observer: '' }).catch(() => null)));
    out.push(...batch.filter((c) => c && c.name));
  }
  return out;
}

// Every typed word must appear in the title, hive-id or description (Hive's own
// search reads the description too), in any order, and a word may be half-typed
// ("gaming ph" finds "Gaming Photography").
const matchesQuery = (c, q) => {
  const hay = `${c?.title || ''} ${c?.name || ''} ${c?.about || ''}`.toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
};
const uniqByName = (list) => {
  const seen = new Set();
  return list.filter((c) => c?.name && !seen.has(c.name) && seen.add(c.name));
};

// `mine` / `setMine` come from the Groups page (useJoinedCommunities), which
// needs the count for its "Joined" tab. `joinedOnly` is that tab.
function CommunitiesRender({ mine: mineProp, setMine: setMineProp, joinedOnly = false }) {
  const { t } = useTranslation();
  const [data, setData] = useState([]); // All communities data
  const [filteredData, setFilteredData] = useState([]); // Filtered communities based on search
  const [loading, setLoading] = useState(true);
  // Subscribers first, largest first: the order a directory is most useful in
  // before anyone has told it otherwise.
  const [sortField, setSortField] = useState('subscribers');
  const [sortDir, setSortDir] = useState('desc');
  const authenticated = useAppStore((st) => st.authenticated);
  const incubationHandle = useAppStore((st) => st.incubationHandle);
  // The ones this person has already joined, so they sit at the top of a list
  // of several hundred instead of being hunted for.
  const [ownMine, setOwnMine] = useJoinedCommunities({ enabled: mineProp === undefined });
  const mine = mineProp ?? ownMine;
  const setMine = setMineProp ?? setOwnMine;
  const [joining, setJoining] = useState('');
  const { data: activity = {} } = useQuery({
    queryKey: ['communities-activity'],
    queryFn: fetchActivity,
    staleTime: 5 * 60_000,
  });

  const [searchQuery, setSearchQuery] = useState(''); // Search query state
  const [topic, setTopic] = useState('');

  // Fetch communities data
  const generate = async () => {
    setLoading(true);
    try {
      const res = await client.call('bridge', 'list_communities', {
        last: '',
        limit: 100,
        observer: ''
      });
      setData(res);
      setFilteredData(res); // Initialize filteredData with all data     
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };
  

  // Typing filters the loaded page IMMEDIATELY, so the list reacts to every
  // keystroke, and then asks Hive.
  // What Hive answered for the last search, kept so narrowing that search while
  // typing filters it instantly instead of emptying the list until Hive answers.
  const [searchPool, setSearchPool] = useState([]);

  const handleSearch = (e) => {
    const query = e.target.value.toLowerCase();
    setSearchQuery(query);
    setFilteredData(uniqByName([...data, ...searchPool]).filter((c) => matchesQuery(c, query)));
  };

  // ...because the loaded page is only the 100 biggest communities, and the
  // answer is very often not in it. Searching "aliento" found nothing at all,
  // not because the filter was too strict but because @hive-110011 was never
  // fetched: it sits below a cut-off of roughly 3,000 subscribers.
  //
  // bridge.list_communities takes a `query`, so the search runs against every
  // community that exists rather than against the page we happen to hold.
  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) { setFilteredData(data); return undefined; }

    let alive = true;
    // Debounced: this is a network call per keystroke otherwise.
    //
    // Hive matches WHOLE words only: "gaming photo" finds Gaming Photography,
    // "gaming ph" finds nothing. Its answer used to REPLACE the list, so the
    // right community flashed up from the local filter and then vanished. Now
    // an empty answer to a multi-word search is retried without the half-typed
    // last word, and whatever comes back is merged with the local matches and
    // narrowed by every typed word here.
    //
    // The checker's /communities/search is the first choice: it holds every
    // community and matches substrings, so "gamin" finds what "gaming" finds.
    // The Hive path below is the fallback when the checker cannot answer.
    const ask = (query) => client.call('bridge', 'list_communities', { last: '', limit: 100, query, observer: '' })
      .then((res) => (Array.isArray(res) ? res : []));
    const timer = setTimeout(async () => {
      try {
        const { data: found } = await axios.get(`${CHECKER_URL}/communities/search`, { params: { q } });
        if (!alive) return;
        const res = Array.isArray(found?.communities) ? found.communities : [];
        setSearchPool(res);
        setFilteredData(uniqByName([...res, ...data.filter((c) => matchesQuery(c, q))]));
        return;
      } catch { /* checker unavailable: ask Hive instead */ }
      try {
        let res = await ask(q);
        // Hive answered the full query: its matches stand as they are. Only a
        // retry (asked WITHOUT the last word) needs narrowing by it here.
        let exact = true;
        const words = q.split(/\s+/).filter(Boolean);
        if (!res.length && words.length > 1) {
          res = await ask(words.slice(0, -1).join(' '));
          exact = false;
        }
        if (!alive) return;
        setSearchPool(res);
        const fromHive = exact ? res : res.filter((c) => matchesQuery(c, q));
        setFilteredData(uniqByName([...data.filter((c) => matchesQuery(c, q)), ...fromHive]));
      } catch { /* the local filter above is still showing something */ }
    }, 300);

    return () => { alive = false; clearTimeout(timer); };
    // `data` is deliberately not a dependency: it changes once on load, and
    // including it would re-run the search for no reason.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery]);

  // The directory loads Hive's 100 BIGGEST communities, but about half of the
  // communities people actually post 3Speak videos in are smaller than that and
  // never appeared. Once both lists are in, the active ones that are missing are
  // fetched and added, so the directory shows where the videos are.
  // A ref, not state: flipping state re-ran this effect, whose cleanup then
  // marked the fetch still in flight as stale and dropped its answer.
  const addedActive = useRef(false);
  useEffect(() => {
    if (addedActive.current || loading || !data.length || !Object.keys(activity).length) return undefined;
    addedActive.current = true;
    const have = new Set(data.map((c) => c.name));
    const missing = Object.keys(activity).filter((id) => !have.has(id));
    if (!missing.length) return undefined;
    // No cancel-on-cleanup: the ref above makes this run once, so a cleanup
    // (React's dev double-mount, or `data` changing) would drop the only fetch.
    fetchCommunities(missing).then((extra) => {
      if (!extra.length) return;
      const next = [...data, ...extra.filter((c) => !have.has(c.name))];
      setData(next);
      // Only while not searching: a search result list is Hive's answer to
      // the query and should stay exactly that.
      setFilteredData((prev) => (searchQuery.trim() ? prev : next));
    });
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activity, data, loading]);

  useEffect(() => {
    // The tab title comes from RouteTitle like every other page. Setting
    // document.title here used to override it, which is why this page alone kept
    // an older brand line and the 'Communities' entry in the route table was dead.
    generate();
  }, []);
  // Joined communities the directory did not load (small ones, below the top
  // 100) are fetched for the Joined tab, so it lists every one of them.
  const addedJoined = useRef('');
  useEffect(() => {
    if (!joinedOnly || loading || !mine.size) return;
    const have = new Set(data.map((c) => c.name));
    const missing = [...mine].filter((id) => !have.has(id));
    const key = missing.sort().join(',');
    if (!missing.length || addedJoined.current === key) return;
    addedJoined.current = key;
    fetchCommunities(missing).then((extra) => {
      if (!extra.length) return;
      setData((prev) => {
        const seen = new Set(prev.map((c) => c.name));
        const next = [...prev, ...extra.filter((c) => !seen.has(c.name))];
        setFilteredData((cur) => (searchQuery.trim() ? cur : next));
        return next;
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joinedOnly, loading, mine, data.length]);

  // Join from the card (19d). Joined cards show a pill rather than a button:
  // leaving a community is a decision for its own page, not a stray tap here.
  const handleJoin = async (community) => {
    if (joining) return;
    if (!canSubscribe({ authenticated, incubationHandle })) {
      toast.error(t('communities.page.loginToSubscribe'));
      return;
    }
    const label = community.title || community.name;
    setJoining(community.name);
    try {
      await setCommunitySubscription({
        id: community.name,
        next: true,
        incubationHandle,
        prompt: t('communities.page.subscribeTo', { label }),
      });
      setMine((prev) => new Set([...prev, community.name]));
      toast.success(t('communities.page.subscribedTo', { label }));
    } catch (err) {
      toast.error(t('communities.page.subscriptionFailed', { error: err?.message || t('communities.page.unknownError') }));
    } finally {
      setJoining('');
    }
  };

  // What the list can be ordered by. Every one of these comes straight from
  // bridge.list_communities, so nothing extra is fetched to offer them.
  // "Videos this week" is the one sort that is not from bridge: it comes from
  // the activity call above, and is how busy the community is ON 3SPEAK.
  const SORTS = [
    { id: 'subscribers', label: t('communities.directory.sorts.subscribers'), value: (c) => c.subscribers },
    { id: 'active', label: t('communities.directory.sorts.active'), value: (c) => activity[c.name]?.week ?? 0 },
    { id: 'authors', label: t('communities.directory.sorts.authors'), value: (c) => c.num_authors },
    { id: 'pending', label: t('communities.directory.sorts.pending'), value: (c) => c.sum_pending },
    { id: 'posts', label: t('communities.directory.sorts.posts'), value: (c) => c.num_pending },
    { id: 'created', label: t('communities.directory.sorts.created'), value: (c) => (c.created_at ? Date.parse(c.created_at) : null) },
    { id: 'title', label: t('communities.directory.sorts.name'), value: (c) => c.title, text: true },
  ];


  const sorted = sortBy(filteredData || [], SORTS, sortField, sortDir, { ids: mine, idOf: (c) => c.name });
  const topicWords = TOPICS.find(([id]) => id === topic)?.[1];
  const shown = sorted
    .filter((c) => !joinedOnly || mine.has(c.name))
    .filter((c) => !topicWords || aboutTopic(c, topicWords));

  // The second figure on a card follows the sort, so the number the list is
  // ordered by is the one you can read; posts this week otherwise (19d).
  const secondFigure = (c) => {
    const a = activity[c.name];
    switch (sortField) {
      case 'active': return a ? t('communities.directory.videosWeek', { count: a.week || 0, n: formatNumber(a.week || 0) }) : null;
      case 'authors': return typeof c.num_authors === 'number' ? t('communities.directory.authors', { count: c.num_authors, n: formatNumber(c.num_authors) }) : null;
      case 'pending': return c.sum_pending > 0 ? <span className="money">{t('communities.directory.pending', { amount: formatNumber(Math.round(c.sum_pending)) })}</span> : null;
      case 'created': return c.created_at ? <TimeAgo date={c.created_at} short /> : null;
      default: return typeof c.num_pending === 'number' ? t('communities.page.postsWeek', { count: c.num_pending, n: formatNumber(c.num_pending) }) : null;
    }
  };

  return (
    <>
    <div className="communities-render">
      {/* 19d: the sorts, a divider, the topics; the search at the end. */}
      <div className="groups-filters">
        <GroupSort
          options={SORTS}
          field={sortField}
          direction={sortDir}
          onFieldChange={setSortField}
          onDirectionChange={setSortDir}
        />
        <span className="groups-filters__sep" aria-hidden="true" />
        <div className="groups-topics" role="group" aria-label={t('communities.directory.topics')}>
          {TOPICS.map(([id]) => (
            <button
              key={id}
              type="button"
              className={cx('groups-topic', topic === id && 'is-on')}
              aria-pressed={topic === id}
              onClick={() => setTopic((cur) => (cur === id ? '' : id))}
            >
              {t(`tags.labels.${id}`)}
            </button>
          ))}
        </div>
        <label className="groups-search">
          <Icon name="search" size={18} />
          <input
            type="text"
            placeholder={t('communities.directory.searchPlaceholder')}
            aria-label={t('communities.directory.searchPlaceholder')}
            value={searchQuery}
            onChange={handleSearch}
          />
        </label>
      </div>

      {loading ? (
        <SkeletonLoader />
      ) : shown.length === 0 ? (
        <EmptyState icon={joinedOnly ? 'group' : 'search_off'} title={joinedOnly ? t('common.status.empty') : t('communities.picker.noneFound')} />
      ) : (
        <div className="groups-grid">
          {shown.map((community, index) => {
            const joined = mine.has(community.name);
            const a = activity[community.name];
            return (
              <article key={community.name || index} className={`group-card tone-${toneOf(community.name)}`}>
                <div className="group-card__banner" aria-hidden="true" />
                <div className="group-card__body">
                  {/* bridge.list_communities carries no picture, so this
                      resolves the account's real one and serves it through our
                      /img/ cache (see AccountImg). */}
                  <AccountImg
                    account={community.name}
                    alt=""
                    className="group-card__pic"
                    loading="lazy"
                  />
                  <h3 className="group-card__name">
                    {/* The title is the card's link; it stretches over the whole
                        card, while the thumbnails and the Join button stay
                        their own targets above it. */}
                    <Link className="group-card__link" to={`/community/${community.name}`}>{community.title}</Link>
                  </h3>
                  {community.about && <p className="group-card__about">{community.about}</p>}
                  <div className="group-card__foot">
                    {/* Each number is dropped rather than shown as zero when
                        the API omits it: "0 authors" and "we were not told"
                        are different statements. */}
                    <span className="group-card__meta">
                      {typeof community.subscribers === 'number' && (
                        <span>{t('communities.directory.subscribers', { count: community.subscribers, n: formatNumber(community.subscribers) })}</span>
                      )}
                      {secondFigure(community) ? <span>{secondFigure(community)}</span> : null}
                    </span>
                    {joined ? (
                      // Leaving a community is a decision for its own page,
                      // not a stray tap here, so this is a label, not a button.
                      <span className="group-card__joined blog-mine">{t('communities.directory.joined')}</span>
                    ) : (
                      <Button
                        variant="cyan"
                        size={36}
                        className="group-card__join"
                        loading={joining === community.name}
                        disabled={!!joining}
                        onClick={() => handleJoin(community)}
                      >
                        {t('communities.directory.join')}
                      </Button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
    </>
  );
}

export default CommunitiesRender;
