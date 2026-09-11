import React, { useEffect, useState } from 'react';
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
import { HIVE_API_NODES } from '../../utils/config';

const client = getHiveClient();

function CommunitiesRender() {
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
  const handleSearch = (e) => {
    const query = e.target.value.toLowerCase();
    setSearchQuery(query);
    setFilteredData(data.filter((c) => c.title.toLowerCase().includes(query)));
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
    const t = setTimeout(() => {
      client.call('bridge', 'list_communities', { last: '', limit: 100, query: q, observer: '' })
        .then((res) => { if (alive && Array.isArray(res)) setFilteredData(res); })
        .catch(() => { /* the local filter above is still showing something */ });
    }, 300);

    return () => { alive = false; clearTimeout(t); };
    // `data` is deliberately not a dependency: it changes once on load, and
    // including it would re-run the search for no reason.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery]);

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
  const SORTS = [
    { id: 'subscribers', label: 'Subscribers', value: (c) => c.subscribers },
    { id: 'authors', label: 'Active authors', value: (c) => c.num_authors },
    { id: 'pending', label: 'Pending rewards', value: (c) => c.sum_pending },
    { id: 'posts', label: 'Pending posts', value: (c) => c.num_pending },
    { id: 'created', label: 'Created', value: (c) => (c.created_at ? Date.parse(c.created_at) : null) },
    { id: 'title', label: 'Name', value: (c) => c.title, text: true },
  ];


  return (
    <>
    <div className="communities-render">
      {/* Says what a community IS. The tab label alone assumes you already
          know, and this list is mostly read by people who do not yet. */}
      <div className="communities-head">
        <p>
          Communities are curated spaces around a shared interest. Find people who
          care about the same things, <strong>join</strong> in, and connect. Anyone
          can join a community, and you can start your own.
        </p>
      </div>

      {/* Search on the left, sort and the create button on the right: the two
          things you do TO the list, next to each other and away from the list
          itself. */}
      <div className="communities-bar">
        <div className="search-wrapper">
          <input
            type="text"
            placeholder="Search communities..."
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
              ? 'Creating a community needs a Hive account. This unlocks when yours is ready.'
              : undefined}
          >
            <MdAdd size={17} /> Create community
          </button>
        </div>
      </div>

      {/* Skeleton Loader or Blog Feed */}
      {loading ? (
        <SkeletonLoader />
      ) : (
        <div className="blog-feed">
          {sortBy(filteredData || [], SORTS, sortField, sortDir, { ids: mine, idOf: (c) => c.name }).map((community, index) => (
            <div key={index} className="blog-card" onClick={() => handleCardClick(community.name)}>
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
                  {mine.has(community.name) && <span className="blog-mine">Joined</span>}
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
                    {community.subscribers.toLocaleString()} subscriber{community.subscribers === 1 ? '' : 's'}
                  </span>
                )}
                <div className="blog-meta">
                  {typeof community.num_authors === 'number' && (
                    <span>{community.num_authors.toLocaleString()} author{community.num_authors === 1 ? '' : 's'}</span>
                  )}
                  {community.sum_pending > 0 && (
                    <span>${Math.round(community.sum_pending).toLocaleString()} pending</span>
                  )}
                  {/* TimeAgo renders its own span, so it is not wrapped in a
                      second one: the separator rule keys off siblings. */}
                  {community.created_at && <TimeAgo date={community.created_at} short />}
                </div>
              </div>
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
