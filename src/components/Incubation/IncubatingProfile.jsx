import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Card3 from '../Cards/Card3';
import { useAppStore } from '../../lib/store';
import ProfileEditModal from '../WelcomePrompt/ProfileEditModal';
import IncubationProgressPanel from './IncubationProgressPanel';
import TrackQuestion from './TrackQuestion';
import IncubatingActivity from './IncubatingActivity';
import AdvertiserAdminPanel from './AdvertiserAdminPanel';
import CreateAccountPanel from './CreateAccountPanel';
import { InventoryPanel, RateCard } from '../ads/AdMarketPanels';
import { fetchInventory, fetchPricing } from '../../lib/advertiseData';
import { Button, Icon, Segmented, StatusPill } from '../v2/ui';
import {
  fetchIncubationProfile, fetchIncubationPosts, handleAvatar,
  fetchMyIncubationProfile, saveIncubationProfile, followIncubationUser,
  fetchIncubationProgress, onIncubationProgress, progressFraction,
} from '../../lib/incubation';
import { useTranslation, Trans } from 'react-i18next';
import './IncubatingProfile.scss';

// The unlock tiles, as data: the icon belongs beside its own heading, and the
// list was long enough that repeating the markup five times hid the copy.
// Text is i18n keys, translated at render.
const UNLOCKS = [
  { icon: 'payments', titleKey: 'incubation.profile.unlocks.earn.title', bodyKey: 'incubation.profile.unlocks.earn.body' },
  { icon: 'publish', titleKey: 'incubation.profile.unlocks.publish.title', bodyKey: 'incubation.profile.unlocks.publish.body' },
  { icon: 'thumb_up', titleKey: 'incubation.profile.unlocks.buttons.title', bodyKey: 'incubation.profile.unlocks.buttons.body' },
  { icon: 'key', titleKey: 'incubation.profile.unlocks.keys.title', bodyKey: 'incubation.profile.unlocks.keys.body' },
  { icon: 'public', titleKey: 'incubation.profile.unlocks.ecosystem.title', bodyKey: 'incubation.profile.unlocks.ecosystem.body' },
];

// The same tiles for an ADVERTISER. They are not here to earn from posts: the Hive
// account is the account they book and pay for ads with. Talking to customers is
// in the list, but as the optional extra it is for them.
const ADVERTISER_UNLOCKS = [
  { icon: 'campaign', titleKey: 'incubation.profile.advertiserUnlocks.book.title', bodyKey: 'incubation.profile.advertiserUnlocks.book.body' },
  { icon: 'account_balance_wallet', titleKey: 'incubation.profile.advertiserUnlocks.pay.title', bodyKey: 'incubation.profile.advertiserUnlocks.pay.body' },
  { icon: 'insights', titleKey: 'incubation.profile.advertiserUnlocks.results.title', bodyKey: 'incubation.profile.advertiserUnlocks.results.body' },
  { icon: 'forum', titleKey: 'incubation.profile.advertiserUnlocks.customers.title', bodyKey: 'incubation.profile.advertiserUnlocks.customers.body' },
  { icon: 'key', titleKey: 'incubation.profile.advertiserUnlocks.keys.title', bodyKey: 'incubation.profile.advertiserUnlocks.keys.body' },
];

/**
 * True below the app's mobile breakpoint (767px, as in App.jsx).
 *
 * The feed needs this in JS, not CSS: above it videos and shorts share one
 * justified row, and below it they split into two grids with different card
 * shapes. That is a different component tree, not a different rule.
 */
function useIsNarrow() {
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia?.('(max-width: 767px)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const onChange = (e) => setNarrow(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return narrow;
}

/**
 * The profile of someone on 3Speak who is not yet on Hive.
 *
 * Two audiences in one page. A VISITOR needs to understand why there is no
 * reputation, no follower count and no payout, without it reading as a broken
 * account. The OWNER needs to know what to do next and what it gets them, so
 * they get a sidebar nobody else sees.
 */
export default function IncubatingProfile({ handle, own = false }) {
  const { t } = useTranslation();
  const [profile, setProfile] = useState(null);
  const [posts, setPosts] = useState([]);
  const [editing, setEditing] = useState(false);
  const [following, setFollowing] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);
  // Which half is on screen at phone/tablet width, where the two columns stack.
  // Ignored above that: both are visible side by side and the tabs are hidden.
  const [mobileTab, setMobileTab] = useState('progress');
  // A VISITOR's view of the page. Posts alone answer "what do they upload",
  // which is the wrong question for the person this page is most often opened
  // by: an app owner deciding whether somebody has earned a real Hive account.
  // Somebody who comments daily and has followers looks inactive on an uploads
  // list. The owner's own page does not get these -- their half is the goal
  // checklist, and their own comments and follows are not news to them.
  const [visitorTab, setVisitorTab] = useState('posts');
  // Comment count is not in the profile payload the way follows are, so the tab
  // learns it from the first load and keeps it.
  const [commentCount, setCommentCount] = useState(null);
  const isNarrow = useIsNarrow();
  const [error, setError] = useState('');
  // Saving REPLACES the stored profile object, interests included, so the ones
  // already set have to be sent back with it or picking a new avatar silently
  // clears them.
  const interestsRef = useRef([]);
  /* The owner's goals payload, for the track and the advertiser road. Only read on
   * their own page; a visitor's view does not change by track. Re-read when goals
   * may have moved (a track picked, a contact saved), like the goals panel. */
  const [progress, setProgress] = useState(null);
  useEffect(() => {
    if (!own) return undefined;
    let alive = true;
    const load = () => fetchIncubationProgress()
      .then((p) => { if (alive) setProgress(p); })
      .catch(() => { /* the page works without it, as the viewer layout */ });
    load();
    const off = onIncubationProgress(load);
    return () => { alive = false; off(); };
  }, [own]);

  /* The market an advertiser is working towards: the audience forecast and the rate
   * card, the same two panels /advertise shows (components/ads/AdMarketPanels). Only
   * fetched for an advertiser's own page; both endpoints are public. */
  const isAdvertiserOwner = own && progress?.track === 'advertiser';
  // Starts as loading: it is only ever shown once the fetch below is under way.
  const [market, setMarket] = useState({ inventory: null, pricing: null, loading: true, error: null });
  useEffect(() => {
    if (!isAdvertiserOwner) return undefined;
    let alive = true;
    Promise.allSettled([fetchInventory(), fetchPricing()]).then(([inv, pr]) => {
      if (!alive) return;
      setMarket({
        inventory: inv.status === 'fulfilled' ? inv.value : null,
        pricing: pr.status === 'fulfilled' ? pr.value : null,
        loading: false,
        error: inv.status === 'rejected' ? inv.reason : null,
      });
    });
    return () => { alive = false; };
  }, [isAdvertiserOwner]);

  useEffect(() => {
    let alive = true;
    const viewer = useAppStore.getState().user || useAppStore.getState().incubationHandle || null;
    Promise.all([fetchIncubationProfile(handle, viewer), fetchIncubationPosts(handle)])
      .then(([p, list]) => {
        if (!alive) return;
        setProfile(p);
        setFollowing(!!p.viewerFollows);
        interestsRef.current = p.interests || [];
        setPosts(list.items || []);
      })
      .catch(() => { if (alive) setError(t('incubation.profile.loadFailed')); });
    return () => { alive = false; };
  }, [handle, t]);

  // Stable identities: ProfileEditModal reloads whenever `loadProfile` changes,
  // so a new function every render would refetch in a loop.
  const loadOwnProfile = useCallback(async () => {
    const mine = await fetchMyIncubationProfile();
    interestsRef.current = mine.interests || [];
    return mine.profile || {};
  }, []);

  const saveOwnProfile = useCallback(
    (form) => saveIncubationProfile(form, interestsRef.current),
    [],
  );

  const onProfileSaved = useCallback(() => {
    fetchIncubationProfile(handle).then(setProfile).catch(() => { /* keep what is shown */ });
  }, [handle]);

  // Card3 wants author/permlink/title/thumbnail/duration/created, which is the
  // same shape the feed rail builds: one card component, one shape.
  const toCard = (p) => ({
    author: handle,
    permlink: p.permlink,
    title: p.title || '',
    thumbnail: p.thumbnail || null,
    duration: p.duration || 0,
    created: p.created,
    hive_body: p.body || '',
    // Keeps its portrait shape inside the mixed grid. Videos and shorts sit in
    // ONE grid here, newest first, because a new channel with three posts does
    // not need to be filed into sections.
    _short: p.contentType === 'short',
    // The card footer reads these from `stats`, the same shape a Hive feed
    // supplies, so the counts render through the existing components instead of
    // sitting at the placeholder they would otherwise never leave.
    stats: { num_votes: p.likeCount || 0, num_comments: p.replyCount || 0 },
    _incubation: true,
  });

  // ONE grid, videos and shorts together, newest first as the checker returns
  // them. Splitting them into sections is a library view, and these channels
  // have a handful of posts: two headings over two and one card said far more
  // about our data model than about the person whose page it is.
  const cards = useMemo(
    () => posts.map(toCard),
    [posts, handle], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const videoCards = useMemo(() => cards.filter((c) => !c._short), [cards]);
  const shortCards = useMemo(() => cards.filter((c) => c._short), [cards]);

  if (error) return <p className="inc-profile-error">{error}</p>;
  if (!profile) return <p className="inc-profile-loading">{t('common.status.loading')}</p>;

  const p = profile.profile || {};
  const graduated = profile.status === 'graduated' && profile.hiveUsername;
  const showSidebar = own && !graduated;
  const nothingYet = cards.length === 0;
  // The owner is here to advertise: their page leads with the road to a first ad,
  // and their videos are the optional extra rather than the point.
  const advertiser = showSidebar && progress?.track === 'advertiser';
  const unlocks = advertiser ? ADVERTISER_UNLOCKS : UNLOCKS;
  // The owner's avatar wears their progress (design 19h): a cyan ring around
  // the picture, the same equal-share figure the nav ring and the goal bar use.
  const ringPct = showSidebar && Array.isArray(progress?.tasks) && progress.tasks.length
    ? Math.min(100, progressFraction(progress.tasks) * 100)
    : null;
  const badge = graduated ? t('incubation.profile.badge.onHive') : (advertiser ? t('incubation.profile.badge.advertiser') : t('incubation.profile.badge.gettingStarted'));
  const visitorTabs = [
    // 'Uploads', not the 'Videos and Shorts' the owner's strip uses: four
    // labels share this row at phone width, and the grid heading directly
    // below already names the two things in it.
    ['posts', t('incubation.profile.tabs.uploads'), profile?.counts?.posts],
    ['comments', t('incubation.profile.tabs.comments'), commentCount],
    ['followers', t('incubation.profile.tabs.followers'), profile?.counts?.followers],
    ['following', t('incubation.profile.tabs.following'), profile?.counts?.following],
  ].map(([value, label, count]) => ({
    value,
    label,
    // A count only when we have one. `> 0` rather than != null, so a tab does
    // not advertise "0" before anyone has looked.
    count: count > 0 ? count : undefined,
  }));

  const toggleFollow = async () => {
    if (followBusy) return;
    const next = !following;
    setFollowBusy(true);
    setFollowing(next);
    try {
      await followIncubationUser(handle, next);
      setProfile((p2) => (p2 ? {
        ...p2,
        counts: {
          ...p2.counts,
          followers: Math.max(0, (p2.counts?.followers || 0) + (next ? 1 : -1)),
        },
      } : p2));
    } catch {
      setFollowing(!next);
    } finally {
      setFollowBusy(false);
    }
  };

  return (
    <div className="inc-profile">
      {/* Profile card (design 46b): striped band (or their banner), the avatar
          overlapping it, name with a cyan status pill, counts, and the one
          action for whoever is looking. */}
      <header className={`inc-hero${p.cover_image ? ' has-cover' : ''}`}>
        <div className="inc-hero-cover" style={p.cover_image ? { backgroundImage: `url(${p.cover_image})` } : undefined} />
        <div className="inc-hero-body">
          <span className={`inc-hero-avatar-wrap${ringPct != null ? ' has-ring' : ''}`}>
            {ringPct != null && (
              <svg className="inc-hero-ring" viewBox="0 0 36 36" aria-hidden="true">
                <circle className="inc-hero-ring-track" cx="18" cy="18" r="16" />
                <circle className="inc-hero-ring-arc" cx="18" cy="18" r="16" pathLength="100" strokeDasharray={`${ringPct} 100`} />
              </svg>
            )}
            <img className="inc-hero-avatar" src={p.profile_image || handleAvatar(handle)} alt="" />
          </span>
          <div className="inc-hero-text">
            <h1>{p.name || `@${handle}`}</h1>
            <p className="inc-hero-handle">
              {/* Only when a display name exists, or the heading already said it. */}
              {p.name && <span>@{handle}</span>}
              <StatusPill tone="cyan" icon={graduated ? 'verified' : 'eco'} className="inc-badge">{badge}</StatusPill>
            </p>
            {p.about && <p className="inc-hero-about">{p.about}</p>}
            {profile.interests?.length > 0 && (
              <ul className="inc-chips">
                {profile.interests.map((tag) => <li key={tag}>{tag}</li>)}
              </ul>
            )}
          </div>
          <div className="inc-hero-stats">
            <span><Trans i18nKey="incubation.profile.stats.posts" count={profile.counts?.posts ?? 0} components={{ b: <strong /> }} /></span>
            <span><Trans i18nKey="incubation.profile.stats.followers" count={profile.counts?.followers ?? 0} components={{ b: <strong /> }} /></span>
            <span><Trans i18nKey="incubation.profile.stats.following" count={profile.counts?.following ?? 0} components={{ b: <strong /> }} /></span>
          </div>
          {!own && !graduated && (
            // Someone can finally follow back. Until now this was impossible:
            // the account does not exist on chain, so the ordinary follow was
            // broadcast at nothing. These are stored off-chain, and the creator
            // is told about them.
            <Button
              variant={following ? 'secondary' : 'primary'}
              className={`inc-follow-btn${following ? ' is-following' : ''}`}
              icon={following ? 'how_to_reg' : 'person_add'}
              onClick={toggleFollow}
              aria-pressed={following}
            >
              {following ? t('common.actions.following') : t('common.actions.follow')}
            </Button>
          )}
          {own && (
            <Button variant="secondary" size={36} icon="edit" className="inc-edit-btn" onClick={() => setEditing(true)}>
              {t('incubation.profile.editProfile')}
            </Button>
          )}
        </div>
        {/* The note sits in the card as a well (design 46b): it explains the
            page, it is not something to act on. */}
        <p className="inc-note">
          {graduated ? (
            <Trans i18nKey="incubation.profile.note.graduated" values={{ user: profile.hiveUsername }} components={{ userLink: <Link to={`/@${profile.hiveUsername}`} /> }} />
          ) : advertiser ? (
            <>{t('incubation.profile.note.advertiser')}</>
          ) : own ? (
            // Per track: a viewer has no videos to move over, so their note talks
            // about comments and follows instead (owner 2026-10-06).
            <>{t(progress?.track === 'viewer' ? 'incubation.profile.note.ownViewer' : 'incubation.profile.note.ownCreator')}</>
          ) : (
            <>{t('incubation.profile.note.visitor')}</>
          )}
        </p>
      </header>


      {/* Approved and not yet on Hive: the way to the account, always on their own
          page, so "Not yet" on the popup never leaves them hunting for it. */}
      {showSidebar && <CreateAccountPanel advertiser={advertiser} />}

      {showSidebar && !advertiser && (
        // Only rendered when there IS a second panel to switch to, and only
        // shown below the split (see .inc-tabs). Reaching your own videos
        // otherwise meant scrolling past the whole checklist every time.
        <Segmented
          className="inc-tabs"
          label={t('incubation.profile.tabs.aria')}
          value={mobileTab}
          onChange={setMobileTab}
          options={[
            { value: 'progress', label: t('incubation.profile.tabs.goals') },
            { value: 'posts', label: t('incubation.profile.videosAndShorts') },
          ]}
        />
      )}

      {!own && (
        // The visitor's page navigation, at every width. The two strips can
        // never both render: showSidebar requires `own` and this requires `!own`.
        <Segmented
          className="inc-tabs inc-tabs--visitor"
          scroll
          label={t('incubation.profile.tabs.aria')}
          value={visitorTab}
          onChange={setVisitorTab}
          options={visitorTabs}
        />
      )}

      {/* One column for everyone. The owner's checklist sits in it, between their
          uploads and "What a Hive account gets you" (owner 2026-10-06: the list
          belongs in the middle, not in a sidebar). On a phone the tabs above
          show the goals or the uploads, see .inc-cols--goals. */}
      <div className={`inc-cols${showSidebar && !advertiser ? ` inc-cols--goals inc-show-${mobileTab}` : ''}`}>
        <main className="inc-main">
          {/* For 3Speak's admins visiting someone else's warm-up page: the private
              details only they may see. Renders nothing for anyone else. */}
          {!own && <AdvertiserAdminPanel handle={handle} profile={p} interests={profile.interests || []} counts={profile.counts || {}} />}
          {/* An advertiser's checklist leads the column, then the market they are
              working towards: who they would reach, and what they can book. */}
          {advertiser && <IncubationProgressPanel />}
          {advertiser && (
            <section className="inc-panel inc-market">
              <h2><Icon name="groups" size={20} /> {t('incubation.profile.market.audience')}</h2>
              <div className="mkt-page mkt-embed">
                <InventoryPanel data={market.inventory} isLoading={market.loading} error={market.error} />
              </div>
            </section>
          )}
          {advertiser && market.pricing?.formats?.length > 0 && (
            <section className="inc-panel inc-market">
              <h2><Icon name="view_agenda" size={20} /> {t('incubation.profile.market.format')}</h2>
              <div className="mkt-page mkt-embed">
                <RateCard pricing={market.pricing} />
              </div>
            </section>
          )}
          <div className="inc-feed">
          {/* The three list tabs replace the feed rather than sitting under it:
              they are alternative answers to "who is this", not extra sections
              of the same one. */}
          {!own && visitorTab !== 'posts' ? (
            <IncubatingActivity
              handle={handle}
              tab={visitorTab}
              onCount={(tab, n) => { if (tab === 'comments') setCommentCount(n); }}
            />
          ) : (
          <>
          {advertiser && (
            <h2 className="inc-subhead"><Icon name="movie" size={20} /> {t('incubation.profile.brandVideos')} <span className="inc-subhead-note">{t('incubation.profile.optional')}</span></h2>
          )}
          {nothingYet && (
            <div className="v2-empty inc-empty">
              <Icon name="video_library" size={28} />
              <p>
                {advertiser
                  ? t('incubation.profile.empty.advertiser')
                  : own ? t('incubation.profile.empty.own') : t('incubation.profile.empty.visitor')}
              </p>
            </div>
          )}

          {/* Deliberately NOT linkPrefix="/shorts" on the shorts anywhere below:
              that viewer reads its feed from Hive and can only fail on a post
              that is not there. The watch page already falls back to the
              incubation service, so every card opens somewhere that works. */}
          {cards.length > 0 && (isNarrow ? (
            // A phone has no room for the justified row, so the mixed grid falls
            // back to equal boxes and a short becomes a letterboxed sliver of a
            // 16:9 card. Split them there instead, and each kind gets the grid
            // built for its shape: shorts in proper portrait tiles, two up.
            <>
              {videoCards.length > 0 && (
                <>
                  <h2 className="inc-subhead"><Icon name="movie" size={20} /> {t('incubation.profile.videos')}</h2>
                  <Card3 videos={videoCards} />
                </>
              )}
              {shortCards.length > 0 && (
                <>
                  <h2 className="inc-subhead"><Icon name="view_day" size={20} /> {t('common.nav.shorts')}</h2>
                  <Card3 videos={shortCards} shortsGrid />
                </>
              )}
            </>
          ) : (
            <>
              {/* Names the two things in the feed, since they share one grid
                  rather than sitting under separate headings. */}
              {!advertiser && <h2 className="inc-subhead"><Icon name="movie" size={20} /> {t('incubation.profile.videosAndShorts')}</h2>}
              <Card3 videos={cards} />
            </>
          ))}
          </>
          )}
          </div>

          {/* Above the unlocks: until a path is picked there is no list to work
              through, so the question comes first. */}
          {showSidebar && <TrackQuestion />}
          {showSidebar && !advertiser && (
            <div className="inc-goals">
              <IncubationProgressPanel />
            </div>
          )}
          {showSidebar && (
            // "What a Hive account gets you" (design 46b): accent icon, bold
            // lead-in, muted rest. Below the checklist: it is the reward for it.
            <section className="inc-panel inc-unlocks">
              <h2><Icon name="lock_open" size={20} /> {advertiser ? t('incubation.profile.unlocksTitleAdvertiser') : t('incubation.profile.unlocksTitle')}</h2>
              <ul>
                {unlocks.map(({ icon, titleKey, bodyKey }) => (
                  <li key={titleKey}>
                    <Icon name={icon} size={18} className="inc-unlock-icon" />
                    <span><strong>{t(titleKey)}</strong> {t(bodyKey)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </main>
      </div>

      {own && (
        <ProfileEditModal
          open={editing}
          username={null}
          onClose={() => setEditing(false)}
          loadProfile={loadOwnProfile}
          onSave={saveOwnProfile}
          onSaved={onProfileSaved}
          fineprint={t('incubation.profile.fineprint')}
        />
      )}
    </div>
  );
}
