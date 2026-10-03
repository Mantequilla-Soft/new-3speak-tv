import React, { useEffect, useRef, useState } from 'react';
import { getHiveClient } from '../../utils/hiveNode';
import { Client } from '@hiveio/dhive';
import { MdAdd } from 'react-icons/md';
import TimeAgo from '../TimeAgo/TimeAgo';
import { getSubscriptions } from '../../hive-api/hiveApi';
import { useAppStore } from '../../lib/store';
import GroupSort, { sortBy } from '../Groups/GroupSort';
import SkeletonLoader from './SkeletonLoader';
import './CommunitiesRender.scss';
import { Link, useNavigate } from 'react-router-dom';
import CreateCommunity from '../modal/CreateCommunity';
import { HIVE_API_NODES, FEED_URL, CHECKER_URL } from '../../utils/config';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { useTranslation, Trans } from 'react-i18next';
import { formatNumber } from '../../i18n';
import { fixVideoThumbnail, fallbackImg } from '../../utils/fixThumbnails';

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

function CommunitiesRender() {
  const { t } = useTranslation();
  const [data, setData] = useState([]); // All communities data
  const [filteredData, setFilteredData] = useState([]); // Filtered communities based on search
  const [loading, setLoading] = useState(true);
  // Subscribers first, largest first: the order a directory is most useful in
  // before anyone has told it otherwise.
  const [sortField, setSortField] = useState('subscribers');
  const [sortDir, setSortDir] = useState('desc');
  const user = useAppStore((st) => st.user);
  const incubationHandle = useAppStore((st) => st.incubationHandle);
  // The ones this person has already joined, so they sit at the top of a list
  // of several hundred instead of being hunted for.
  const [mine, setMine] = useState(() => new Set());

  useEffect(() => {
    let alive = true;
    if (user) {
      getSubscriptions(user)
        // [[name, title, role, role_title], ...]
        .then((rows) => { if (alive) setMine(new Set((rows || []).map((r) => r[0]))); })
        .catch(() => { /* the list is still useful unsorted */ });
    } else if (incubationHandle) {
      // No Hive account: their subscriptions are the off-chain ones.
      import('../../lib/incubation')
        .then((m) => m.fetchMyIncubationSubscriptions())
        .then((d) => { if (alive) setMine(new Set((d.items || []).map((i) => i.community))); })
        .catch(() => { /* same */ });
    } else {
      setMine(new Set());
    }
    return () => { alive = false; };
  }, [user, incubationHandle]);
  const { data: activity = {} } = useQuery({
    queryKey: ['communities-activity'],
    queryFn: fetchActivity,
    staleTime: 5 * 60_000,
  });

  const [searchQuery, setSearchQuery] = useState(''); // Search query state
  const [openModal, setOpenModal] = useState(false)
  const navigate = useNavigate();

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
  const handleCardClick = (communityName) => {
    navigate(`/community/${communityName}`);
  };

  const toggleModal = ()=>{
    setOpenModal( (prev)=> !prev)
  }

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


  return (
    <>
    <div className="communities-render">
      {/* Says what a community IS. The tab label alone assumes you already
          know, and this list is mostly read by people who do not yet. */}
      <div className="communities-head">
        <p>
          <Trans i18nKey="communities.directory.intro" components={{ strong: <strong /> }} />
        </p>
      </div>

      {/* Search on the left, sort and the create button on the right: the two
          things you do TO the list, next to each other and away from the list
          itself. */}
      <div className="communities-bar">
        <div className="search-wrapper">
          <input
            type="text"
            placeholder={t('communities.directory.searchPlaceholder')}
            value={searchQuery}
            onChange={handleSearch}
          />
        </div>
        <div className="communities-bar-actions">
          <GroupSort
            options={SORTS}
            field={sortField}
            direction={sortDir}
            onFieldChange={setSortField}
            onDirectionChange={setSortDir}
          />
          {/* Creating one is an account_create paid from a Hive account with an
              active key. An incubating user has neither, so the button says so
              rather than failing at the last step of a five-step modal. */}
          <button
            type="button"
            className={`group-create-btn${incubationHandle ? ' is-locked' : ''}`}
            onClick={incubationHandle ? undefined : toggleModal}
            aria-disabled={incubationHandle ? true : undefined}
            title={incubationHandle
              ? t('communities.directory.createLocked')
              : undefined}
          >
            <MdAdd size={17} /> {t('communities.directory.create')}
          </button>
        </div>
      </div>

      {/* Skeleton Loader or Blog Feed */}
      {loading ? (
        <SkeletonLoader />
      ) : (
        <div className="blog-feed">
          {sortBy(filteredData || [], SORTS, sortField, sortDir, { ids: mine, idOf: (c) => c.name }).map((community, index) => (
            <div key={community.name || index} className="blog-card" onClick={() => handleCardClick(community.name)}>
              <div className="blog-card-main">
              <div className="img-wrap">
                {/* The community's own picture when the index has it. The
                    hardcoded proxy below is the fallback: it cannot read
                    images.3speak.tv and answers with a grey placeholder at 200,
                    so a community created here looked faceless in this grid. */}
                <img
                  src={
                    community.image
                    || 'https://images.hive.blog/u/' + community.name + '/avatar/small?size=icon'
                  }
                  alt={community.title}
                  className="blog-image"
                />
              </div>
              {/* The three lines are wrapped so they stay a block beside the
                  logo. Left as siblings in a grid, the logo spanned all three
                  rows and stretched them apart. */}
              <div className="blog-text">
                <h3 className="blog-title">
                  {community.title}
                  {/* Otherwise "yours first" is an order with no explanation. */}
                  {mine.has(community.name) && <span className="blog-mine">{t('communities.directory.joined')}</span>}
                </h3>
                {/* The same two lines a badge card carries, from the fields the
                    communities API already returns. Without them a tile twice as
                    wide was an avatar and a name adrift in empty space. */}
                {community.about && <p className="blog-about">{community.about}</p>}
                {/* Size on its own line, the rest below it. The numbers the sort
                    offers, so what you ordered the list by is visible on the card
                    you are looking at.

                    Each is dropped rather than shown as zero when the API omits
                    it: "0 authors" and "we were not told" are different
                    statements. */}
                {typeof community.subscribers === 'number' && (
                  <span className="blog-count">
                    {t('communities.directory.subscribers', { count: community.subscribers, n: formatNumber(community.subscribers) })}
                  </span>
                )}
                <div className="blog-meta">
                  {typeof community.num_authors === 'number' && (
                    <span>{t('communities.directory.authors', { count: community.num_authors, n: formatNumber(community.num_authors) })}</span>
                  )}
                  {community.sum_pending > 0 && (
                    <span>{t('communities.directory.pending', { amount: formatNumber(Math.round(community.sum_pending)) })}</span>
                  )}
                  {/* TimeAgo renders its own span, so it is not wrapped in a
                      second one: the separator rule keys off siblings. */}
                  {community.created_at && <TimeAgo date={community.created_at} short />}
                </div>
              </div>
              </div>

              {/* What is happening there on 3Speak right now: counts, then the
                  newest videos. Absent for a community with no videos in the
                  last 30 days, so a quiet card stays compact. */}
              {activity[community.name] && (() => {
                const a = activity[community.name];
                return (
                  <div className="blog-activity">
                    <div className="blog-activity-counts">
                      {a.today > 0 && <span className="is-today">{t('communities.directory.videosToday', { count: a.today, n: formatNumber(a.today) })}</span>}
                      {a.week > 0
                        ? <span>{t('communities.directory.videosWeek', { count: a.week, n: formatNumber(a.week) })}</span>
                        : <span>{t('communities.directory.videosMonth', { count: a.month, n: formatNumber(a.month) })}</span>}
                    </div>
                    <div className="blog-activity-strip">
                      {a.latest.map((v) => (
                        <Link
                          key={`${v.author}/${v.permlink}`}
                          to={`/watch?v=${v.author}/${v.permlink}`}
                          className="blog-activity-thumb"
                          title={t('communities.directory.videoBy', { title: v.title, author: v.author })}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <img
                            src={fixVideoThumbnail(v)}
                            alt=""
                            loading="lazy"
                            onError={(e) => { e.currentTarget.src = fallbackImg; }}
                          />
                        </Link>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>
          ))}
        </div>
      )}
    </div>
    {openModal && <CreateCommunity close={toggleModal} isOpen={openModal} /> }
    </>
  );
}

export default CommunitiesRender;
