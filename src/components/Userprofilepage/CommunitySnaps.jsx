import { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { toastIn } from '../../utils/toast';
import { BiCommentDetail } from 'react-icons/bi';
import { MdMoreVert, MdEdit, MdClose } from 'react-icons/md';
import {
  fetchSnaps, fetchCommunitySnaps, SNAP_TAG, MAX_USER_TAGS, recordSnapInteraction, updateSnap,
  hideSnap, unhideSnap, hideSnapCreator, unhideSnapCreator,
} from '../../lib/snaps';
import MarkdownComposer from '../studio/MarkdownComposer';
import { getHiveRenderer } from '../../lib/hiveRenderer';
import { getHiveClient } from '../../utils/hiveNode';
import { getVotePower, getDynamicProps } from '../../utils/hiveUtils';
import { commentWithAioha } from '../../hive-api/aioha';
import { fetchIncubationRepliesFor, fetchIncubationLikes } from '../../lib/incubation';
import { useAppStore } from '../../lib/store';
import SnapComposer from './SnapComposer';
import EmojiGifPicker from '../common/EmojiGifPicker/EmojiGifPicker';
import { insertAtCursor, gifMarkdown } from '../../utils/composerInsert';
import UpvoteCount from '../UpvoteCount/UpvoteCount';
import AuthorBadge from '../AuthorBadge/AuthorBadge';
import CommentVoteTooltip from '../tooltip/CommentVoteTooltip';
import BarLoader from '../Loader/BarLoader';
import { useTranslation } from 'react-i18next';
import './CommunitySnaps.scss';

// Every toast from this module is headed "Post"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Post');

dayjs.extend(relativeTime);

const hiveTime = (t) => (t ? dayjs(/Z$/.test(String(t)) ? t : `${t}Z`).fromNow() : '');

/**
 * Replies to one snap or one comment, Hive AND off-chain, in the shape this
 * component renders.
 *
 * Off-chain replies are written by people with no Hive account. Reading Hive
 * alone left them invisible on the very snap they were written under, including
 * to whoever wrote them.
 *
 * ONE batch call covers two questions: replies to THIS parent (merged in here)
 * and replies to each of its children (which is the only way a child knows to
 * offer a "replies" toggle -- an off-chain reply never increments the Hive
 * `children` count that the toggle used to read).
 */
async function fetchReplies(author, permlink) {
  // condenser_api THROWS for a post that is not on chain rather than returning
  // an empty list, so an off-chain snap would take the whole loader down with it.
  let hive = [];
  try {
    hive = await getHiveClient().call('condenser_api', 'get_content_replies', [author, permlink]) || [];
  } catch { /* not on chain, or the node is unhappy: off-chain replies still load */ }

  let off = [];
  try {
    const ask = [permlink, ...hive.map((c) => c.permlink).filter(Boolean)];
    const { items } = await fetchIncubationRepliesFor(ask);
    off = items || [];
  } catch { /* enrichment is best-effort; the Hive thread still renders */ }

  const offChildren = new Map();
  const here = [];
  off.forEach((o) => {
    if (o.parentPermlink === permlink) here.push(o);
    else offChildren.set(o.parentPermlink, (offChildren.get(o.parentPermlink) || 0) + 1);
  });

  const mapped = here.map((o) => ({
    // A Hive user replying to an off-chain snap keeps their real account; a
    // warm-up user shows their handle.
    author: o.hiveAuthor || o.author?.handle || o.handle,
    permlink: o.permlink,
    created: o.created,
    body: o.body,
    children: 0,
    offChildren: 0,
    // Nothing downstream should build a Hive permalink or offer a Hive vote.
    onChain: false,
  }));

  return [...hive.map((c) => ({ ...c, offChildren: offChildren.get(c.permlink) || 0 })), ...mapped]
    .sort((a, b) => new Date(a.created) - new Date(b.created));
}

// A reply shows the moment it is signed, not when a node gets round to returning
// it: get_content_replies routinely lags a fresh comment by several seconds, and
// the single refetch 3s after posting often came back without it, so the thread
// looked like the comment had failed until a reload. `pending` holds what the
// viewer just wrote; each entry drops out once the fetched thread contains it
// (same permlink, or same author + body for an off-chain reply stored under its
// own permlink). The refetches are spread out until the chain catches up.
const REFETCH_AFTER_MS = [3000, 8000, 15000];
function usePendingReplies(fetched, refetch) {
  const [pending, setPending] = useState([]);
  const timers = useRef([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const landed = (p) => fetched.some((c) => c.permlink === p.permlink
    || (c.author === p.author && String(c.body || '').trim() === String(p.body || '').trim()));
  const waiting = pending.filter((p) => !landed(p));

  const add = (reply) => {
    if (!reply) return;
    setPending((prev) => [...prev, reply]);
    timers.current.push(...REFETCH_AFTER_MS.map((ms) => setTimeout(() => refetch(), ms)));
  };
  return { all: [...fetched, ...waiting], waitingCount: waiting.length, add };
}

// Body with "read more"/"show less" — a very long snap is capped at a fraction of
// the viewport (`maxVh`), but only when it actually overflows (no fade on short
// posts). The feed uses a tighter cap than the profile tab.
// `onReadMore`, when given, replaces the expand-in-place toggle with a plain
// navigation (used on the Overview page, where the card is too short a preview
// to expand inline — "Read more" instead jumps to the full Community tab).
function SnapBody({ body, maxVh = 0.33, onReadMore }) {
  const { t } = useTranslation();
  const [html, setHtml] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    let alive = true;
    getHiveRenderer()
      .then((render) => { if (alive) { try { setHtml(render(body || '')); } catch { setHtml(''); } } })
      .catch(() => { if (alive) setHtml(''); });
    return () => { alive = false; };
  }, [body]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => {
      // scrollHeight is the full content height regardless of the max-height clamp.
      setOverflowing(el.scrollHeight > window.innerHeight * maxVh + 8);
    };
    measure();
    // Images and GIFs inside a snap load AFTER this first pass, when they still
    // measure ~0 tall — so a post that overflows once its media arrives would
    // stay unclamped forever (it opened full-size on first load). The observer
    // re-measures as the body grows; once clamped its height is pinned, so this
    // settles instead of looping.
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (ro) ro.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      if (ro) ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [html, maxVh]);

  const clamped = overflowing && !expanded;
  return (
    <div className="snap-body-wrap">
      <div
        ref={ref}
        className={`snap-body markdown-body${clamped ? ' clamped' : ''}`}
        style={{ '--snap-clamp': `${maxVh * 100}vh` }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {overflowing && (
        <button type="button" className="snap-readmore" onClick={onReadMore || (() => setExpanded((e) => !e))}>
          {onReadMore ? t('profile.snaps.readMore') : (expanded ? t('common.actions.showLess') : t('profile.snaps.readMore'))}
        </button>
      )}
    </div>
  );
}

// Reply composer — reused for the snap itself and for any comment (nested replies).
// onSigned fires the moment the broadcast succeeds (for instant counters);
// onPosted fires right after it with the new reply, so the thread can show it
// before any node returns it (see usePendingReplies).
function ReplyBox({ parentAuthor, parentPermlink, onPosted, onSigned, autoFocus = false }) {
  const { t } = useTranslation();
  const user = useAppStore((s) => s.user);
  const incubationHandle = useAppStore((s) => s.incubationHandle);
  const [reply, setReply] = useState('');
  const [posting, setPosting] = useState(false);
  const replyRef = useRef(null);
  // A warm-up user has a handle rather than a `user`, and commentWithAioha
  // already stores their reply off-chain. Gating on `user` alone hid the
  // composer from exactly the people the warm-up asks to write ten comments.
  if (!user && !incubationHandle) return null;

  const submit = async () => {
    const text = reply.trim();
    if (!text) return;
    setPosting(true);
    try {
      const rp = `re-${parentPermlink}-${Date.now() % 1000000}`.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 250);
      await commentWithAioha(parentAuthor, parentPermlink, rp, '', text, { app: '3speak/snap', format: 'markdown' }, null);
      toast.success(t('profile.snaps.commentPosted'));
      // What was just written, in the shape the thread renders, so it can be
      // shown before any node returns it (see usePendingReplies).
      const local = {
        author: user || incubationHandle,
        permlink: rp,
        body: text,
        created: new Date().toISOString(),
        children: 0,
        offChildren: 0,
        onChain: !!user,
      };
      onSigned?.(local); // instant — counters bump right after signing
      setReply('');
      onPosted?.(local);
    } catch (e) {
      toast.error(e?.message || t('profile.snaps.commentFailed'));
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="snap-reply-box">
      <textarea
        ref={replyRef}
        placeholder={t('profile.snaps.commentPlaceholder')}
        value={reply}
        onChange={(e) => setReply(e.target.value)}
        rows={2}
        autoFocus={autoFocus}
      />
      <div className="snap-reply-actions">
        <EmojiGifPicker
          onPickEmoji={(em) => insertAtCursor(replyRef.current, reply, em, setReply)}
          onPickGif={(url) => insertAtCursor(replyRef.current, reply, gifMarkdown(url), setReply)}
        />
        <button type="button" onClick={submit} disabled={posting || !reply.trim()}>
          {posting ? t('profile.snaps.posting') : t('common.actions.reply')}
        </button>
      </div>
    </div>
  );
}

// A single comment — recursive, so replies-on-replies work.
function SnapComment({ comment }) {
  const { t } = useTranslation();
  const user = useAppStore((s) => s.user);
  const incubationHandle = useAppStore((s) => s.incubationHandle);
  const [html, setHtml] = useState('');
  const [replying, setReplying] = useState(false);
  const [showReplies, setShowReplies] = useState(false);
  // Both kinds: an off-chain reply never increments Hive's `children`.
  const childCount = (comment.children ?? 0) + (comment.offChildren ?? 0);

  useEffect(() => {
    let alive = true;
    getHiveRenderer().then((render) => { if (alive) { try { setHtml(render(comment.body || '')); } catch { setHtml(''); } } });
    return () => { alive = false; };
  }, [comment.body]);

  const { data: fetchedChildren = [], refetch } = useQuery({
    queryKey: ['snap-replies', comment.author, comment.permlink],
    queryFn: () => fetchReplies(comment.author, comment.permlink),
    enabled: showReplies,
    staleTime: 30_000,
  });
  const { all: children, waitingCount, add: addPending } = usePendingReplies(fetchedChildren, refetch);
  const shownCount = childCount + waitingCount;

  return (
    <li className="snap-comment">
      <div className="snap-comment-head">
        <Link to={`/p/${comment.author}`} className="snap-comment-author">@{comment.author}</Link>
        <span className="snap-comment-time">{hiveTime(comment.created)}</span>
      </div>
      <div className="snap-comment-body markdown-body" dangerouslySetInnerHTML={{ __html: html }} />
      <div className="snap-comment-actions">
        {(user || incubationHandle) && (
          <button type="button" onClick={() => setReplying((v) => !v)}>{replying ? t('common.actions.cancel') : t('common.actions.reply')}</button>
        )}
        {shownCount > 0 && (
          <button type="button" onClick={() => setShowReplies((v) => !v)}>
            {showReplies ? t('profile.snaps.hideReplies') : t('profile.snaps.replies', { count: shownCount })}
          </button>
        )}
      </div>
      {replying && (
        <ReplyBox
          parentAuthor={comment.author}
          parentPermlink={comment.permlink}
          autoFocus
          onPosted={(local) => { setReplying(false); setShowReplies(true); addPending(local); }}
        />
      )}
      {showReplies && children.length > 0 && (
        <ul className="snap-comment-list nested">
          {children.map((c) => <SnapComment key={`${c.author}/${c.permlink}`} comment={c} />)}
        </ul>
      )}
    </li>
  );
}

function SnapComments({ owner, permlink, onCommented, autoFocus = false }) {
  const { t } = useTranslation();
  const { data: fetched = [], isLoading, refetch } = useQuery({
    queryKey: ['snap-comments', owner, permlink],
    queryFn: () => fetchReplies(owner, permlink),
    staleTime: 30_000,
  });
  const { all: comments, add: addPending } = usePendingReplies(fetched, refetch);

  return (
    <div className="snap-comments">
      <ReplyBox parentAuthor={owner} parentPermlink={permlink} onSigned={onCommented} onPosted={addPending} autoFocus={autoFocus} />
      {isLoading && comments.length === 0 ? (
        <div className="snap-comments-status">{t('profile.snaps.loadingComments')}</div>
      ) : comments.length === 0 ? (
        <div className="snap-comments-status">{t('profile.snaps.noComments')}</div>
      ) : (
        <ul className="snap-comment-list">
          {comments.map((c) => <SnapComment key={`${c.author}/${c.permlink}`} comment={c} />)}
        </ul>
      )}
    </div>
  );
}

// Card3-style ⋮ menu, but hides go to the SNAP hide list only (not video hides).
function SnapOptionsMenu({ owner, permlink, onHidden }) {
  const { t } = useTranslation();
  const user = useAppStore((s) => s.user);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = () => setOpen(false);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    document.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  if (!user) return null;

  const toggle = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 4, left: Math.min(r.left - 150, window.innerWidth - 220) });
    setOpen((v) => !v);
  };
  const hidePost = async () => {
    setOpen(false);
    onHidden?.();
    try {
      await hideSnap(user, owner, permlink);
      toast(t('profile.snaps.postHidden'), { action: { label: t('profile.snaps.undo'), onClick: () => unhideSnap(user, owner, permlink).catch(() => {}) } });
    } catch { toast.error(t('profile.snaps.hidePostFailed')); }
  };
  const hideCreator = async () => {
    setOpen(false);
    onHidden?.();
    try {
      await hideSnapCreator(user, owner);
      toast(t('profile.snaps.hidingCreator', { user: owner }), { action: { label: t('profile.snaps.undo'), onClick: () => unhideSnapCreator(user, owner).catch(() => {}) } });
    } catch { toast.error(t('profile.snaps.hideCreatorFailed')); }
  };

  return (
    <>
      <button ref={btnRef} type="button" className="snap-menu-btn" onClick={toggle} aria-label={t('profile.snaps.postOptions')}>
        <MdMoreVert />
      </button>
      {open && createPortal(
        <>
          <div className="snap-menu-backdrop" onClick={() => setOpen(false)} />
          <div className="snap-menu" style={{ top: pos.top, left: pos.left }}>
            <button type="button" onClick={hidePost}>{t('profile.snaps.notInterested')}</button>
            <button type="button" onClick={hideCreator}>{t('profile.snaps.dontShowCreator')}</button>
          </div>
        </>,
        document.body,
      )}
    </>
  );
}

// Inline editor for the owner's own snap — body + tags + NSFW, reusing the composer
// styles. Rewards and beneficiaries stay as originally posted (Hive only allows
// changing comment_options before the first vote), so they're not shown here.
function SnapEditForm({ owner, permlink, initialBody, initialTags, initialNsfw, onCancel, onSaved }) {
  const { t } = useTranslation();
  const user = useAppStore((s) => s.user);
  const [body, setBody] = useState(initialBody || '');
  const [tags, setTags] = useState(initialTags || []);
  const [tagInput, setTagInput] = useState('');
  const [nsfw, setNsfw] = useState(!!initialNsfw);
  const [saving, setSaving] = useState(false);

  const addTag = (raw) => {
    const tag = String(raw || '').toLowerCase().replace(/^#/, '').trim();
    if (!tag || tag === SNAP_TAG || tags.includes(tag)) return;
    if (tags.length >= MAX_USER_TAGS) { toast.error(t('profile.snaps.tagLimit', { max: MAX_USER_TAGS })); return; }
    setTags((prev) => [...prev, tag]);
  };
  const onTagKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === ',') { e.preventDefault(); addTag(tagInput); setTagInput(''); }
    else if (e.key === 'Backspace' && !tagInput && tags.length) setTags(tags.slice(0, -1));
  };
  const removeTag = (tag) => setTags(tags.filter((x) => x !== tag));

  const save = async () => {
    const text = body.trim();
    if (!text) { toast.error(t('profile.snaps.writeSomething')); return; }
    if (!user || user !== owner) { toast.error(t('profile.snaps.onlyAuthor')); return; }
    setSaving(true);
    try {
      // Don't lose a half-typed tag left in the input.
      const pending = tagInput.trim() ? [...tags, tagInput.trim().toLowerCase().replace(/^#/, '')] : tags;
      await updateSnap({ user, permlink, body: text, tags: pending, nsfw });
      toast.success(t('profile.snaps.postUpdated'));
      onSaved({ body: text, tags: [SNAP_TAG, ...pending, ...(nsfw ? ['nsfw'] : [])] });
    } catch (e) {
      toast.error(e?.message || t('profile.snaps.updateFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="snap-composer snap-edit-form">
      <MarkdownComposer value={body} onChange={setBody} placeholder={t('profile.snaps.editPlaceholder')} previewContext="snap" />
      <div className="snap-composer-row">
        <input
          className="snap-tags-input"
          placeholder={tags.length >= MAX_USER_TAGS ? t('profile.snaps.tagLimitReached') : t('profile.snaps.tagPlaceholder')}
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={onTagKeyDown}
          disabled={tags.length >= MAX_USER_TAGS}
        />
        <label className="snap-toggle">
          <input type="checkbox" checked={nsfw} onChange={(e) => setNsfw(e.target.checked)} />
          <span>NSFW</span>
        </label>
      </div>
      <div className="snap-tag-chips">
        <span className="snap-tag-chip built-in" title={t('profile.snaps.builtInTag')}>{SNAP_TAG}</span>
        {tags.map((tag) => (
          <span key={tag} className="snap-tag-chip">
            {tag}
            <button type="button" onClick={() => removeTag(tag)} aria-label={t('profile.snaps.removeTag', { tag })}><MdClose /></button>
          </span>
        ))}
        <span className="snap-tag-count">{tags.length}/{MAX_USER_TAGS}</span>
      </div>
      <div className="snap-composer-actions">
        <button type="button" className="snap-cancel-btn" onClick={onCancel} disabled={saving}>{t('common.actions.cancel')}</button>
        <button type="button" className="snap-post-btn" disabled={saving || !body.trim()} onClick={save}>
          {saving ? t('common.actions.saving') : t('profile.snaps.saveChanges')}
        </button>
      </div>
    </div>
  );
}

// Comments in a popup — used in the home feed, where expanding the thread inline
// would stretch the grid row. Centered dialog on desktop, bottom sheet on mobile
// (the app-wide popup convention). The community-snaps/snap-card classes are only
// there so the nested .snap-comments styles apply inside the portal.
function SnapCommentsModal({ owner, permlink, onClose, onCommented }) {
  const { t } = useTranslation();
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; // don't scroll the feed behind the sheet
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return createPortal(
    <div className="snap-comments-modal-backdrop" onClick={onClose}>
      <div className="community-snaps snap-comments-modal" onClick={(e) => e.stopPropagation()}>
        <div className="snap-comments-modal-head">
          <span>{t('profile.snaps.commentsOn', { user: owner })}</span>
          <button type="button" onClick={onClose} aria-label={t('common.actions.close')}><MdClose /></button>
        </div>
        <div className="snap-card snap-comments-modal-scroll">
          <SnapComments owner={owner} permlink={permlink} onCommented={onCommented} />
        </div>
      </div>
    </div>,
    document.body,
  );
}

// `onOpenTab(permlink)` marks the card as an OVERVIEW preview: "Read more" and
// the comment button stop expanding/opening inline (there's no room for that in
// a preview rail) and instead hand off to the Community tab — same pattern the
// feed's comments-popup uses, just landing on a full tab instead of a modal.
// `maxVh` overrides the default profile-tab clamp (33vh) for tighter spots, e.g.
// the trailer's side-by-side snap column.
// `autoOpenComments` is the landing side of that hand-off: the Community tab
// passes it on the ONE card the visitor was routed to, so its thread opens (and
// the reply box grabs focus) without another click.
// `showAuthor` names the author like the feed does but keeps the profile tab's
// behaviour otherwise (inline comments, full clamp) — a community Discussion tab
// is a list of many authors that is still a page of its own, not a feed rail.
export function SnapCard({ snap, feedMode = false, showAuthor = false, onRemove, onOpenTab, maxVh, autoOpenComments = false }) {
  const { t } = useTranslation();
  const user = useAppStore((s) => s.user);
  const incubationHandle = useAppStore((s) => s.incubationHandle);
  // Whoever is reading this card, by whichever identity they have. The off-chain
  // like store keys a Hive reader by account and a warm-up reader by handle.
  const viewer = user || incubationHandle;
  const client = getHiveClient();
  const queryClient = useQueryClient();
  const [showComments, setShowComments] = useState(autoOpenComments);
  const [commentsPopup, setCommentsPopup] = useState(false);
  const [editing, setEditing] = useState(false);
  const [localEdit, setLocalEdit] = useState(null); // optimistic body/tags after an edit
  const cardRef = useRef(null);

  // Scroll the targeted card into view once — the tab can land anywhere in a
  // long list, so the visitor needs to actually see the thread that opened.
  useEffect(() => {
    if (autoOpenComments) cardRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Vote-dialog state (the reused CommentVoteTooltip owns the actual vote).
  const [showVote, setShowVote] = useState(false);
  const [weight, setWeight] = useState(100);
  const [voteValue, setVoteValue] = useState('0.00');
  const [accountData, setAccountData] = useState(null);

  // Pre-fetch the viewer's vote power + chain props (shared across all cards via the
  // query key) so the vote dialog gets its fast path — otherwise it flips `initializing`
  // and re-renders the estimate back to the stale value until the slider moves.
  const { data: voteData } = useQuery({
    queryKey: ['snap-vote-data', user],
    queryFn: async () => {
      const [acctRes, dyn] = await Promise.all([getVotePower(user), getDynamicProps()]);
      return { account: acctRes?.account || null, dynProps: dyn || null };
    },
    enabled: !!user,
    staleTime: 5 * 60_000,
  });

  const { data: meta, refetch } = useQuery({
    queryKey: ['snap-meta', snap.owner, snap.permlink, viewer],
    queryFn: async () => {
      // Both stores, because a snap can carry either kind of like: Hive votes
      // from account holders, and off-chain likes from people still in the
      // warm-up. Counting only the first showed a warm-up user their own like
      // disappearing the moment the card re-read its counts.
      const [post, off] = await Promise.all([
        // get_content throws for a post that is not on chain.
        client.call('condenser_api', 'get_content', [snap.owner, snap.permlink]).catch(() => null),
        fetchIncubationLikes(snap.owner, snap.permlink, viewer).catch(() => null),
      ]);
      const av = post?.active_votes || [];
      const hiveVotes = av.filter((v) => Number(v.percent) > 0).length;
      return {
        votes: hiveVotes + (off?.count || 0),
        comments: post?.children ?? 0,
        voted: (!!user && av.some((v) => v.voter === user && Number(v.percent) > 0))
          || !!off?.liked,
      };
    },
    staleTime: 60_000,
  });

  // Bump the counters the moment the signed transaction succeeds — a chain read
  // right after broadcast usually still returns the OLD counts, which made the
  // numbers look frozen. The cached meta is patched instantly; a delayed refetch
  // reconciles with the chain once it has caught up.
  const metaKey = ['snap-meta', snap.owner, snap.permlink];
  const onVoted = () => {
    queryClient.setQueryData(metaKey, (old) => ({
      votes: (old?.votes ?? 0) + (old?.voted ? 0 : 1),
      comments: old?.comments ?? 0,
      voted: true,
    }));
    recordSnapInteraction(user, snap.owner, snap.permlink);
    setTimeout(() => refetch(), 8000);
  };
  const onCommented = () => {
    queryClient.setQueryData(metaKey, (old) => ({
      votes: old?.votes ?? 0,
      comments: (old?.comments ?? 0) + 1,
      voted: old?.voted ?? false,
    }));
    recordSnapInteraction(user, snap.owner, snap.permlink);
    setTimeout(() => refetch(), 8000);
  };

  const isOwn = !!user && user === snap.owner;
  const effBody = localEdit?.body ?? snap.body;
  const effTags = localEdit?.tags ?? snap.tags ?? [];

  const votes = meta?.votes ?? 0;
  const voted = meta?.voted ?? false;
  const comments = meta?.comments ?? 0;
  const tags = effTags.filter((tag) => tag && tag !== 'nsfw' && tag !== SNAP_TAG);

  return (
    <article className={`snap-card${autoOpenComments ? ' snap-card--highlighted' : ''}`} ref={cardRef}>
      <div className={`snap-card-head${feedMode || showAuthor ? ' snap-card-head--feed' : ''}`}>
        {/* In the home feed the snap is from any creator — show the author badge so
            the viewer can follow them right there; on a profile Community tab it's
            always that profile, so we omit it. */}
        {(feedMode || showAuthor) && (
          <AuthorBadge author={snap.owner} showFollow compact tabHint="community" />
        )}
        {feedMode && <span className="snap-feed-title">{t('profile.snaps.communitySnap')}</span>}
        <Link
          className="snap-time"
          to={feedMode ? `/p/${snap.owner}?tab=community` : `/post/${snap.owner}/${snap.permlink}`}
          title={feedMode ? t('profile.snaps.viewCommunity', { user: snap.owner }) : t('profile.snaps.viewPost')}
        >
          {hiveTime(snap.created)}
        </Link>
        {isOwn && !editing && (
          <button type="button" className="snap-menu-btn snap-edit-btn" onClick={() => setEditing(true)} title={t('profile.snaps.editPost')} aria-label={t('profile.snaps.editPost')}>
            <MdEdit />
          </button>
        )}
        {feedMode && (
          <SnapOptionsMenu owner={snap.owner} permlink={snap.permlink} onHidden={() => onRemove?.(snap)} />
        )}
      </div>

      {editing ? (
        <SnapEditForm
          owner={snap.owner}
          permlink={snap.permlink}
          initialBody={effBody}
          initialTags={effTags.filter((tag) => tag && tag !== SNAP_TAG && tag !== 'nsfw')}
          initialNsfw={effTags.includes('nsfw') || !!snap.nsfw}
          onCancel={() => setEditing(false)}
          onSaved={(edit) => { setLocalEdit(edit); setEditing(false); }}
        />
      ) : (
        <SnapBody
          body={effBody}
          maxVh={maxVh ?? (feedMode ? 0.15 : 0.33)}
          onReadMore={onOpenTab ? () => onOpenTab(snap.permlink) : undefined}
        />
      )}

      {!editing && tags.length > 0 && (
        <div className="snap-tags">
          {tags.map((tag) => <Link key={tag} to={`/t/${tag}`} className="snap-tag">{tag}</Link>)}
        </div>
      )}

      <div className="snap-actions">
        <div className="snap-vote">
          <UpvoteCount count={votes} voted={voted} onClick={() => setShowVote((v) => !v)} size={13} />
          {showVote && (
            <CommentVoteTooltip
              author={snap.owner}
              permlink={snap.permlink}
              showTooltip={showVote}
              setShowTooltip={setShowVote}
              weight={weight}
              setWeight={setWeight}
              voteValue={voteValue}
              setVoteValue={setVoteValue}
              accountData={voteData?.account || accountData}
              setAccountData={setAccountData}
              cachedDynamicProps={voteData?.dynProps || null}
              setActiveTooltipPermlink={() => {}}
              onVoteSuccess={onVoted}
              enableViewerTag={false}
              postCreatedAt={snap.created}
            />
          )}
        </div>
        <button
          type="button"
          className={`snap-action${showComments || commentsPopup ? ' active' : ''}`}
          onClick={() => (onOpenTab
            ? onOpenTab(snap.permlink, { openComments: true })
            : feedMode ? setCommentsPopup(true) : setShowComments((v) => !v))}
        >
          <BiCommentDetail />
          <span>{comments}</span>
        </button>
      </div>

      {/* Profile tab expands the thread inline; the feed opens a popup so the
          grid row doesn't stretch. autoFocus only on the card the visitor was
          actually routed here for — not every already-expanded thread. */}
      {showComments && !feedMode && (
        <SnapComments owner={snap.owner} permlink={snap.permlink} onCommented={onCommented} autoFocus={autoOpenComments} />
      )}
      {commentsPopup && (
        <SnapCommentsModal
          owner={snap.owner}
          permlink={snap.permlink}
          onClose={() => setCommentsPopup(false)}
          onCommented={onCommented}
        />
      )}
    </article>
  );
}

/**
 * The profile's "Community" tab. Everyone sees the owner's snaps; only the owner
 * (canPost) gets the composer.
 */
// `limit` renders only the newest N, and `hideEmpty` skips the empty-state
// block entirely — both for the Overview tab's preview row.
// `targetPermlink` + `openComments` land the visitor on one specific snap after
// being routed here from the Overview page's trailer/preview cards — see
// UserProfilePage's `?snap=`/`comments=1` query params.
// `onOpenTab`, when given, marks every card as an OVERVIEW preview (see SnapCard)
// — used only for the Overview page's own "Community" rail, never on the actual
// Community tab, where cards behave normally (expand/open inline).
//
// `community` switches to a Hive community's Discussion tab: the list is every
// author's snaps filed under that community, cards name their author (showAuthor),
// and the composer (still gated by canPost) files new posts there.
export default function CommunitySnaps({ user, community = '', canPost = false, limit = 0, hideEmpty = false, targetPermlink = null, openComments = false, onOpenTab = null }) {
  const { t } = useTranslation();
  const [optimistic, setOptimistic] = useState([]);
  const queryClient = useQueryClient();

  const { data, isLoading, refetch } = useQuery({
    queryKey: community ? ['community-discussion', community] : ['community-snaps', user],
    queryFn: () => (community ? fetchCommunitySnaps(community) : fetchSnaps(user)),
    enabled: !!(community || user),
    staleTime: 30_000,
  });

  const snaps = useMemo(() => {
    const fetched = data?.snaps || [];
    const seen = new Set(fetched.map((s) => `${s.owner}/${s.permlink}`));
    const extra = optimistic.filter((s) => (community || s.owner === user) && !seen.has(`${s.owner}/${s.permlink}`));
    return [...extra, ...fetched];
  }, [data?.snaps, optimistic, user, community]);

  const onPosted = (snap) => {
    setOptimistic((prev) => [snap, ...prev.filter((s) => s.permlink !== snap.permlink)]);
    setTimeout(() => refetch(), 4000);
    setTimeout(() => {
      refetch();
      // Refresh the tab-header count once the checker has indexed it.
      queryClient.invalidateQueries({ queryKey: ['community-snaps-count', user] });
    }, 12000);
  };

  return (
    <div className="community-snaps">
      {canPost && (
        <SnapComposer
          onPosted={onPosted}
          community={community}
          {...(community ? { placeholder: t('profile.snaps.discussionPlaceholder') } : {})}
        />
      )}

      {isLoading && snaps.length === 0 ? (
        <BarLoader />
      ) : snaps.length === 0 ? (
        hideEmpty ? null : (
          <div className="snap-empty">
            {community
              ? (canPost ? t('profile.snaps.emptyDiscussionCanPost') : t('profile.snaps.emptyDiscussion'))
              : (canPost ? t('profile.snaps.emptyOwn') : t('profile.snaps.empty'))}
          </div>
        )
      ) : (
        <div className="snap-list">
          {(limit > 0 ? snaps.slice(0, limit) : snaps)
            .map((s) => (
              <SnapCard
                key={s._id || `${s.owner}/${s.permlink}`}
                snap={s}
                showAuthor={!!community}
                onOpenTab={onOpenTab}
                autoOpenComments={openComments && !!targetPermlink && s.permlink === targetPermlink}
              />
            ))}
        </div>
      )}
    </div>
  );
}
