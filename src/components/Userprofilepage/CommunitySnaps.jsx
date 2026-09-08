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
  fetchSnaps, SNAP_TAG, MAX_USER_TAGS, recordSnapInteraction, updateSnap,
  hideSnap, unhideSnap, hideSnapCreator, unhideSnapCreator,
} from '../../lib/snaps';
import MarkdownComposer from '../studio/MarkdownComposer';
import { getHiveRenderer } from '../../lib/hiveRenderer';
import { getHiveClient } from '../../utils/hiveNode';
import { getVotePower, getDynamicProps } from '../../utils/hiveUtils';
import { commentWithAioha } from '../../hive-api/aioha';
import { useAppStore } from '../../lib/store';
import SnapComposer from './SnapComposer';
import EmojiGifPicker from '../common/EmojiGifPicker/EmojiGifPicker';
import { insertAtCursor, gifMarkdown } from '../../utils/composerInsert';
import UpvoteCount from '../UpvoteCount/UpvoteCount';
import AuthorBadge from '../AuthorBadge/AuthorBadge';
import CommentVoteTooltip from '../tooltip/CommentVoteTooltip';
import BarLoader from '../Loader/BarLoader';
import './CommunitySnaps.scss';

// Every toast from this module is headed "Post"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Post');

dayjs.extend(relativeTime);

const hiveTime = (t) => (t ? dayjs(/Z$/.test(String(t)) ? t : `${t}Z`).fromNow() : '');

async function fetchReplies(author, permlink) {
  const replies = await getHiveClient().call('condenser_api', 'get_content_replies', [author, permlink]);
  return (replies || []).sort((a, b) => new Date(a.created) - new Date(b.created));
}

// Body with "read more"/"show less" — a very long snap is capped at a fraction of
// the viewport (`maxVh`), but only when it actually overflows (no fade on short
// posts). The feed uses a tighter cap than the profile tab.
// `onReadMore`, when given, replaces the expand-in-place toggle with a plain
// navigation (used on the Overview page, where the card is too short a preview
// to expand inline — "Read more" instead jumps to the full Community tab).
function SnapBody({ body, maxVh = 0.33, onReadMore }) {
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
          {onReadMore ? 'Read more' : (expanded ? 'Show less' : 'Read more')}
        </button>
      )}
    </div>
  );
}

// Reply composer — reused for the snap itself and for any comment (nested replies).
// onSigned fires the moment the broadcast succeeds (for instant counters);
// onPosted fires ~3s later, when the RPC can actually return the new reply.
function ReplyBox({ parentAuthor, parentPermlink, onPosted, onSigned, autoFocus = false }) {
  const user = useAppStore((s) => s.user);
  const [reply, setReply] = useState('');
  const [posting, setPosting] = useState(false);
  const replyRef = useRef(null);
  if (!user) return null;

  const submit = async () => {
    const text = reply.trim();
    if (!text) return;
    setPosting(true);
    try {
      const rp = `re-${parentPermlink}-${Date.now() % 1000000}`.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 250);
      await commentWithAioha(parentAuthor, parentPermlink, rp, '', text, { app: '3speak/snap', format: 'markdown' }, null);
      toast.success('Comment posted!');
      onSigned?.(); // instant — counters bump right after signing
      setReply('');
      setTimeout(() => onPosted?.(), 3000);
    } catch (e) {
      toast.error(e?.message || 'Could not post the comment');
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="snap-reply-box">
      <textarea
        ref={replyRef}
        placeholder="Write a comment…"
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
          {posting ? 'Posting…' : 'Reply'}
        </button>
      </div>
    </div>
  );
}

// A single comment — recursive, so replies-on-replies work.
function SnapComment({ comment }) {
  const user = useAppStore((s) => s.user);
  const [html, setHtml] = useState('');
  const [replying, setReplying] = useState(false);
  const [showReplies, setShowReplies] = useState(false);
  const childCount = comment.children ?? 0;

  useEffect(() => {
    let alive = true;
    getHiveRenderer().then((render) => { if (alive) { try { setHtml(render(comment.body || '')); } catch { setHtml(''); } } });
    return () => { alive = false; };
  }, [comment.body]);

  const { data: children = [], refetch } = useQuery({
    queryKey: ['snap-replies', comment.author, comment.permlink],
    queryFn: () => fetchReplies(comment.author, comment.permlink),
    enabled: showReplies,
    staleTime: 30_000,
  });

  return (
    <li className="snap-comment">
      <div className="snap-comment-head">
        <Link to={`/p/${comment.author}`} className="snap-comment-author">@{comment.author}</Link>
        <span className="snap-comment-time">{hiveTime(comment.created)}</span>
      </div>
      <div className="snap-comment-body markdown-body" dangerouslySetInnerHTML={{ __html: html }} />
      <div className="snap-comment-actions">
        {user && (
          <button type="button" onClick={() => setReplying((v) => !v)}>{replying ? 'Cancel' : 'Reply'}</button>
        )}
        {childCount > 0 && (
          <button type="button" onClick={() => setShowReplies((v) => !v)}>
            {showReplies ? 'Hide replies' : `${childCount} ${childCount > 1 ? 'replies' : 'reply'}`}
          </button>
        )}
      </div>
      {replying && (
        <ReplyBox
          parentAuthor={comment.author}
          parentPermlink={comment.permlink}
          autoFocus
          onPosted={() => { setReplying(false); setShowReplies(true); refetch(); }}
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
  const { data: comments = [], isLoading, refetch } = useQuery({
    queryKey: ['snap-comments', owner, permlink],
    queryFn: () => fetchReplies(owner, permlink),
    staleTime: 30_000,
  });

  return (
    <div className="snap-comments">
      <ReplyBox parentAuthor={owner} parentPermlink={permlink} onSigned={onCommented} onPosted={refetch} autoFocus={autoFocus} />
      {isLoading ? (
        <div className="snap-comments-status">Loading comments…</div>
      ) : comments.length === 0 ? (
        <div className="snap-comments-status">No comments yet.</div>
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
      toast('Post hidden', { action: { label: 'Undo', onClick: () => unhideSnap(user, owner, permlink).catch(() => {}) } });
    } catch { toast.error('Could not hide the post'); }
  };
  const hideCreator = async () => {
    setOpen(false);
    onHidden?.();
    try {
      await hideSnapCreator(user, owner);
      toast(`Hiding @${owner}'s community posts`, { action: { label: 'Undo', onClick: () => unhideSnapCreator(user, owner).catch(() => {}) } });
    } catch { toast.error('Could not hide the creator'); }
  };

  return (
    <>
      <button ref={btnRef} type="button" className="snap-menu-btn" onClick={toggle} aria-label="Post options">
        <MdMoreVert />
      </button>
      {open && createPortal(
        <>
          <div className="snap-menu-backdrop" onClick={() => setOpen(false)} />
          <div className="snap-menu" style={{ top: pos.top, left: pos.left }}>
            <button type="button" onClick={hidePost}>Not interested</button>
            <button type="button" onClick={hideCreator}>Don’t show this creator</button>
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
  const user = useAppStore((s) => s.user);
  const [body, setBody] = useState(initialBody || '');
  const [tags, setTags] = useState(initialTags || []);
  const [tagInput, setTagInput] = useState('');
  const [nsfw, setNsfw] = useState(!!initialNsfw);
  const [saving, setSaving] = useState(false);

  const addTag = (raw) => {
    const t = String(raw || '').toLowerCase().replace(/^#/, '').trim();
    if (!t || t === SNAP_TAG || tags.includes(t)) return;
    if (tags.length >= MAX_USER_TAGS) { toast.error(`Up to ${MAX_USER_TAGS} tags`); return; }
    setTags((prev) => [...prev, t]);
  };
  const onTagKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === ',') { e.preventDefault(); addTag(tagInput); setTagInput(''); }
    else if (e.key === 'Backspace' && !tagInput && tags.length) setTags(tags.slice(0, -1));
  };
  const removeTag = (t) => setTags(tags.filter((x) => x !== t));

  const save = async () => {
    const text = body.trim();
    if (!text) { toast.error('Write something first'); return; }
    if (!user || user !== owner) { toast.error('Only the author can edit this post'); return; }
    setSaving(true);
    try {
      // Don't lose a half-typed tag left in the input.
      const pending = tagInput.trim() ? [...tags, tagInput.trim().toLowerCase().replace(/^#/, '')] : tags;
      await updateSnap({ user, permlink, body: text, tags: pending, nsfw });
      toast.success('Post updated!');
      onSaved({ body: text, tags: [SNAP_TAG, ...pending, ...(nsfw ? ['nsfw'] : [])] });
    } catch (e) {
      toast.error(e?.message || 'Could not update the post');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="snap-composer snap-edit-form">
      <MarkdownComposer value={body} onChange={setBody} placeholder="Edit your community post…" previewContext="snap" />
      <div className="snap-composer-row">
        <input
          className="snap-tags-input"
          placeholder={tags.length >= MAX_USER_TAGS ? 'Tag limit reached' : 'Add a tag, then space or enter…'}
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
        <span className="snap-tag-chip built-in" title="Added to every community post">{SNAP_TAG}</span>
        {tags.map((t) => (
          <span key={t} className="snap-tag-chip">
            {t}
            <button type="button" onClick={() => removeTag(t)} aria-label={`Remove ${t}`}><MdClose /></button>
          </span>
        ))}
        <span className="snap-tag-count">{tags.length}/{MAX_USER_TAGS}</span>
      </div>
      <div className="snap-composer-actions">
        <button type="button" className="snap-cancel-btn" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="button" className="snap-post-btn" disabled={saving || !body.trim()} onClick={save}>
          {saving ? 'Saving…' : 'Save changes'}
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
          <span>Comments on @{owner}’s post</span>
          <button type="button" onClick={onClose} aria-label="Close"><MdClose /></button>
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
export function SnapCard({ snap, feedMode = false, onRemove, onOpenTab, maxVh, autoOpenComments = false }) {
  const user = useAppStore((s) => s.user);
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
    queryKey: ['snap-meta', snap.owner, snap.permlink],
    queryFn: async () => {
      const post = await client.call('condenser_api', 'get_content', [snap.owner, snap.permlink]);
      const av = post?.active_votes || [];
      return {
        votes: av.filter((v) => Number(v.percent) > 0).length,
        comments: post?.children ?? 0,
        voted: !!user && av.some((v) => v.voter === user && Number(v.percent) > 0),
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
  const tags = effTags.filter((t) => t && t !== 'nsfw' && t !== SNAP_TAG);

  return (
    <article className={`snap-card${autoOpenComments ? ' snap-card--highlighted' : ''}`} ref={cardRef}>
      <div className={`snap-card-head${feedMode ? ' snap-card-head--feed' : ''}`}>
        {/* In the home feed the snap is from any creator — show the author badge so
            the viewer can follow them right there; on a profile Community tab it's
            always that profile, so we omit it. */}
        {feedMode && (
          <AuthorBadge author={snap.owner} showFollow compact tabHint="community" />
        )}
        {feedMode && <span className="snap-feed-title">Community snap</span>}
        <Link
          className="snap-time"
          to={feedMode ? `/p/${snap.owner}?tab=community` : `/post/${snap.owner}/${snap.permlink}`}
          title={feedMode ? `View @${snap.owner}'s community` : 'View post'}
        >
          {hiveTime(snap.created)}
        </Link>
        {isOwn && !editing && (
          <button type="button" className="snap-menu-btn snap-edit-btn" onClick={() => setEditing(true)} title="Edit post" aria-label="Edit post">
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
          initialTags={effTags.filter((t) => t && t !== SNAP_TAG && t !== 'nsfw')}
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
          {tags.map((t) => <Link key={t} to={`/t/${t}`} className="snap-tag">{t}</Link>)}
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
export default function CommunitySnaps({ user, canPost = false, limit = 0, hideEmpty = false, targetPermlink = null, openComments = false, onOpenTab = null }) {
  const [optimistic, setOptimistic] = useState([]);
  const queryClient = useQueryClient();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['community-snaps', user],
    queryFn: () => fetchSnaps(user),
    enabled: !!user,
    staleTime: 30_000,
  });

  const snaps = useMemo(() => {
    const fetched = data?.snaps || [];
    const seen = new Set(fetched.map((s) => s.permlink));
    const extra = optimistic.filter((s) => s.owner === user && !seen.has(s.permlink));
    return [...extra, ...fetched];
  }, [data?.snaps, optimistic, user]);

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
      {canPost && <SnapComposer onPosted={onPosted} />}

      {isLoading && snaps.length === 0 ? (
        <BarLoader />
      ) : snaps.length === 0 ? (
        hideEmpty ? null : (
          <div className="snap-empty">
            {canPost ? 'No community posts yet — share your first update above.' : 'No community posts yet.'}
          </div>
        )
      ) : (
        <div className="snap-list">
          {(limit > 0 ? snaps.slice(0, limit) : snaps)
            .map((s) => (
              <SnapCard
                key={s._id || `${s.owner}/${s.permlink}`}
                snap={s}
                onOpenTab={onOpenTab}
                autoOpenComments={openComments && !!targetPermlink && s.permlink === targetPermlink}
              />
            ))}
        </div>
      )}
    </div>
  );
}
