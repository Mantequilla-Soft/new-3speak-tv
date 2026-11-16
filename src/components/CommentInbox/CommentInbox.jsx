// Comment inbox (profile tab "Comments", own profile only): every comment people
// left for the creator across all their posts, unanswered first. Reply inline,
// reply with a video (the comment composer's React tab, the comment as parent),
// or mark one done. Data: lib/commentInbox.js (checker, from HafSQL).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button, Chip, EmptyState, Segmented, StatusPill } from '../v2/ui';
import HiveAvatar from '../HiveAvatar/HiveAvatar';
import TimeAgo from '../TimeAgo/TimeAgo';
import MarkdownView from '../common/MarkdownView';
import ReactVideoTab from '../ReactVideoModal/ReactVideoModal';
import { getHiveRenderer } from '../../lib/hiveRenderer';
import { stripTimestampEmbeds } from '../../utils/timestamps';
import { commentWithAioha } from '../../hive-api/aioha';
import { toastIn } from '../../utils/toast';
import { fetchCommentInbox, setCommentDone, filterInbox, flagCounts, INBOX_FLAGS } from '../../lib/commentInbox';
import './CommentInbox.scss';

const toast = toastIn('Comment');
// Comments drawn at once (each one is rendered Markdown); Show more adds as many.
export const INBOX_PAGE = 30;
const FLAG_ICONS = { question: 'help', firstTime: 'person_add', supporter: 'favorite' };

// A comment's body as HTML, rendered once it is on screen.
function useRendered(body) {
  const [html, setHtml] = useState('');
  useEffect(() => {
    let cancelled = false;
    getHiveRenderer()
      // The "replied to 0:42" link stays text: rendered, it is a whole video embed.
      .then((render) => { if (!cancelled) setHtml(render(stripTimestampEmbeds(body))); })
      .catch(() => { if (!cancelled) setHtml(''); });
    return () => { cancelled = true; };
  }, [body]);
  return html;
}

function InboxItem({ user, item, onAnswered, onDone }) {
  const { t } = useTranslation();
  const html = useRendered(item.body);
  const [mode, setMode] = useState(null); // null | 'reply' | 'video'
  const [text, setText] = useState('');
  const [posting, setPosting] = useState(false);
  const postUrl = `/@${user}/${item.rootPermlink}`;
  const title = item.rootTitle || item.rootPermlink;

  const send = async () => {
    const body = text.trim();
    if (!body || posting) return;
    setPosting(true);
    try {
      const result = await commentWithAioha(
        item.author,
        item.permlink,
        `re-${item.permlink}-${Date.now()}`.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 255),
        '',
        body,
        { app: '3speak/new-version' },
      );
      if (!result?.success) throw new Error(result?.error || 'failed');
      toast.success(t('creator.inbox.replied'));
      setText('');
      setMode(null);
      onAnswered(item);
    } catch {
      toast.error(t('creator.inbox.replyFailed'));
    } finally {
      setPosting(false);
    }
  };

  return (
    <article className={`ci-item${item.done ? ' is-done' : ''}`}>
      <div className="ci-head">
        <Link to={`/@${item.author}`} className="ci-avatar" aria-hidden="true" tabIndex={-1}>
          <HiveAvatar username={item.author} size="small" alt="" />
        </Link>
        <div className="ci-who">
          <span className="ci-line">
            <Link to={`/@${item.author}`} className="ci-author">@{item.author}</Link>
            <span className="ci-time"><TimeAgo date={item.created} short compact /></span>
          </span>
          <span className="ci-on">
            {item.onPost ? t('creator.inbox.onPost') : t('creator.inbox.onReply')}{' '}
            <Link to={postUrl} className="ci-post">{title}</Link>
          </span>
        </div>
        <div className="ci-flags">
          {item.answered && <StatusPill tone="muted" caps={false} icon="check">{t('creator.inbox.answered')}</StatusPill>}
          {INBOX_FLAGS.filter((f) => item[f]).map((f) => (
            <StatusPill key={f} tone={f === 'supporter' ? 'accent' : 'cyan'} caps={false} icon={FLAG_ICONS[f]}>{t(`creator.inbox.flags.${f}`)}</StatusPill>
          ))}
        </div>
      </div>

      <MarkdownView html={html} className="ci-body" />

      <div className="ci-actions">
        <Button size={36} icon="reply" variant={mode === 'reply' ? 'primary' : 'secondary'} aria-expanded={mode === 'reply'} onClick={() => setMode(mode === 'reply' ? null : 'reply')}>
          {t('creator.inbox.reply')}
        </Button>
        <Button size={36} icon="videocam" variant={mode === 'video' ? 'primary' : 'secondary'} aria-expanded={mode === 'video'} onClick={() => setMode(mode === 'video' ? null : 'video')}>
          {t('creator.inbox.replyVideo')}
        </Button>
        <Button size={36} icon={item.done ? 'undo' : 'done'} variant="ghost" onClick={() => onDone(item, !item.done)}>
          {item.done ? t('creator.inbox.undone') : t('creator.inbox.markDone')}
        </Button>
      </div>

      {mode === 'reply' && (
        <div className="ci-composer">
          <textarea
            className="v2-input ci-textarea"
            value={text}
            rows={3}
            autoFocus
            disabled={posting}
            aria-label={t('creator.inbox.replyTo', { author: item.author })}
            placeholder={t('creator.inbox.replyTo', { author: item.author })}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(); }}
          />
          <div className="ci-composer-actions">
            <Button size={36} variant="ghost" onClick={() => setMode(null)}>{t('common.actions.cancel')}</Button>
            <Button size={36} variant="primary" icon="send" loading={posting} disabled={!text.trim()} onClick={send}>{t('creator.inbox.send')}</Button>
          </div>
        </div>
      )}
      {mode === 'video' && (
        <div className="ci-react">
          <ReactVideoTab
            author={item.author}
            permlink={item.permlink}
            currentTime={0}
            onPosted={() => { setMode(null); onAnswered(item); }}
          />
        </div>
      )}
    </article>
  );
}

export default function CommentInbox({ user }) {
  const { t } = useTranslation();
  const [items, setItems] = useState(null);
  const [days, setDays] = useState(90);
  const [error, setError] = useState(false);
  const [view, setView] = useState('unanswered');
  const [flags, setFlags] = useState([]);
  const [limit, setLimit] = useState(INBOX_PAGE);
  // Another view or filter starts from the first page again.
  useEffect(() => { setLimit(INBOX_PAGE); }, [view, flags]);

  const load = useCallback(() => {
    setError(false);
    setItems(null);
    fetchCommentInbox(user)
      .then((r) => { setItems(r.items); setDays(r.days); })
      .catch(() => setError(true));
  }, [user]);
  useEffect(() => { load(); }, [load]);

  const update = (it, patch) => setItems((list) => (list || []).map((x) => (x.author === it.author && x.permlink === it.permlink ? { ...x, ...patch } : x)));
  const onAnswered = (it) => update(it, { answered: true });
  const onDone = async (it, done) => {
    update(it, { done });
    try {
      await setCommentDone(user, it.author, it.permlink, done);
      if (done) toast.success(t('creator.inbox.doneToast'), { action: { label: t('creator.inbox.undone'), onClick: () => onDone(it, false) } });
    } catch {
      update(it, { done: !done });
      toast.error(t('creator.inbox.doneFailed'));
    }
  };

  const shown = useMemo(() => filterInbox(items, { view, flags }), [items, view, flags]);
  const counts = useMemo(() => flagCounts(items, view), [items, view]);
  const viewCount = (v) => filterInbox(items, { view: v }).length;
  const toggle = (f) => setFlags((cur) => (cur.includes(f) ? cur.filter((x) => x !== f) : [...cur, f]));

  return (
    <section className="comment-inbox" aria-label={t('creator.inbox.title')}>
      <header className="ci-top">
        <h2 className="ci-title">{t('creator.inbox.title')}</h2>
        <p className="ci-sub">{t('creator.inbox.sub', { count: days })}</p>
      </header>

      <div className="ci-filters">
        <Segmented
          className="ci-seg"
          block={false}
          value={view}
          onChange={setView}
          label={t('creator.inbox.title')}
          options={['unanswered', 'all', 'done'].map((v) => ({ value: v, label: t(`creator.inbox.views.${v}`), count: items ? viewCount(v) : undefined }))}
        />
        <div className="ci-chips" role="group" aria-label={t('creator.inbox.filtersLabel')}>
          {INBOX_FLAGS.map((f) => (
            <Chip key={f} size={28} icon={FLAG_ICONS[f]} selected={flags.includes(f)} count={items ? counts[f] : undefined} onClick={() => toggle(f)}>
              {t(`creator.inbox.flags.${f}`)}
            </Chip>
          ))}
        </div>
      </div>

      {error ? (
        <EmptyState icon="cloud_off" title={t('creator.inbox.error')} action={<Button size={36} icon="refresh" onClick={load}>{t('creator.inbox.retry')}</Button>} />
      ) : !items ? (
        <div className="ci-list" aria-busy="true">
          {[0, 1, 2].map((i) => <div key={i} className="ci-skeleton v2-skeleton" />)}
        </div>
      ) : shown.length === 0 ? (
        <EmptyState icon="forum" title={view === 'unanswered' && !flags.length ? t('creator.inbox.allAnswered') : t('creator.inbox.empty')} />
      ) : (
        <div className="ci-list">
          {shown.slice(0, limit).map((it) => (
            <InboxItem key={`${it.author}/${it.permlink}`} user={user} item={it} onAnswered={onAnswered} onDone={onDone} />
          ))}
          {shown.length > limit && (
            <Button size={36} variant="secondary" icon="expand_more" className="ci-more" onClick={() => setLimit((n) => n + INBOX_PAGE)}>
              {t('common.actions.showMore')}
            </Button>
          )}
        </div>
      )}
      <p className="ci-foot">{t('creator.inbox.supportersNote')}</p>
    </section>
  );
}
