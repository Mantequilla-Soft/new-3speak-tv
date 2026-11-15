import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Icon } from '../components/v2/Icon';
import { Button, Segmented, EmptyState } from '../components/v2/ui';
import Card3 from '../components/Cards/Card3';
import { useAppStore } from '../lib/store';
import { fetchSound, fetchTrendingSounds, soundCredit, isSoundId } from '../lib/sounds';
import { videoAudioTrack, playVideoAsAudio } from '../lib/videoAsAudio';
import { FEATURE_EDITOR } from '../utils/config';
import { creatorKey, getCreatorSettings, isUploadBlocked } from '../utils/creatorSettings';
import { useSupportBlock } from '../lib/supportBlockStore';
import { fixVideoThumbnail, fallbackImg } from '../utils/fixThumbnails';
import { formatNumber } from '../i18n';
import { toastIn } from '../utils/toast';
import './SoundPage.scss';

const toast = toastIn('Shorts');

// A Short of the checker's list as a card of the Shorts grid (Card3 shortsGrid):
// the player opens it by its upload (owner/asset permlink).
const asCard = (s) => ({
  author: s.owner,
  permlink: s.embed_permlink,
  title: (s.title || '').slice(0, 80),
  images: { thumbnail: s.thumbnail_url },
  thumbnail: s.thumbnail_url,
  duration: s.duration || 0,
  created_at: s.createdAt,
});

/**
 * "Use this sound": the shorts editor (App.jsx EditorModal, via
 * hooks/useEditorLauncher) opens with the sound on its music track. Publishing
 * credits it and gives a Short's creator the 5% sound split (EditorModal,
 * utils/soundCredits.js withSoundCredit). Needs an account, and an upload
 * block stops it like every other upload entry (UploadLinks).
 */
async function startWithSound(data, t) {
  const { user, incubationHandle } = useAppStore.getState();
  if (!user && !incubationHandle) { toast.error(t('sounds.signIn')); return; }
  const settings = await getCreatorSettings(creatorKey(user, incubationHandle));
  if (isUploadBlocked(settings)) {
    const note = settings?.uploadBlockedReason;
    useSupportBlock.getState().showSupportBlock('upload', note ? { note } : undefined);
    return;
  }
  const credit = soundCredit(data.sound);
  if (!credit) { toast.error(t('sounds.cannotUse')); return; }
  let url = data.sound.audio_url || null;
  if (!url && data.original) {
    // A Short's sound: its smallest HLS rendition, which the editor reads as audio.
    try {
      url = (await videoAudioTrack({ author: data.original.owner, permlink: data.original.embed_permlink })).src;
    } catch { url = null; }
  }
  if (!url) { toast.error(t('sounds.cannotUse')); return; }
  window.dispatchEvent(new CustomEvent('open-shorts-editor', {
    detail: { sound: { url, name: credit.title, credit } },
  }));
}

/** /sound/:id: a sound (a library song or a Short's own audio) and the Shorts using it. */
export default function SoundPage() {
  const { id: rawId } = useParams();
  const id = String(rawId || '').toLowerCase();
  const { t } = useTranslation();
  const [sort, setSort] = useState('new');
  const [busy, setBusy] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const previewRef = useRef(null);
  const audioCurrent = useAppStore((s) => s.audioCurrent);
  const audioIsPlaying = useAppStore((s) => s.audioIsPlaying);

  const valid = isSoundId(id);
  const { data, isLoading, isError } = useQuery({
    queryKey: ['sound', id, sort],
    queryFn: () => fetchSound(id, { sort }),
    enabled: valid,
    staleTime: 60 * 1000,
  });
  const { data: trending = [] } = useQuery({
    queryKey: ['sounds', 'trending'],
    queryFn: () => fetchTrendingSounds(12),
    staleTime: 5 * 60 * 1000,
  });

  // A library song previews here; a Short's audio plays in the audio player.
  useEffect(() => () => previewRef.current?.pause(), [id]);
  const original = data?.original || null;
  const sound = data?.sound || null;
  const cards = useMemo(() => (data?.shorts || []).map(asCard), [data]);
  const originalCard = original ? [asCard(original)] : [];
  const playingOriginal = original && audioIsPlaying && audioCurrent?._id === `video:${original.owner}/${original.embed_permlink}`;

  const togglePreview = async () => {
    if (sound?.audio_url) {
      const el = previewRef.current;
      if (!el) return;
      if (el.paused) el.play().catch(() => {}); else el.pause();
      return;
    }
    if (!original) return;
    if (playingOriginal) { useAppStore.getState().audioRequestToggle(); return; }
    try {
      await playVideoAsAudio({ author: original.owner, permlink: original.embed_permlink, title: sound?.title || original.title }, useAppStore.getState());
    } catch {
      toastIn('Audio').error(t('videoAudio.failed'));
    }
  };

  const onUse = async () => {
    setBusy(true);
    try { await startWithSound(data, t); } finally { setBusy(false); }
  };

  if (!valid || (!isLoading && !isError && !data)) {
    return (
      <div className="v2-page sound-page">
        <EmptyState icon="music_note" title={t('sounds.notFound')} action={<Link className="v2-btn v2-btn--secondary h40" to="/shorts">{t('sounds.toShorts')}</Link>} />
      </div>
    );
  }

  const cover = original ? fixVideoThumbnail({ thumbnail_url: original.thumbnail_url, thumbnail: original.thumbnail_url }, true) : null;
  const isPlaying = sound?.audio_url ? previewing : playingOriginal;
  const by = sound?.account ? `@${sound.account}` : sound?.artist || '';

  return (
    <div className="v2-page sound-page">
      <section className="sound-head" aria-busy={isLoading || undefined}>
        <div className="sound-head__cover">
          {cover
            ? <img src={cover} alt="" onError={(e) => { e.currentTarget.src = fallbackImg; }} />
            : <Icon name="music_note" size={40} />}
        </div>
        <div className="sound-head__info">
          <span className="v2-eyebrow is-accent">{sound?.kind === 'library' ? t('sounds.kindLibrary') : t('sounds.kindOriginal')}</span>
          <h1 className="v2-heading sound-head__title">{sound?.title || (isLoading ? '…' : t('sounds.untitled'))}</h1>
          {by && (sound?.account
            ? <Link className="sound-head__by" to={`/@${sound.account}`}>{by}</Link>
            : <span className="sound-head__by">{by}</span>)}
          {data && (
            <span className="v2-meta num">{t('sounds.uses', { count: data.uses || 0 })}</span>
          )}
          <div className="sound-head__actions">
            {(sound?.audio_url || original) && (
              <Button variant="secondary" size={44} icon={isPlaying ? 'pause' : 'play_arrow'} onClick={togglePreview}>
                {isPlaying ? t('sounds.pause') : t('sounds.listen')}
              </Button>
            )}
            {FEATURE_EDITOR && (
              <Button variant="primary" size={44} icon="movie_edit" onClick={onUse} loading={busy} disabled={!data || busy}>
                {t('sounds.useThisSound')}
              </Button>
            )}
          </div>
          {sound?.kind === 'short' && <p className="sound-head__note">{t('sounds.splitNote', { name: by })}</p>}
          {sound?.license && <p className="sound-head__note">{t('sounds.license', { license: sound.license })}</p>}
        </div>
        {sound?.audio_url && (
          <audio
            ref={previewRef}
            src={sound.audio_url}
            preload="none"
            onPlay={() => setPreviewing(true)}
            onPause={() => setPreviewing(false)}
            onEnded={() => setPreviewing(false)}
          />
        )}
      </section>

      {originalCard.length > 0 && (
        <section className="sound-section">
          <h2 className="v2-eyebrow">{t('sounds.original')}</h2>
          <div className="sound-grid sound-grid--one">
            <Card3 videos={originalCard} shortsGrid linkPrefix="/shorts" />
          </div>
        </section>
      )}

      <section className="sound-section">
        <div className="sound-section__head">
          <h2 className="v2-eyebrow">{t('sounds.shortsUsing')}</h2>
          <Segmented
            size={32}
            block={false}
            label={t('sounds.shortsUsing')}
            value={sort}
            onChange={setSort}
            options={[{ value: 'new', label: t('sounds.newest') }, { value: 'top', label: t('sounds.top') }]}
          />
        </div>
        {cards.length > 0 || isLoading
          ? <Card3 videos={cards} loading={isLoading} shortsGrid linkPrefix="/shorts" />
          : <EmptyState icon="music_note" title={t('sounds.noUsesTitle')}>{t('sounds.noUsesText')}</EmptyState>}
      </section>

      {trending.filter((s) => s.id !== id).length > 0 && (
        <section className="sound-section">
          <h2 className="v2-eyebrow">{t('sounds.trending')}</h2>
          <div className="sound-chips">
            {trending.filter((s) => s.id !== id).map((s) => (
              <Link key={s.id} className="v2-chip sound-chip" to={`/sound/${s.id}`}>
                <Icon name="music_note" size={16} />
                <span className="sound-chip__title">{s.title || s.artist}</span>
                <span className="sound-chip__n num">{formatNumber(s.uses)}</span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
