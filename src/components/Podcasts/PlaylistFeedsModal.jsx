import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MdAdd, MdCheck, MdClose, MdSearch } from 'react-icons/md';
import ModalHeader from '../ModalHeader/ModalHeader';
import useDialog from '../../hooks/useDialog';
import { toastIn } from '../../utils/toast';
import { updatePlaylist } from '../../utils/playlistOperations';
import { resolveFeed, searchPodcasts, followErrorText, feedKey } from '../../lib/podcasts';
import {
  MAX_PLAYLIST_FEEDS, MAX_PLAYLIST_JSON, playlistFeedsOf, withPlaylistFeeds, isOwnPlaylistFeed,
} from '../../lib/playlistFeeds';
import PodcastArt from './PodcastArt';
import './PlaylistFeedsModal.scss';

const toast = toastIn('Playlist');

const looksLikeUrl = (s) => /^https?:\/\//i.test(s) || /^[\w-]+(\.[\w-]+)+\/\S*/.test(s);
const withScheme = (s) => (/^https?:\/\//i.test(s) ? s : `https://${s}`);

/**
 * The owner's editor for the outside shows of a playlist: search a directory or
 * paste a feed / Apple Podcasts / website link, check it with the checker, and
 * save the list into the playlist's json_metadata (one playlist update on chain).
 *
 * Props:
 *   playlistId, user
 *   jsonMeta   the playlist's json_metadata as an object (everything in it is kept)
 *   cards      the shows as the checker knows them ({ url, title, art }), for covers
 *   onClose, onSaved
 */
export default function PlaylistFeedsModal({ playlistId, user, jsonMeta, cards = [], onClose, onSaved }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(() => playlistFeedsOf(jsonMeta));
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [checking, setChecking] = useState('');
  const [saving, setSaving] = useState(false);
  const dialog = useDialog(saving ? undefined : onClose);

  const artByKey = useMemo(() => new Map(cards.map((c) => [feedKey(c.url), c.art])), [cards]);
  const [addedArt, setAddedArt] = useState(() => new Map());
  const draftKeys = useMemo(() => new Set(draft.map((f) => feedKey(f.url))), [draft]);
  const original = useMemo(() => JSON.stringify(playlistFeedsOf(jsonMeta)), [jsonMeta]);
  const changed = JSON.stringify(draft) !== original;
  const full = draft.length >= MAX_PLAYLIST_FEEDS;

  // Search as you type (a link is checked on Add instead).
  const q = query.trim();
  const isLink = looksLikeUrl(q);
  const searchable = !isLink && q.length >= 2;
  useEffect(() => {
    if (!searchable) return undefined;
    let live = true;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const found = await searchPodcasts(q);
        if (live) setResults(found.results || []);
      } catch {
        if (live) setResults([]);
      } finally {
        if (live) setSearching(false);
      }
    }, 400);
    return () => { live = false; clearTimeout(timer); };
  }, [q, searchable]);

  const add = async (rawUrl) => {
    const url = withScheme(String(rawUrl || '').trim());
    if (!url || checking) return;
    if (full) { toast.error(t('playlists.feeds.limit', { max: MAX_PLAYLIST_FEEDS })); return; }
    if (isOwnPlaylistFeed(url, playlistId)) { toast.error(t('playlists.feeds.ownFeed')); return; }
    setChecking(url);
    try {
      const res = await resolveFeed(user, url);
      if (!res.success || !res.feed?.url) {
        toast.error(res.code === 'private_feed' ? t('playlists.feeds.privateFeed') : followErrorText(res.code, res));
        return;
      }
      const key = feedKey(res.feed.url);
      if (draftKeys.has(key)) { toast.error(t('playlists.feeds.already')); return; }
      setDraft((d) => [...d, { url: res.feed.url, ...(res.feed.title ? { title: res.feed.title.slice(0, 100) } : {}) }]);
      if (res.feed.art) setAddedArt((m) => new Map(m).set(key, res.feed.art));
      if (isLink) setQuery('');
    } catch (err) {
      toast.error(err.message || followErrorText());
    } finally {
      setChecking('');
    }
  };

  const remove = (url) => setDraft((d) => d.filter((f) => f.url !== url));

  const save = async () => {
    const json = JSON.stringify(withPlaylistFeeds(jsonMeta, draft));
    if (new TextEncoder().encode(json).length > MAX_PLAYLIST_JSON) { toast.error(t('playlists.feeds.tooBig')); return; }
    setSaving(true);
    try {
      await updatePlaylist(playlistId, { json_metadata: json });
      toast.success(t('playlists.feeds.saved'));
      onSaved?.(json);
      onClose();
    } catch (err) {
      toast.error(t('playlists.feeds.saveFailed', { error: err.message || '' }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="pl-feeds-overlay" onClick={saving ? undefined : onClose}>
      <div className="pl-feeds-modal" {...dialog.props} onClick={(e) => e.stopPropagation()}>
        <ModalHeader title={t('playlists.feeds.title')} titleId={dialog.titleId} onClose={saving ? undefined : onClose} />
        <p className="pl-feeds-intro">{t('playlists.feeds.intro')}</p>

        <form className="pl-feeds-search" onSubmit={(e) => { e.preventDefault(); if (isLink) add(q); }}>
          <label className="pod-field-row">
            <MdSearch className="pod-field-icon" size={18} />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('playlists.feeds.searchPlaceholder')}
              aria-label={t('playlists.feeds.searchLabel')}
              autoComplete="off"
              disabled={saving}
            />
          </label>
          {isLink && (
            <button type="submit" className="pod-btn pod-btn--primary" disabled={!!checking || saving || full}>
              <MdAdd size={16} /> {checking ? t('playlists.feeds.checking') : t('playlists.feeds.add')}
            </button>
          )}
        </form>

        {searchable && (
          <div className="pl-feeds-results">
            {searching && !results?.length && <p className="pl-feeds-note">{t('playlists.feeds.searching')}</p>}
            {results && !searching && results.length === 0 && <p className="pl-feeds-note">{t('playlists.feeds.noResults')}</p>}
            {(results || []).slice(0, 8).map((r) => {
              const inList = draftKeys.has(feedKey(r.url));
              return (
                <div key={r.url} className="pl-feeds-row">
                  <PodcastArt art={r.art} px={128} className="pl-feeds-art" />
                  <div className="pl-feeds-row-body">
                    <span className="pl-feeds-row-title" title={r.title}>{r.title}</span>
                    {r.author && <span className="pl-feeds-row-meta">{r.author}</span>}
                  </div>
                  {inList ? (
                    <span className="pl-feeds-in"><MdCheck size={15} /> {t('playlists.feeds.inList')}</span>
                  ) : (
                    <button type="button" className="pod-btn" disabled={!!checking || saving || full} onClick={() => add(r.url)}>
                      <MdAdd size={16} /> {checking === withScheme(r.url) ? t('playlists.feeds.checking') : t('playlists.feeds.add')}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <h3 className="pl-feeds-subtitle">
          {t('playlists.feeds.inPlaylist')}
          <span className="pl-feeds-count">{draft.length}/{MAX_PLAYLIST_FEEDS}</span>
        </h3>
        {draft.length === 0 ? (
          <p className="pl-feeds-note">{t('playlists.feeds.none')}</p>
        ) : (
          <ul className="pl-feeds-list">
            {draft.map((f) => {
              const key = feedKey(f.url);
              return (
                <li key={f.url} className="pl-feeds-row">
                  <PodcastArt art={addedArt.get(key) || artByKey.get(key)} px={128} className="pl-feeds-art" />
                  <div className="pl-feeds-row-body">
                    <span className="pl-feeds-row-title" title={f.title || f.url}>{f.title || f.url}</span>
                    {f.title && <span className="pl-feeds-row-meta" title={f.url}>{f.url}</span>}
                  </div>
                  <button
                    type="button"
                    className="pl-feeds-remove"
                    onClick={() => remove(f.url)}
                    disabled={saving}
                    aria-label={t('playlists.feeds.remove', { title: f.title || f.url })}
                    title={t('playlists.feeds.remove', { title: f.title || f.url })}
                  >
                    <MdClose size={16} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <div className="pl-feeds-actions">
          <button type="button" className="pod-btn" onClick={onClose} disabled={saving}>{t('common.actions.cancel')}</button>
          <button type="button" className="pod-btn pod-btn--primary" onClick={save} disabled={!changed || saving || !!checking}>
            {saving ? t('playlists.view.saving') : t('playlists.view.saveChanges')}
          </button>
        </div>
      </div>
    </div>
  );
}
