import { lazy, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Icon } from '../v2/Icon';
import { useAppStore } from '../../lib/store';
import { fetchClipIdeas } from '../../lib/clipIdeas';
import { fetchPlaySource } from '../../lib/videoData';
import { checkRemix, remixBlockedMessage } from '../../utils/remixChain';
import { toastIn } from '../../utils/toast';
import MountWhenOpened from '../common/LazyMount';
import './ShortsFromVideo.scss';

const EditorModal = lazy(() => import('../modal/EditorModal'));
const toast = toastIn('Video');

// The editor takes an http(s) source; an ipfs:// one goes through our gateway,
// as on the watch page.
const playableUrl = (url) => (url && url.startsWith('ipfs://') ? `https://hotipfs-3speak-1.b-cdn.net/ipfs/${url.slice(7)}` : url);

const REASON_ICON = { replay: 'replay', comments: 'forum', chat: 'chat', quote: 'format_quote' };

function mmss(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/**
 * "Shorts from this video": clip ranges for the creator's OWN long video, picked by
 * real viewers (lib/clipIdeas.js: replays, timestamped comments, chat, quotable
 * transcript lines), each with why it was picked, a preview and "Make a Short".
 *
 * Shown only to the video's owner (the checker answers nobody else either).
 *
 * On the watch page the player is right there: `onPreview(s)` plays the range and
 * `onMakeShort(s)` opens the editor on it (`previewing` is the range playing now).
 * Elsewhere (the profile's Stats tab) Preview links to the watch page at that
 * moment, and Make a Short opens the Shorts editor right here on the range (the
 * video's source looked up from the player), so the creator stays on the page.
 * The watch page is the Hive post: pass its permlink as `watchPermlink` when
 * `permlink` is 3Speak's own id; `title` names the clip in the editor.
 */
export default function ShortsFromVideo({ owner, permlink, watchPermlink = null, title = '', onPreview = null, onMakeShort = null, previewing = null, canMake = true }) {
  const { t, i18n } = useTranslation();
  const user = useAppStore((s) => s.user);
  const isOwner = !!user && !!owner && user.toLowerCase() === String(owner).toLowerCase();
  const isPremium = useAppStore((s) => s.isPremium);
  const [state, setState] = useState({ loading: true, data: null, error: false });
  const [editor, setEditor] = useState(null); // { url, start, end, chain } while the editor is open
  const [opening, setOpening] = useState(null); // the range being looked up

  const hivePermlink = watchPermlink || permlink;
  const openEditorHere = async (s) => {
    if (opening != null) return;
    setOpening(s.start);
    try {
      const { chain, blocked } = await checkRemix({ author: owner, permlink: hivePermlink }, { user, isPremium });
      if (blocked) { toast.info(remixBlockedMessage(blocked, t)); return; }
      const src = await fetchPlaySource(owner, hivePermlink);
      const url = playableUrl(src?.play_url);
      if (!url) { toast.error(t('watch.clip.noVideoUrl')); return; }
      setEditor({ url, start: s.start, end: s.end, chain });
    } catch {
      toast.error(t('watch.clip.noVideoUrl'));
    } finally {
      setOpening(null);
    }
  };

  useEffect(() => {
    if (!isOwner || !permlink) return undefined;
    let cancelled = false;
    setState({ loading: true, data: null, error: false });
    fetchClipIdeas(user, permlink, { lang: i18n.language })
      .then((data) => { if (!cancelled) setState({ loading: false, data, error: false }); })
      .catch(() => { if (!cancelled) setState({ loading: false, data: null, error: true }); });
    return () => { cancelled = true; };
  }, [isOwner, user, permlink, i18n.language]);

  if (!isOwner || !permlink) return null;
  // Not theirs after all, or a Short: nothing to suggest, no card.
  if (!state.loading && !state.error && (!state.data || state.data.short)) return null;

  const watchPath = `/@${owner}/${watchPermlink || permlink}`;
  const list = state.data?.suggestions || [];

  return (
    <section className="shorts-from-video" aria-busy={state.loading || undefined}>
      <div className="sfv-head">
        <h3 className="sfv-title"><Icon name="content_cut" size={18} />{t('clips.title')}</h3>
        <p className="sfv-sub">{t('clips.sub')}</p>
      </div>

      {state.loading && <div className="sfv-skeleton v2-skeleton" />}
      {state.error && <p className="sfv-empty">{t('clips.error')}</p>}
      {!state.loading && !state.error && list.length === 0 && <p className="sfv-empty">{t('clips.empty')}</p>}

      {list.length > 0 && (
        <ol className="sfv-list">
          {list.map((s) => {
            const quote = s.reasons.find((r) => r.kind === 'quote' && r.text);
            const playing = previewing != null && previewing === s.start;
            const range = t('clips.range', { start: mmss(s.start), end: mmss(s.end) });
            return (
              <li key={`${s.start}-${s.end}`} className={`sfv-item${playing ? ' is-playing' : ''}`}>
                <div className="sfv-when">
                  <b>{range}</b>
                  <span>{t('clips.seconds', { seconds: s.end - s.start })}</span>
                </div>
                <div className="sfv-reasons">
                  {s.reasons.map((r) => (
                    <span key={r.kind} className="sfv-reason">
                      <Icon name={REASON_ICON[r.kind] || 'star'} size={14} />
                      {r.kind === 'comments' ? t('clips.reasons.comments', { count: r.count || 1 }) : t(`clips.reasons.${r.kind}`)}
                    </span>
                  ))}
                </div>
                {quote && <q className="sfv-quote">{quote.text}</q>}
                <div className="sfv-actions">
                  {onPreview ? (
                    <button type="button" className="v2-btn v2-btn--secondary h32" onClick={() => onPreview(s)} aria-pressed={playing}>
                      <Icon name={playing ? 'stop' : 'play_arrow'} size={16} />
                      <span className="v2-btn__label">{playing ? t('clips.stop') : t('clips.preview')}</span>
                    </button>
                  ) : (
                    <Link className="v2-btn v2-btn--secondary h32" to={`${watchPath}?t=${s.start}`} aria-label={`${t('clips.preview')} ${range}`}>
                      <Icon name="play_arrow" size={16} />
                      <span className="v2-btn__label">{t('clips.preview')}</span>
                    </Link>
                  )}
                  {canMake && (onMakeShort ? (
                    <button type="button" className="v2-btn v2-btn--primary h32" onClick={() => onMakeShort(s)}>
                      <Icon name="content_cut" size={16} />
                      <span className="v2-btn__label">{t('clips.makeShort')}</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="v2-btn v2-btn--primary h32"
                      onClick={() => openEditorHere(s)}
                      disabled={opening != null}
                      aria-label={`${t('clips.makeShort')} ${range}`}
                    >
                      <Icon name={opening === s.start ? 'progress_activity' : 'content_cut'} size={16} className={opening === s.start ? 'v2-spin' : undefined} />
                      <span className="v2-btn__label">{t('clips.makeShort')}</span>
                    </button>
                  ))}
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {list.length > 0 && <p className="sfv-foot">{t('clips.foot')}</p>}
      <MountWhenOpened when={!!editor} name="shorts editor">
        {editor && (
          <EditorModal
            isOpen
            onClose={() => setEditor(null)}
            videoUrl={editor.url}
            videoName={`${owner} - ${title || hivePermlink} (clip)`}
            videoType="video"
            clipStart={editor.start}
            clipEnd={editor.end}
            originalAuthor={owner}
            originalPermlink={hivePermlink}
            remixChain={editor.chain}
          />
        )}
      </MountWhenOpened>
    </section>
  );
}
