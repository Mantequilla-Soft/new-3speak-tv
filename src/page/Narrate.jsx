import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Banner, Button, Card, ChoiceCard, Chip, EmptyState, Field, Icon, Progress, Segmented, SettingRow, StatusPill, Toggle } from '../components/v2/ui';
import Skeleton from '../components/Wallet/Skeleton';
import Composer from '../components/common/Composer/Composer';
import { useAppStore } from '../lib/store';
import { narrationEnabledFor } from '../utils/config';
import { commentWithAioha } from '../hive-api/aioha';
import { getPostDetails } from '../hive-api/hiveApi';
import {
  clock, getMyPosts, getNarration, getNarrationAudio, getNarrationOptions, getScript, getScriptFromText,
  listenLine, musicPreviewUrl, narrationDescription, startNarration, uploadNarrationMusic,
} from '../lib/narration';
import { toastIn } from '../utils/toast';
import useUploadQuota from '../hooks/useUploadQuota';
import UploadQuotaNote from '../components/UploadQuota/UploadQuotaNote';
import { isUsedUp } from '../lib/uploadQuota';
import './Narrate.scss';

// 🎙️ /narrate: blog to podcast. A creator's own written post (or one they write
// here and publish first) read out by a synthetic voice: pick the post, edit the
// script, pick a voice and background music, listen to a preview, make the
// recording, then publish it with the audio uploader as a new audio post that
// links back; the written post can get a "Listen" link afterwards. The server
// renders (server/narration.cjs); free: 4 voices, the focus-mode music, 15 min a
// day; Pro: every voice, the music library and your own music, an hour a day.

const toast = toastIn('Narration');
const SITE = 'https://3speak.tv';
const COMMUNITY = 'hive-181335';
const FOCUS_LABEL = { rain: 'comments.focus.track1', piano: 'comments.focus.track2', fireplace: 'comments.focus.track3' };

const permlinkFor = (title) => {
  const slug = String(title || '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 60);
  return `${slug || 'post'}-${Date.now().toString(36)}`;
};
const excerptOf = (script) => {
  const first = String(script || '').split(/\n\s*\n/).find((p) => p.trim() && !p.startsWith('# ')) || '';
  return first.length > 300 ? `${first.slice(0, 299).trimEnd()}…` : first;
};
const wordsOf = (script) => String(script || '').replace(/^#\s+/gm, '').split(/\s+/).filter(Boolean).length;

function useJob(id, onDone) {
  const [job, setJob] = useState(null);
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    if (!id) { setJob(null); return undefined; }
    let alive = true;
    let timer = null;
    const poll = async () => {
      try {
        const j = await getNarration(id);
        if (!alive) return;
        setJob(j);
        if (j.status === 'done' || j.status === 'failed') { done.current?.(j); return; }
      } catch (e) {
        if (!alive) return;
        setJob({ status: 'failed', error: e.message });
        return;
      }
      timer = setTimeout(poll, 1200);
    };
    poll();
    return () => { alive = false; clearTimeout(timer); };
  }, [id]);
  return job;
}

/** One of the creator's posts in the picker. */
function PostRow({ post, selected, onPick, t, lang }) {
  const date = (() => { try { return new Date(`${post.created}Z`).toLocaleDateString(lang, { dateStyle: 'medium' }); } catch { return ''; } })();
  return (
    <button type="button" className={`nar-post${selected ? ' is-on' : ''}`} onClick={() => onPick(post)} aria-pressed={selected}>
      <span className="nar-post__text">
        <b>{post.title || post.permlink}</b>
        <span className="nar-post__meta">
          {date}
          {' · '}
          {t('narrate.pick.words', { count: post.words })}
          {post.kind !== 'text' && ` · ${t(`narrate.pick.kind.${post.kind}`)}`}
        </span>
      </span>
      {post.narrated && <StatusPill tone="cyan" caps={false}>{t('narrate.pick.narrated')}</StatusPill>}
    </button>
  );
}

/** Play a voice preview or a music bed: one at a time on the page. */
function usePlayer() {
  const ref = useRef(null);
  const [playing, setPlaying] = useState(null);
  const stop = useCallback(() => { ref.current?.pause(); setPlaying(null); }, []);
  const play = useCallback((key, url) => {
    if (!ref.current) {
      ref.current = new Audio();
      ref.current.addEventListener('ended', () => setPlaying(null));
    }
    if (playing === key) { stop(); return; }
    ref.current.src = url;
    ref.current.play().then(() => setPlaying(key)).catch(() => setPlaying(null));
  }, [playing, stop]);
  useEffect(() => () => ref.current?.pause(), []);
  return { playing, play, stop };
}

export default function Narrate() {
  const { t, i18n } = useTranslation();
  const { permlink: wanted } = useParams();
  const { user, authenticated } = useAppStore();
  const enabled = authenticated && narrationEnabledFor(user);

  const [options, setOptions] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [tab, setTab] = useState('posts');
  const [posts, setPosts] = useState(null);
  const [morePosts, setMorePosts] = useState(false);
  const [source, setSource] = useState(null); // { author, permlink, title, image, tags, community }
  const [script, setScript] = useState('');
  const [loadingScript, setLoadingScript] = useState(false);
  const [voice, setVoice] = useState('');
  const [music, setMusic] = useState({ kind: 'off', id: '' });
  const [librarySearch, setLibrarySearch] = useState('');
  const [intro, setIntro] = useState(true);
  const [previewId, setPreviewId] = useState(null);
  const [jobId, setJobId] = useState(null);
  const [audio, setAudio] = useState(null); // { url, blob, seconds, credit }
  const [published, setPublished] = useState(null); // { author, permlink }
  const [linked, setLinked] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  // Writing a new post here
  const [draftTitle, setDraftTitle] = useState('');
  const [draftBody, setDraftBody] = useState('');
  const [draftTags, setDraftTags] = useState('');
  const player = usePlayer();
  // ⏳ The recording goes out through the audio uploader, so it is one of the
  // free plan's audio uploads (2 a day, 15 minutes each). null = no limit known.
  const audioQuota = useUploadQuota({ video: false }).audio;

  const refreshOptions = useCallback(() => getNarrationOptions()
    .then((o) => { setOptions(o); setVoice((v) => v || o.defaultVoice); })
    .catch((e) => setLoadError(e.code === 'not_open' ? t('narrate.gate.notOpen') : e.message)), [t]);

  useEffect(() => {
    if (!enabled) return;
    refreshOptions();
    getMyPosts().then((d) => { setPosts(d.posts); setMorePosts(d.more); }).catch(() => setPosts([]));
  }, [enabled, refreshOptions]);

  const pick = useCallback(async (post) => {
    setError('');
    setAudio(null);
    setPublished(null);
    setLinked(false);
    setLoadingScript(true);
    try {
      const s = await getScript(user, post.permlink);
      setSource({ author: s.author, permlink: s.permlink, title: s.title, image: s.image, tags: s.tags, community: s.community });
      setScript(s.script);
      if (!s.script) setError(t('narrate.script.nothing'));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoadingScript(false);
    }
  }, [user, t]);

  // /narrate/:permlink (the "Narrate" action on a post) opens that post.
  useEffect(() => {
    if (enabled && wanted && !source) pick({ permlink: wanted });
  }, [enabled, wanted, source, pick]);

  useEffect(() => {
    const onPublished = (e) => {
      const d = e.detail || {};
      if (d.author && d.permlink) setPublished({ author: d.author, permlink: d.permlink });
    };
    window.addEventListener('narration-published', onPublished);
    return () => window.removeEventListener('narration-published', onPublished);
  }, []);

  useEffect(() => () => { if (audio?.url) URL.revokeObjectURL(audio.url); }, [audio]);

  const voices = useMemo(() => options?.voices || [], [options]);
  const pro = !!options?.pro;
  const words = wordsOf(script);
  const estimate = Math.round((words / (options?.wordsPerMinute || 155)) * 60);
  const left = options?.allowance?.left ?? 0;
  const tracks = useMemo(() => {
    const q = librarySearch.trim().toLowerCase();
    const all = options?.library?.tracks || [];
    return (q ? all.filter((x) => `${x.title} ${x.artist} ${x.mood}`.toLowerCase().includes(q)) : all).slice(0, 40);
  }, [options, librarySearch]);

  const jobBody = (preview) => ({ script, title: source?.title || draftTitle, voice, music, intro, preview });

  const previewJob = useJob(previewId, async (j) => {
    if (j.status !== 'done') { setError(j.error || t('narrate.errors.failed')); return; }
    try { player.play(`preview-${previewId}`, URL.createObjectURL(await getNarrationAudio(previewId))); } catch (e) { setError(e.message); }
  });
  const job = useJob(jobId, async (j) => {
    if (j.status !== 'done') { setError(j.error || t('narrate.errors.failed')); refreshOptions(); return; }
    try {
      const blob = await getNarrationAudio(jobId);
      setAudio({ url: URL.createObjectURL(blob), blob, seconds: j.seconds, credit: j.credit, voice: j.voice });
      refreshOptions();
    } catch (e) { setError(e.message); }
  });
  const rendering = (previewJob && !['done', 'failed'].includes(previewJob.status)) || (job && !['done', 'failed'].includes(job.status));

  const start = async (preview) => {
    setError('');
    player.stop();
    try {
      const { id } = await startNarration(jobBody(preview));
      if (preview) setPreviewId(id);
      else { setAudio(null); setPublished(null); setLinked(false); setJobId(id); }
    } catch (e) {
      setError(e.code === 'daily_limit' ? t('narrate.errors.dailyLimit', { left: clock(e.allowance?.left) }) : e.message);
    }
  };

  const publishWritten = async () => {
    const title = draftTitle.trim();
    const body = draftBody.trim();
    if (!title || !body) { setError(t('narrate.write.missing')); return; }
    setBusy('write');
    setError('');
    try {
      const permlink = permlinkFor(title);
      const tags = Array.from(new Set(draftTags.split(/[\s,]+/).map((x) => x.toLowerCase().replace(/^#/, '')).filter(Boolean))).slice(0, 8);
      const res = await commentWithAioha('', COMMUNITY, permlink, title, body, { app: '3speak/new-version', tags: tags.length ? tags : ['writing'], format: 'markdown' });
      if (res && res.success === false) throw new Error(res.error || t('narrate.errors.publishFailed'));
      const s = await getScriptFromText(body);
      setSource({ author: user, permlink, title, image: '', tags, community: COMMUNITY });
      setScript(s.script);
      toast.success(t('narrate.write.published'));
    } catch (e) {
      setError(e.message || t('narrate.errors.publishFailed'));
    } finally {
      setBusy('');
    }
  };

  const onMusicFile = async (file) => {
    if (!file) return;
    setBusy('music');
    setError('');
    try {
      const { id } = await uploadNarrationMusic(file);
      setMusic({ kind: 'upload', id, name: file.name });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  };

  const voiceName = voices.find((v) => v.id === (audio?.voice || voice))?.name || '';
  const audioTooLong = !!(audio && audioQuota?.maxSeconds && audio.seconds > audioQuota.maxSeconds + 0.5);
  const publishBlocked = isUsedUp(audioQuota) || audioTooLong;
  const publishAudio = () => {
    if (!audio || publishBlocked) return;
    const postUrl = source?.permlink ? `${SITE}/@${source.author}/${source.permlink}` : '';
    const description = narrationDescription({
      excerpt: excerptOf(script),
      postUrl,
      voiceName,
      labels: { writtenPost: t('narrate.publish.writtenPost'), readBy: (name) => t('narrate.publish.readBy', { name }) },
    });
    window.dispatchEvent(new CustomEvent('open-audio-upload', {
      detail: {
        blob: audio.blob,
        filename: `${source?.permlink || 'narration'}.mp3`,
        type: 'podcast',
        source: 'editor',
        musicCredits: audio.credit ? [audio.credit] : null,
        prefill: {
          title: source?.title || draftTitle,
          description,
          tags: [...(source?.tags || []).filter((x) => !/^hive-\d+$/.test(x)), 'narrated'].slice(0, 8),
          coverUrl: source?.image || '',
          narration: { voice: audio.voice || voice, source: source?.permlink ? `${source.author}/${source.permlink}` : null },
        },
      },
    }));
  };

  const addListenLink = async () => {
    if (!source?.permlink || !published) return;
    setBusy('link');
    setError('');
    try {
      const post = await getPostDetails(source.author, source.permlink);
      if (!post?.body) throw new Error(t('narrate.errors.notFound'));
      const audioUrl = `${SITE}/audio/${published.author}/${published.permlink}`;
      if (post.body.includes(audioUrl)) { setLinked(true); return; }
      const meta = post.json_metadata && typeof post.json_metadata === 'object' ? post.json_metadata : {};
      const res = await commentWithAioha(
        post.parent_author || '', post.parent_permlink || post.category, post.permlink, post.title,
        `${post.body}${listenLine(audioUrl, t('narrate.publish.listenLabel'))}`,
        { ...meta, '3speak': { ...(meta['3speak'] || {}), narration: `${published.author}/${published.permlink}` } },
      );
      if (res && res.success === false) throw new Error(res.error || t('narrate.errors.publishFailed'));
      setLinked(true);
      toast.success(t('narrate.publish.linked'));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  };

  if (!authenticated) {
    return <div className="narrate"><EmptyState icon="record_voice_over" title={t('narrate.title')}>{t('narrate.gate.signIn')}</EmptyState></div>;
  }
  if (!narrationEnabledFor(user) || loadError) {
    return <div className="narrate"><EmptyState icon="record_voice_over" title={t('narrate.title')}>{loadError || t('narrate.gate.notOpen')}</EmptyState></div>;
  }

  const jobState = job && job.status !== 'done' && job.status !== 'failed' ? job : (previewJob && previewJob.status !== 'done' && previewJob.status !== 'failed' ? previewJob : null);

  return (
    <div className="narrate">
      <header className="narrate__head">
        <div className="v2-eyebrow">{t('narrate.eyebrow')}</div>
        <h1>{t('narrate.title')}</h1>
        <p className="narrate__sub">{t('narrate.subtitle')}</p>
        {options && (
          <p className="narrate__allowance num">
            <Icon name="timer" size={16} />
            {t('narrate.allowance', { left: clock(left), limit: clock(options.allowance.limit) })}
            {!pro && <> · <Link to="/wallet#pro">{t('narrate.proHint')}</Link></>}
          </p>
        )}
      </header>

      {error && <Banner tone="warn">{error}</Banner>}

      <Card className="narrate__card">
        <h2 className="narrate__step"><span>1</span>{t('narrate.pick.title')}</h2>
        <Segmented
          options={[{ value: 'posts', label: t('narrate.pick.mine') }, { value: 'write', label: t('narrate.pick.write') }]}
          value={tab}
          onChange={setTab}
          label={t('narrate.pick.title')}
        />
        {tab === 'posts' && (
          posts === null ? <Skeleton rows={4} /> : posts.length === 0 ? (
            <p className="narrate__note">{t('narrate.pick.empty')}</p>
          ) : (
            <div className="nar-posts" role="list">
              {posts.map((p) => (
                <PostRow key={p.permlink} post={p} selected={source?.permlink === p.permlink} onPick={pick} t={t} lang={i18n.language} />
              ))}
              {morePosts && (
                <Button variant="ghost" size={36} onClick={() => getMyPosts(posts[posts.length - 1]?.permlink).then((d) => { setPosts((x) => [...x, ...d.posts]); setMorePosts(d.more); }).catch(() => setMorePosts(false))}>
                  {t('narrate.pick.more')}
                </Button>
              )}
            </div>
          )
        )}
        {tab === 'write' && (
          <div className="nar-write">
            <Field label={t('narrate.write.titleLabel')} value={draftTitle} maxLength={255} onChange={(e) => setDraftTitle(e.target.value)} />
            <Composer
              value={draftBody}
              onChange={setDraftBody}
              mode="full"
              rows={10}
              placeholder={t('narrate.write.placeholder')}
              textareaClassName="v2-input nar-write__body"
              polls={false}
            />
            <Field label={t('narrate.write.tags')} optional optionalLabel={t('narrate.optional')} value={draftTags} onChange={(e) => setDraftTags(e.target.value)} />
            <p className="narrate__note">{t('narrate.write.hint')}</p>
            <Button variant="primary" icon="publish" loading={busy === 'write'} disabled={!!busy} onClick={publishWritten}>{t('narrate.write.publish')}</Button>
          </div>
        )}
      </Card>

      {(loadingScript || source) && (
        <Card className="narrate__card">
          <h2 className="narrate__step"><span>2</span>{t('narrate.script.title')}</h2>
          {loadingScript ? <Skeleton rows={5} /> : (
            <>
              <p className="narrate__note">{t('narrate.script.hint')}</p>
              <textarea
                className="v2-input nar-script"
                value={script}
                onChange={(e) => setScript(e.target.value)}
                rows={12}
                aria-label={t('narrate.script.title')}
              />
              <p className={`narrate__note num${estimate > left ? ' is-over' : ''}`}>
                {t('narrate.script.length', { count: words, time: clock(estimate) })}
                {estimate > left && ` · ${t('narrate.script.tooLong', { left: clock(left) })}`}
              </p>
            </>
          )}
        </Card>
      )}

      {source && options && (
        <>
          <Card className="narrate__card">
            <h2 className="narrate__step"><span>3</span>{t('narrate.voice.title')}</h2>
            <div className="nar-voices" role="radiogroup" aria-label={t('narrate.voice.title')}>
              {voices.filter((v) => v.free || pro).concat(pro ? [] : voices.filter((v) => !v.free)).map((v) => {
                const locked = !v.free && !pro;
                return (
                  <ChoiceCard
                    key={v.id}
                    selected={voice === v.id}
                    disabled={locked}
                    icon={locked ? 'lock' : 'record_voice_over'}
                    title={v.name}
                    sub={`${t(`narrate.voice.gender.${v.gender}`)} · ${t(`narrate.voice.accent.${v.accent}`, { defaultValue: v.accent })}${locked ? ` · Pro` : ''}`}
                    onClick={() => !locked && setVoice(v.id)}
                  />
                );
              })}
            </div>
          </Card>

          <Card className="narrate__card">
            <h2 className="narrate__step"><span>4</span>{t('narrate.music.title')}</h2>
            <div className="nar-music">
              <Chip selected={music.kind === 'off'} onClick={() => setMusic({ kind: 'off', id: '' })}>{t('narrate.music.off')}</Chip>
              {(options.focus || []).map((id) => (
                <Chip key={id} selected={music.kind === 'focus' && music.id === id} onClick={() => setMusic({ kind: 'focus', id })}>{t(FOCUS_LABEL[id] || id)}</Chip>
              ))}
              <Chip selected={music.kind === 'library'} disabled={!pro} icon={pro ? 'library_music' : 'lock'} onClick={() => pro && setMusic({ kind: 'library', id: music.kind === 'library' ? music.id : '' })}>{t('narrate.music.library')}</Chip>
              <Chip selected={music.kind === 'upload'} disabled={!pro} icon={pro ? 'upload' : 'lock'} onClick={() => pro && setMusic({ kind: 'upload', id: music.kind === 'upload' ? music.id : '' })}>{t('narrate.music.own')}</Chip>
            </div>
            {!pro && <p className="narrate__note">{t('narrate.music.proNote')}</p>}
            {music.kind === 'focus' && (
              <Button variant="ghost" size={36} icon={player.playing === `bed-${music.id}` ? 'stop' : 'play_arrow'}
                onClick={() => musicPreviewUrl('focus', music.id).then((u) => player.play(`bed-${music.id}`, u)).catch((e) => setError(e.message))}>
                {t('narrate.music.listen')}
              </Button>
            )}
            {music.kind === 'library' && (
              <div className="nar-library">
                <Field label={t('narrate.music.search')} value={librarySearch} onChange={(e) => setLibrarySearch(e.target.value)} />
                <ul className="nar-library__list">
                  {tracks.map((x) => (
                    <li key={x.id} className={music.id === x.id ? 'is-on' : ''}>
                      <button type="button" className="nar-library__pick" onClick={() => setMusic({ kind: 'library', id: x.id })} aria-pressed={music.id === x.id}>
                        <b>{x.title}</b>
                        <span>{x.artist}{x.mood ? ` · ${x.mood}` : ''} · <span className="num">{clock(x.duration)}</span></span>
                      </button>
                      <button type="button" className="nar-library__play" aria-label={t('narrate.music.listen')}
                        onClick={() => musicPreviewUrl('library', x.id).then((u) => player.play(`lib-${x.id}`, u)).catch((e) => setError(e.message))}>
                        <Icon name={player.playing === `lib-${x.id}` ? 'stop' : 'play_arrow'} size={20} />
                      </button>
                    </li>
                  ))}
                </ul>
                <p className="narrate__note">{t('narrate.music.credit')}</p>
              </div>
            )}
            {music.kind === 'upload' && (
              <div className="nar-upload">
                <label className="v2-btn v2-btn--secondary nar-upload__btn">
                  <Icon name="upload" size={18} />
                  {busy === 'music' ? t('narrate.music.uploading') : music.id ? t('narrate.music.replace') : t('narrate.music.choose')}
                  <input type="file" accept="audio/*" hidden disabled={!!busy} onChange={(e) => onMusicFile(e.target.files?.[0])} />
                </label>
                {music.id && <span className="narrate__note">{music.name || t('narrate.music.ready')}</span>}
                <p className="narrate__note">{t('narrate.music.ownHint')}</p>
              </div>
            )}
          </Card>

          <Card className="narrate__card">
            <h2 className="narrate__step"><span>5</span>{t('narrate.make.title')}</h2>
            <SettingRow title={t('narrate.make.intro')} sub={t('narrate.make.introHint')} control={<Toggle checked={intro} onChange={setIntro} label={t('narrate.make.intro')} />} />
            <UploadQuotaNote kind="audio" entry={audioQuota} user={user} warn={audioTooLong}>
              {audioTooLong && t('uploadLimits.tooLongTracks', { minutes: Math.round(audioQuota.maxSeconds / 60) })}
            </UploadQuotaNote>
            <div className="nar-actions">
              <Button variant="secondary" icon="hearing" disabled={!script.trim() || rendering || (music.kind !== 'off' && !music.id)} onClick={() => start(true)}>{t('narrate.make.preview')}</Button>
              <Button variant="primary" icon="graphic_eq" disabled={!script.trim() || rendering || estimate > left || (music.kind !== 'off' && !music.id)} onClick={() => start(false)}>{t('narrate.make.record')}</Button>
            </div>
            {jobState && (
              <div className="nar-progress" role="status">
                <span className="narrate__note">{jobState.status === 'queued' ? t('narrate.make.queued', { count: jobState.queue || 1 }) : t('narrate.make.rendering')}</span>
                <Progress value={Math.round((jobState.progress || 0) * 100)} label={t('narrate.make.rendering')} />
              </div>
            )}
            {audio && (
              <div className="nar-result">
                <audio controls src={audio.url} className="nar-result__audio" />
                <p className="narrate__note num">{t('narrate.make.done', { time: clock(audio.seconds), name: voiceName })}</p>
                {!published ? (
                  <Button variant="primary" icon="podcasts" onClick={publishAudio} disabled={publishBlocked}>{t('narrate.publish.button')}</Button>
                ) : (
                  <div className="nar-published">
                    <Banner tone="info" icon="check_circle" title={t('narrate.publish.done')}>
                      <Link to={`/audio/${published.author}/${published.permlink}`}>{t('narrate.publish.open')}</Link>
                    </Banner>
                    {source?.permlink && (
                      linked
                        ? <p className="narrate__note"><Icon name="check" size={16} /> {t('narrate.publish.linked')}</p>
                        : <Button variant="secondary" icon="link" loading={busy === 'link'} disabled={!!busy} onClick={addListenLink}>{t('narrate.publish.addLink')}</Button>
                    )}
                  </div>
                )}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
