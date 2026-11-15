import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import DialogShell from '../modal/DialogShell';
import { Button, Field } from '../v2/ui';
import { fetchUserShortsWithDetails } from '../../hive-api/hiveApi';
import { broadcastViaThreespeak, broadcastWithAioha, getCurrentProvider, KeyTypes } from '../../hive-api/aioha';
import { playlistTypeFields } from '../../lib/playlistType';
import { SERIES_APPEND_POSITION, SERIES_META, seriesParts } from '../../lib/series';
import { toastIn } from '../../utils/toast';
import fallbackImg from '../../assets/image/speak.jpg';
import './Series.scss';

const toast = toastIn('Playlist');
const MAX_PICK = 50;
const SHORT_PAGES = 3;

/** The creator's Shorts, newest first: [{ author, permlink, title, thumb }] (the Hive permlink). */
async function myShorts(owner) {
  const out = [];
  for (let page = 1; page <= SHORT_PAGES; page += 1) {
    // eslint-disable-next-line no-await-in-loop
    const data = await fetchUserShortsWithDetails(owner, page, 20, true).catch(() => null);
    for (const s of data?.shorts || []) {
      const permlink = s.hivePermlink || s.permlink;
      if (!permlink) continue;
      out.push({ author: s.author || owner, permlink, title: s.heading || s.title || s.caption || '', thumb: s.thumbnailUrl || '' });
    }
    if (!data || !(data.page < data.totalPages)) break;
  }
  return out;
}

/** The ops for one series write: create (when `newId`) and every picked part, in order, at the end. */
export function seriesOps({ owner, newId = null, name = '', seriesId = null, parts }) {
  const id = newId || seriesId;
  const ops = [];
  if (newId) {
    const tf = playlistTypeFields('video');
    ops.push(['custom_json', {
      required_auths: [],
      required_posting_auths: [owner],
      id: '3speak_playlist_create',
      json: JSON.stringify({
        name, access: 'public', playlist_id: newId, type: tf.type,
        json_metadata: JSON.stringify({ ...tf.meta, ...SERIES_META }),
      }),
    }]);
  }
  for (const p of parts) {
    ops.push(['custom_json', {
      required_auths: [],
      required_posting_auths: [owner],
      id: '3speak_playlist_add',
      json: JSON.stringify({ playlist_id: id, author: p.author, permlink: p.permlink, position: SERIES_APPEND_POSITION }),
    }]);
  }
  return ops;
}

const broadcast = (ops) => (getCurrentProvider() ? broadcastViaThreespeak(ops) : broadcastWithAioha(ops, KeyTypes.Posting));
const newPlaylistId = () => ((typeof crypto !== 'undefined' && crypto.randomUUID)
  ? crypto.randomUUID()
  : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`);

/**
 * Make a series from your Shorts, or add parts to one (`series` given): pick
 * Shorts in the order they come, the numbers show the part each becomes, and one
 * transaction creates the series (a public video playlist marked series,
 * lib/series.js) and adds them at its end.
 */
export default function SeriesModal({ open, onClose, owner, series = null, onDone }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [picked, setPicked] = useState([]);
  const [busy, setBusy] = useState(false);
  const { data: shorts = [], isLoading } = useQuery({
    queryKey: ['series-my-shorts', owner],
    queryFn: () => myShorts(owner),
    enabled: !!open && !!owner,
    staleTime: 60 * 1000,
  });
  useEffect(() => {
    if (open) { setName(''); setPicked([]); }
  }, [open]);

  const have = useMemo(() => new Set(seriesParts(series).map((p) => `${p.author}/${p.permlink}`)), [series]);
  const choices = shorts.filter((s) => !have.has(`${s.author}/${s.permlink}`));
  const startAt = seriesParts(series).length;
  const key = (s) => `${s.author}/${s.permlink}`;
  const toggle = (s) => setPicked((list) => (list.some((p) => key(p) === key(s))
    ? list.filter((p) => key(p) !== key(s))
    : list.length >= MAX_PICK ? list : [...list, s]));

  const canSave = picked.length > 0 && (series || name.trim().length > 0) && !busy;
  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    try {
      const newId = series ? null : newPlaylistId();
      await broadcast(seriesOps({ owner, newId, name: name.trim(), seriesId: series?.id, parts: picked }));
      toast.success(series ? t('episodes.series.partsAdded') : t('episodes.series.created'));
      // The indexer needs a block or two.
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['myPlaylists', owner] });
        queryClient.invalidateQueries({ queryKey: ['userPlaylists'] });
        queryClient.invalidateQueries({ queryKey: ['playlist'] });
      }, 3000);
      onDone?.(newId || series.id);
      onClose?.();
    } catch (err) {
      toast.error(t('episodes.series.saveFailed', { error: err?.message || '' }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogShell
      open={open}
      onClose={onClose}
      busy={busy}
      title={series ? t('episodes.series.addTitle', { name: series.name }) : t('episodes.series.createTitle')}
      sub={t('episodes.series.pickHint')}
      footer={(
        <Button variant="primary" size={48} trailing="check" disabled={!canSave} loading={busy} onClick={save} data-testid="series-save">
          {series ? t('episodes.series.addButton') : t('episodes.series.createButton')}
        </Button>
      )}
    >
      <div className="series-create">
        {!series && (
          <Field
            label={t('episodes.series.name')}
            value={name}
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('episodes.series.namePlaceholder')}
            data-testid="series-name"
          />
        )}
        {isLoading ? (
          <p className="series-select__none">{t('common.status.loading')}</p>
        ) : choices.length === 0 ? (
          <p className="series-select__none">{t('episodes.series.noShorts')}</p>
        ) : (
          <ul className="series-create__list">
            {choices.map((s) => {
              const at = picked.findIndex((p) => key(p) === key(s));
              return (
                <li key={key(s)}>
                  <button
                    type="button"
                    className={`series-create__item${at >= 0 ? ' is-on' : ''}`}
                    aria-pressed={at >= 0}
                    onClick={() => toggle(s)}
                    data-testid="series-pick"
                  >
                    <span className="series-create__num num">{at >= 0 ? startAt + at + 1 : ''}</span>
                    <img src={s.thumb || fallbackImg} alt="" loading="lazy" onError={(e) => { e.currentTarget.src = fallbackImg; }} />
                    <span className="series-create__title">{s.title || s.permlink}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </DialogShell>
  );
}
