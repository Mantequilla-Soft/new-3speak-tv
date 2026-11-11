import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ENABLE_SUBS } from '../../utils/config';
import { toastIn } from '../../utils/toast';
import { getLanguage } from '../../i18n';
import { getCurrentProvider, Providers } from '../../hive-api/aioha';
import {
  hasThreespeakPostingAuth, addThreespeakToPostingAuth, waitForThreespeakPostingAuth,
} from '../../utils/postingAuthority';
import {
  TEMPLATE_LIMITS, listTemplates, createTemplate, updateTemplate, deleteTemplate, getTemplateStatus,
  getStreamSecret, resetStreamSecret, slugifyTemplateName, emptyTemplate, templateToForm, formToInput,
} from '../../utils/streamTemplates';
import AnnounceOptions from './AnnounceOptions';
import MarkdownComposer from '../studio/MarkdownComposer';
import {
  Banner, Button, ChoiceCard, Dialog, EmptyState, Icon, IconButton, SettingRow, StatusPill, Toggle,
} from '../v2/ui';
import { cx } from '../v2/helpers';
import './StreamTemplates.scss';

const toast = toastIn('Live');
const IMAGE_KEY = import.meta.env.VITE_IMAGE_SERVER_API_KEY;
const STATUS_POLL_MS = 5000;

// Same broadcast languages as the browser create-stream form (stored as the
// short code). Names come from Intl in the reader's own language.
const LANGUAGE_CODES = ['en', 'es', 'pt', 'de', 'fr', 'it', 'nl', 'pl', 'ru', 'uk', 'tr', 'ar', 'hi', 'id', 'vi', 'th', 'ja', 'ko', 'zh', 'sw'];

async function uploadImage(file) {
  const formData = new FormData();
  formData.append('image', file);
  const res = await fetch('https://images.3speak.tv/upload', {
    method: 'POST',
    headers: { Authorization: `Bearer ${IMAGE_KEY}` },
    body: formData,
  });
  const data = await res.json().catch(() => ({}));
  if (!data.success || !data.url) throw new Error('upload failed');
  return data.url;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Centred dialog on desktop, bottom sheet on phones (the v2 Dialog). */
function Sheet({ title, onClose, children, footer, wide = false }) {
  return (
    <Dialog open onClose={onClose} title={title} footer={footer} width={wide ? 680 : 440} className="st-sheet">
      {children}
    </Dialog>
  );
}

function ConfirmSheet({ title, text, confirmLabel, danger = false, busy = false, onConfirm, onCancel }) {
  const { t } = useTranslation();
  return (
    <Sheet
      title={title}
      onClose={onCancel}
      footer={(
        <>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>{t('common.actions.cancel')}</Button>
          <Button variant={danger ? 'danger' : 'primary'} icon={danger ? 'delete' : undefined} onClick={onConfirm} disabled={busy} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      )}
    >
      <p className="st-confirm-text">{text}</p>
    </Sheet>
  );
}

// ─── Stream secret ─────────────────────────────────────────────────────────
// 🚨 A credential. Only ever in this component's state: never logged, never in
// a toast, a URL or storage.
function SecretBox({ token }) {
  const { t } = useTranslation();
  const [secret, setSecret] = useState(null);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const fetchSecret = useCallback(async () => {
    if (secret) return secret;
    const data = await getStreamSecret(token);
    setSecret(data.secret);
    return data.secret;
  }, [secret, token]);

  const reveal = async () => {
    if (revealed) { setRevealed(false); return; }
    setBusy(true);
    try {
      await fetchSecret();
      setRevealed(true);
    } catch {
      toast.error(t('live.obs.secret.loadFailed'));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    setBusy(true);
    try {
      const s = await fetchSecret();
      if (await copyText(s)) toast.success(t('live.obs.secret.copied'));
      else toast.error(t('live.obs.copyFailed'));
    } catch {
      toast.error(t('live.obs.secret.loadFailed'));
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    setBusy(true);
    try {
      const data = await resetStreamSecret(token);
      setSecret(data.secret);
      setRevealed(true);
      setConfirmReset(false);
      toast.success(t('live.obs.secret.resetDone'));
    } catch {
      toast.error(t('live.obs.secret.resetFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="st-card-box st-secret">
      <div className="st-secret__head">
        <Icon name="key" size={24} className="st-secret__icon" />
        <div className="st-secret__text">
          <h2>{t('live.obs.secret.title')}</h2>
          <code className={cx('st-secret__value', !revealed && 'is-masked')}>
            {revealed && secret ? secret : '•••• •••• •••• •••• ••••'}
          </code>
        </div>
      </div>
      <p className="st-secret__desc">{t('live.obs.secret.desc')}</p>
      <div className="st-secret__actions">
        <Button variant="secondary" icon={revealed ? 'visibility_off' : 'visibility'} onClick={reveal} disabled={busy}>
          {revealed ? t('live.obs.secret.hide') : t('live.obs.secret.reveal')}
        </Button>
        <Button variant="secondary" icon="content_copy" onClick={copy} disabled={busy}>
          {t('common.actions.copy')}
        </Button>
        <Button variant="danger" icon="refresh" onClick={() => setConfirmReset(true)} disabled={busy}>
          {t('common.actions.reset')}
        </Button>
      </div>
      {confirmReset && (
        <ConfirmSheet
          title={t('live.obs.secret.resetTitle')}
          text={t('live.obs.secret.resetConfirm')}
          confirmLabel={t('live.obs.secret.resetButton')}
          danger
          busy={busy}
          onConfirm={reset}
          onCancel={() => setConfirmReset(false)}
        />
      )}
    </section>
  );
}

// ─── Chat in OBS ───────────────────────────────────────────────────────────
/**
 * The user's chat URL for OBS: one link for all their streams (the server
 * finds whichever room they are live in), meant as a Custom Browser Dock. See
 * page/ObsChatOverlay; without dock=1 the same page is an overlay for the video.
 */
function ChatUrlBox({ overlayKey }) {
  const { t } = useTranslation();
  if (!overlayKey) return null;
  const copy = async () => {
    const url = `${window.location.origin}/obs/chat?key=${encodeURIComponent(overlayKey)}&dock=1`;
    if (await copyText(url)) toast.success(t('live.obs.chatBox.copied'));
    else toast.error(t('live.obs.copyFailed'));
  };
  return (
    <section className="st-chatbox">
      <Icon name="forum" size={24} className="st-chatbox__icon" />
      <div className="st-chatbox__text">
        <b>{t('live.obs.chatBox.title')}</b>
        <span>{t('live.obs.chatBox.desc')}</span>
      </div>
      <Button variant="cyan" size={36} icon="content_copy" onClick={copy}>{t('live.obs.chatBox.copy')}</Button>
    </section>
  );
}

// ─── OBS is Pro ────────────────────────────────────────────────────────────
/**
 * Shown to free accounts in place of the stream secret, the chat URL and the
 * OBS guide: streaming from OBS is a 3Speak Pro feature (the live server refuses
 * OBS for free hosts too). Templates still work in the browser studio.
 */
function ObsProNotice({ user }) {
  const { t } = useTranslation();
  return (
    <section className="st-pro">
      <Icon name="workspace_premium" size={24} className="st-pro__icon" />
      <div className="st-pro__text">
        <b>{t('live.obs.pro.title')}</b>
        <span>{t('live.obs.pro.desc')}</span>
        {ENABLE_SUBS && user && (
          <Button as={Link} to={`/wallet/${user}#pro`} variant="primary" icon="workspace_premium" next className="st-pro__cta">
            {t('live.obs.pro.cta')}
          </Button>
        )}
      </div>
    </section>
  );
}

// ─── OBS guide ─────────────────────────────────────────────────────────────
function ObsGuide({ isPremium, defaultOpen }) {
  const { t } = useTranslation();
  // Follows `defaultOpen` (open while there are no templates yet) until the
  // reader toggles it themselves.
  const [openPick, setOpen] = useState(null);
  const open = openPick ?? defaultOpen;
  const steps = ['step1', 'step2', 'step3', 'step4', 'step5'];
  const output = ['keyframe', 'bitrate', 'encoder', 'audio', 'bframes'];
  const chat = ['chatCopy', 'chat2', 'chat3'];
  return (
    <section className={cx('st-guide', open && 'is-open')}>
      <button type="button" className="st-guide__toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="st-bar is-cyan" aria-hidden="true" />
        <span className="st-guide__title">{t('live.obs.guide.title')}</span>
        <Icon name="expand_more" size={20} className="st-guide__chevron" />
      </button>
      {open && (
        <div className="st-guide__body">
          <ol className="st-guide__steps">
            {steps.map((k, i) => (
              <li key={k}><span className="st-guide__n">{i + 1}</span><span>{t(`live.obs.guide.${k}`)}</span></li>
            ))}
          </ol>
          <h4 className="v2-eyebrow">{t('live.obs.guide.outputTitle')}</h4>
          <ul className="st-guide__chips">
            {output.map((k) => <li key={k}>{t(`live.obs.guide.${k}`)}</li>)}
          </ul>
          <h4 className="v2-eyebrow">{t('live.obs.guide.chatTitle')}</h4>
          <ol className="st-guide__steps">
            {chat.map((k, i) => (
              <li key={k}><span className="st-guide__n">{i + 1}</span><span>{t(`live.obs.guide.${k}`)}</span></li>
            ))}
          </ol>
          <p className="st-guide__limits">{t('live.obs.guide.chatOptions')}</p>
          <p className="st-guide__limits">
            {isPremium ? t('live.obs.guide.limitsPro') : t('live.obs.guide.limitsFree')}
          </p>
        </div>
      )}
    </section>
  );
}

// ─── Template card ─────────────────────────────────────────────────────────
function useVisible(ref) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  return visible;
}

function TemplateCard({ tpl, token, obsAllowed, onEdit, onDelete, onUse }) {
  const { t } = useTranslation();
  const ref = useRef(null);
  const visible = useVisible(ref);
  const [status, setStatus] = useState(null);

  useEffect(() => {
    if (!visible || !token) return undefined;
    let alive = true;
    const poll = () => getTemplateStatus(token, tpl.id)
      .then((s) => { if (alive) setStatus(s); })
      .catch(() => { /* keep the last known state */ });
    poll();
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') poll();
    }, STATUS_POLL_MS);
    return () => { alive = false; clearInterval(id); };
  }, [visible, token, tpl.id]);

  const state = status?.state || 'idle';
  const ingress = status?.ingress;
  const lastLive = tpl.lastLiveAt ? new Date(tpl.lastLiveAt) : null;

  const copyUrl = async () => {
    if (await copyText(tpl.whipUrl || '')) toast.success(t('live.obs.card.urlCopied'));
    else toast.error(t('live.obs.copyFailed'));
  };

  // Offline / Connecting / Live / Ending (39b): live is the solid pill,
  // connecting is cyan (system work), the rest are quiet.
  const pillTone = state === 'live' ? 'live' : state === 'connecting' ? 'cyan' : 'muted';
  const warn = (status?.announced && status.announced.ok === false
    && tpl.announce?.enabled && tpl.visibility !== 'unlisted')
    ? (status.announced.reason === 'no_posting_authority'
      ? t('live.obs.card.notAnnouncedAuth')
      : t('live.obs.card.notAnnounced'))
    : null;

  return (
    <article ref={ref} className={cx('st-card', `st-card--${state}`)}>
      <div className="st-card__top">
        <div className="st-card__thumb">
          {tpl.thumbnail ? <img src={tpl.thumbnail} alt="" loading="lazy" /> : <Icon name="sensors" size={24} />}
        </div>
        <div className="st-card__head">
          <div className="st-card__name">{tpl.name}</div>
          <div className="st-card__title">{tpl.title}</div>
          <div className="st-card__meta">
            {lastLive
              ? t('live.obs.card.lastLive', { date: lastLive.toLocaleString(getLanguage(), { dateStyle: 'medium', timeStyle: 'short' }) })
              : t('live.obs.card.neverLive')}
          </div>
        </div>
        <StatusPill tone={pillTone} className={cx('st-badge', `st-badge--${state}`)}>
          {t(`live.obs.state.${state}`, { defaultValue: state })}
        </StatusPill>
      </div>
      {obsAllowed && <code className="st-card__url" title={tpl.whipUrl}>{tpl.whipUrl}</code>}
      {state === 'live' && ingress && (
        <div className="st-card__ingress">
          {[ingress.width && ingress.height ? `${ingress.width}×${ingress.height}` : null,
            ingress.bitrate ? `${Math.round(ingress.bitrate / 1000)} kbps` : null,
            ingress.fps ? `${Math.round(ingress.fps)} fps` : null].filter(Boolean).join(' · ')}
        </div>
      )}
      {state === 'live' && status?.room && (
        <Button as={Link} variant="secondary" size={36} icon="play_arrow" className="st-card__watch" to={`/watch/${encodeURIComponent(status.room)}`}>
          {t('live.obs.card.watch')}
        </Button>
      )}
      {warn && <div className="st-card__warn">{warn}</div>}
      {/* We gave up on the session, but OBS may still think it is live. */}
      {state === 'idle' && status?.lastEnd?.reason === 'never_published' && (
        <div className="st-card__warn">{t('live.obs.card.stuck')}</div>
      )}
      {/* OBS was refused at connect: a free account's one stream a day is used up.
          OBS itself only shows a generic connection error. */}
      {state === 'idle' && status?.lastEnd?.reason === 'daily_limit' && (
        <div className="st-card__warn">{t('live.obs.card.dailyLimit')}</div>
      )}
      {/* OBS was refused at connect because the account has no 3Speak Pro. */}
      {state === 'idle' && status?.lastEnd?.reason === 'pro_required' && (
        <div className="st-card__warn">{t('live.obs.card.proRequired')}</div>
      )}
      <div className="st-card__actions">
        {/* The browser studio, no OBS: fills "New stream" from this template. */}
        {onUse && (
          <Button variant="secondary" size={36} icon="videocam" className="st-card__use" onClick={() => onUse(tpl)}>
            {t('live.obs.card.useInStudio')}
          </Button>
        )}
        {obsAllowed && (
          <Button variant="secondary" size={36} icon="content_copy" className="st-card__copy" onClick={copyUrl}>
            {t('live.obs.card.copyUrl')}
          </Button>
        )}
        <IconButton icon="edit" label={t('common.actions.edit')} onClick={() => onEdit(tpl)} />
        <IconButton icon="delete" variant="danger" label={t('common.actions.delete')} onClick={() => onDelete(tpl)} disabled={state === 'live'} />
      </div>
    </article>
  );
}

// ─── Name → stream address ─────────────────────────────────────────────────
/** The template name field, with the stream address it turns into. */
function NameField({ value, onChange, whipBase, user, error, autoFocus = false, onEnter }) {
  const { t } = useTranslation();
  const slug = slugifyTemplateName(value);
  const inputRef = useRef(null);
  // The Dialog focuses its panel when it opens (after our own mount), so an
  // autofocus has to wait a tick to land in the field.
  useEffect(() => {
    if (!autoFocus) return undefined;
    const id = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(id);
  }, [autoFocus]);
  return (
    <label className={cx('v2-field st-field', error && 'is-error')}>
      <span className="v2-eyebrow">{t('live.obs.form.name')}</span>
      <input
        ref={inputRef}
        className="v2-input"
        value={value}
        maxLength={TEMPLATE_LIMITS.name}
        placeholder={t('live.obs.form.namePlaceholder')}
        aria-invalid={!!error}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onEnter?.(); } }}
      />
      <span className="v2-field__hint">{t('live.obs.form.nameHint')}</span>
      <code className="st-field__preview">{`${whipBase || ''}/${user}/${slug || '…'}`}</code>
      {error && <span className="v2-field__err" role="alert">{error}</span>}
    </label>
  );
}

/** API error → { field: 'name' | null, message } for a create / update. */
function templateSaveError(err, t) {
  switch (err?.code) {
    case 'name_taken': return { field: 'name', message: t('live.obs.form.nameTaken') };
    case 'live': return { field: null, message: t('live.obs.form.liveConflict') };
    case 'limit_reached': return { field: null, message: t('live.obs.limitReached', { max: TEMPLATE_LIMITS.templates }) };
    case 'storage_unavailable': return { field: null, message: t('live.obs.unavailableNow') };
    case 'invalid_input': return { field: null, message: t('live.obs.form.invalid') };
    default: return { field: null, message: t('live.obs.form.saveFailed') };
  }
}

// ─── Posting authority notice ──────────────────────────────────────────────
function PostingAuthNotice({ user }) {
  const { t } = useTranslation();
  // null = checking, true/false = on chain, 'unavailable' = nothing to read
  const [granted, setGranted] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!user) return undefined;
    let alive = true;
    hasThreespeakPostingAuth(user)
      .then((v) => { if (alive) setGranted(v); })
      .catch(() => { if (alive) setGranted('unavailable'); });
    return () => { alive = false; };
  }, [user]);

  if (granted !== false) return null;

  // Same flow as Settings → posting authority (SettingsModal's PostingAuthoritySection).
  const grant = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const signWindow = getCurrentProvider() === Providers.HiveSigner ? window.open('', '_blank') : null;
    try {
      await addThreespeakToPostingAuth(user, { signWindow });
    } catch (err) {
      setError(err.message || t('settings.postingAuth.updateFailed'));
      setBusy(false);
      try { signWindow?.close(); } catch { /* ignore */ }
      return;
    }
    try { signWindow?.close(); } catch { /* ignore */ }
    const now = await waitForThreespeakPostingAuth(user, true);
    setGranted(now);
    setBusy(false);
    if (now) toast.success(t('settings.postingAuth.addedToast'));
    else setError(t('settings.postingAuth.notYetAdded'));
  };

  return (
    <div className="st-notice">
      <Banner tone="warn">{t('live.obs.form.authNeeded')}</Banner>
      <Button variant="primary" size={36} icon="key" onClick={grant} disabled={busy} loading={busy}>
        {busy ? t('settings.postingAuth.adding') : t('live.obs.form.authGrant')}
      </Button>
      {error && <p className="v2-field__err" role="alert">{error}</p>}
    </div>
  );
}

// ─── Create / edit form ────────────────────────────────────────────────────
function TemplateEditor({ token, user, whipBase, existing, isPremium, onSaved, onClose }) {
  const { t } = useTranslation();
  const [form, setForm] = useState(() => (existing ? templateToForm(existing) : emptyTemplate()));
  const [tagInput, setTagInput] = useState('');
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState(null);
  const [formError, setFormError] = useState(null);
  const fileRef = useRef(null);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const setIn = (key, patch) => setForm((f) => ({ ...f, [key]: { ...f[key], ...patch } }));

  const slug = slugifyTemplateName(form.name);

  const languageName = useMemo(() => {
    let dn = null;
    try { dn = new Intl.DisplayNames([getLanguage()], { type: 'language' }); } catch { /* old browser */ }
    return (code) => {
      try { return dn?.of(code) || code; } catch { return code; }
    };
  }, []);

  // AnnounceOptions works in its own {community, beneList, ...} shape. Built
  // once: it only reads it on mount (it is detached from the studio's store).
  const announceInitial = useMemo(() => ({
    community: form.announce.community,
    communityTitle: form.announce.communityTitle,
    declineRewards: form.announce.declineRewards,
    rewardPowerup: form.announce.rewardPowerup,
    beneList: form.announce.beneficiaries,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);
  const onAnnounceChange = useCallback((cfg) => {
    setForm((f) => ({
      ...f,
      announce: {
        ...f.announce,
        community: cfg.community,
        communityTitle: cfg.communityTitle,
        declineRewards: cfg.declineRewards,
        rewardPowerup: cfg.rewardPowerup,
        beneficiaries: (cfg.beneList || []).slice(0, TEMPLATE_LIMITS.beneficiaries),
      },
    }));
  }, []);

  const addTag = (raw) => {
    const tag = String(raw ?? tagInput).trim().toLowerCase().replace(/^#+/, '').replace(/[^a-z0-9-]/g, '')
      .slice(0, TEMPLATE_LIMITS.tagLength);
    if (tag && form.tags.length < TEMPLATE_LIMITS.tags && !form.tags.includes(tag)) set({ tags: [...form.tags, tag] });
    setTagInput('');
  };

  const onImage = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      set({ thumbnail: await uploadImage(file) });
    } catch {
      toast.error(t('live.obs.form.uploadFailed'));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const save = async (e) => {
    e?.preventDefault();
    setNameError(null);
    setFormError(null);
    if (!form.name.trim() || !slug) { setNameError(t('live.obs.form.nameRequired')); return; }
    if (!form.title.trim()) { setFormError(t('live.obs.form.titleRequired')); return; }
    setSaving(true);
    try {
      const input = formToInput(form, { isPremium });
      const data = existing
        ? await updateTemplate(token, existing.id, input)
        : await createTemplate(token, input);
      toast.success(existing ? t('live.obs.form.saved') : t('live.obs.form.created'));
      onSaved(data.template);
    } catch (err) {
      const e2 = templateSaveError(err, t);
      if (e2.field === 'name') setNameError(e2.message); else setFormError(e2.message);
    } finally {
      setSaving(false);
    }
  };

  const visibilities = [
    { id: 'public', label: t('live.obs.form.visPublic'), desc: t('live.obs.form.visPublicDesc') },
    { id: 'hive-internal', label: t('live.obs.form.visHive'), desc: t('live.obs.form.visHiveDesc') },
    { id: 'unlisted', label: t('live.obs.form.visUnlisted'), desc: t('live.obs.form.visUnlistedDesc') },
  ];

  const visIcons = { public: 'public', 'hive-internal': 'key', unlisted: 'link' };

  return (
    <Sheet
      wide
      title={existing ? t('live.obs.form.editTitle') : t('live.obs.form.newTitle')}
      onClose={onClose}
      footer={(
        <>
          {formError && <span className="v2-field__err st-sheet__foot-error" role="alert">{formError}</span>}
          <Button variant="secondary" onClick={onClose} disabled={saving}>{t('common.actions.cancel')}</Button>
          <Button variant="primary" icon="check" onClick={save} disabled={saving || uploading} loading={saving}>
            {saving ? t('common.actions.saving') : t('common.actions.save')}
          </Button>
        </>
      )}
    >
      <form
        className="st-form"
        onSubmit={save}
        onKeyDown={(e) => { if (e.key === 'Enter' && e.target instanceof HTMLInputElement) e.preventDefault(); }}
      >
        <NameField
          value={form.name}
          onChange={(v) => { set({ name: v }); setNameError(null); }}
          whipBase={whipBase}
          user={user}
          error={nameError}
        />

        <label className="v2-field st-field">
          <span className="v2-eyebrow">{t('live.obs.form.title')}</span>
          <input
            className="v2-input"
            value={form.title}
            maxLength={TEMPLATE_LIMITS.title}
            placeholder={t('live.obs.form.titlePlaceholder')}
            onChange={(e) => set({ title: e.target.value })}
          />
        </label>

        <div className="v2-field st-field">
          <span className="v2-eyebrow">{t('live.obs.form.description')}</span>
          <MarkdownComposer
            value={form.description}
            onChange={(v) => set({ description: String(v ?? '').slice(0, TEMPLATE_LIMITS.description) })}
            placeholder={t('live.lobby.descriptionPlaceholder')}
          />
        </div>

        <div className="v2-field st-field">
          <span className="v2-eyebrow">{t('live.obs.form.thumbnail')}</span>
          <div className="st-thumb">
            {form.thumbnail
              ? <img src={form.thumbnail} alt="" />
              : <div className="st-thumb__empty"><Icon name="add_photo_alternate" size={24} /></div>}
            <div className="st-thumb__actions">
              {IMAGE_KEY && (
                <Button variant="secondary" size={36} icon="upload" onClick={() => fileRef.current?.click()} disabled={uploading} loading={uploading}>
                  {uploading ? t('live.obs.form.uploading') : t('live.obs.form.upload')}
                </Button>
              )}
              {form.thumbnail && (
                <Button variant="ghost" size={36} icon="close" onClick={() => set({ thumbnail: '' })}>
                  {t('common.actions.remove')}
                </Button>
              )}
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={onImage} />
            </div>
          </div>
        </div>

        <div className="v2-field st-field">
          <span className="v2-eyebrow">
            {t('live.obs.form.tags')} <span className="v2-field__opt num">({form.tags.length}/{TEMPLATE_LIMITS.tags})</span>
          </span>
          <div className="st-tags">
            {form.tags.map((tag) => (
              <span key={tag} className="st-tag">
                {tag}
                <button type="button" onClick={() => set({ tags: form.tags.filter((x) => x !== tag) })} aria-label={t('common.actions.remove')}>
                  <Icon name="close" size={14} />
                </button>
              </span>
            ))}
            {form.tags.length < TEMPLATE_LIMITS.tags && (
              <input
                className="st-tags__input"
                value={tagInput}
                placeholder={t('live.obs.form.tagsPlaceholder')}
                onChange={(e) => {
                  const v = e.target.value;
                  if (/[\s,]$/.test(v)) addTag(v); else setTagInput(v);
                }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
                onBlur={() => tagInput && addTag()}
              />
            )}
          </div>
        </div>

        <label className="v2-field st-field">
          <span className="v2-eyebrow">{t('live.obs.form.language')}</span>
          <select className="v2-input is-select" value={form.language} onChange={(e) => set({ language: e.target.value })}>
            {LANGUAGE_CODES.map((c) => <option key={c} value={c}>{languageName(c)}</option>)}
          </select>
        </label>

        <div className="v2-field st-field">
          <span className="v2-eyebrow">{t('live.obs.form.visibility')}</span>
          <div className="st-tiles" role="radiogroup" aria-label={t('live.obs.form.visibility')}>
            {visibilities.map((v) => (
              <ChoiceCard
                key={v.id}
                tone="cyan"
                icon={visIcons[v.id]}
                title={v.label}
                sub={v.desc}
                selected={form.visibility === v.id}
                className={cx('st-tile', form.visibility === v.id && 'is-active')}
                onClick={() => set({ visibility: v.id })}
              />
            ))}
          </div>
        </div>

        {/* Boost */}
        <div className="st-group">
          <SettingRow
            icon="rocket_launch"
            title={t('live.obs.form.boost')}
            control={<Toggle checked={!!form.boost.enabled} label={t('live.obs.form.boost')} onChange={(on) => setIn('boost', { enabled: on })} />}
          />
          {form.boost.enabled && (
            <div className="st-row">
              <label className="v2-field st-field">
                <span className="v2-eyebrow">{t('live.obs.form.minBoost')}</span>
                <input
                  className="v2-input num"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.boost.minBoostUsd}
                  onChange={(e) => setIn('boost', { minBoostUsd: e.target.value })}
                />
              </label>
              <label className="v2-field st-field">
                <span className="v2-eyebrow">{t('live.obs.form.payoutAccount')}</span>
                <input
                  className="v2-input"
                  maxLength={16}
                  value={form.boost.creatorPayoutAccount}
                  placeholder={t('live.obs.form.payoutPlaceholder')}
                  onChange={(e) => setIn('boost', { creatorPayoutAccount: e.target.value })}
                />
              </label>
            </div>
          )}
        </div>

        {/* Recording: Pro perks */}
        <div className="st-group">
          <span className="v2-eyebrow">{t('live.obs.form.whenEnds')}</span>
          {/* Everyone may publish the recording; a free one is as long as a free
              stream (the server stops it there). Clips stay Pro. */}
          <SettingRow
            icon="video_library"
            title={t('live.obs.form.publishVod')}
            sub={!isPremium ? t('live.obs.form.publishVodFree') : undefined}
            control={(
              <Toggle
                checked={!!form.recording.publishVod}
                label={t('live.obs.form.publishVod')}
                onChange={(on) => setIn('recording', { publishVod: on })}
              />
            )}
          />
          <SettingRow
            icon="content_cut"
            className={isPremium ? undefined : 'is-locked'}
            title={t('live.obs.form.allowClips')}
            sub={!isPremium ? t('live.obs.form.proOnly') : undefined}
            control={(
              <Toggle
                checked={isPremium && !!form.recording.allowClips}
                disabled={!isPremium}
                label={t('live.obs.form.allowClips')}
                onChange={(on) => setIn('recording', { allowClips: on })}
              />
            )}
          />
        </div>

        {/* Hive announcement */}
        <div className="st-group st-announce">
          <SettingRow
            icon="campaign"
            title={t('live.obs.form.announce')}
            sub={form.announce.enabled && form.visibility === 'unlisted' ? t('live.obs.form.announceUnlisted') : undefined}
            control={(
              <Toggle
                checked={!!form.announce.enabled}
                label={t('live.obs.form.announce')}
                onChange={(on) => setIn('announce', { enabled: on })}
              />
            )}
          />
          {form.announce.enabled && (
            <>
              <PostingAuthNotice user={user} />
              <AnnounceOptions
                announceType="post"
                isPremium={isPremium}
                initialConfig={announceInitial}
                onChange={onAnnounceChange}
              />
            </>
          )}
        </div>
      </form>
    </Sheet>
  );
}

// ─── Templates tab ─────────────────────────────────────────────────────────
/**
 * The "Templates" tab of the Stream Studio: the stream secret, the OBS guide
 * and the library (status, copy address, edit, delete). Needs a hangouts
 * session token; the studio page shows its own sign-in call to action without one.
 */
// `premiumKnown` is false while the Pro lookup is still running: the OBS block
// then waits instead of flashing the Pro notice at a Pro account.
export function StreamTemplatesPanel({ token, user, isPremium, premiumKnown = true, onUse }) {
  const { t } = useTranslation();
  const [data, setData] = useState({ status: 'idle', templates: [], whipBase: '', chatOverlayKey: '' });
  const [editing, setEditing] = useState(null);   // null | 'new' | template
  const [deleting, setDeleting] = useState(null); // template awaiting confirmation
  const [deleteBusy, setDeleteBusy] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const res = await listTemplates(token);
      setData({
        status: 'ready',
        templates: Array.isArray(res.templates) ? res.templates : [],
        whipBase: res.whipBase || '',
        chatOverlayKey: res.chatOverlayKey || '',
      });
    } catch {
      setData((d) => (d.status === 'ready' ? d : { ...d, status: 'error' }));
    }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  const onSaved = (tpl) => {
    setEditing(null);
    if (tpl?.id) {
      setData((d) => {
        const exists = d.templates.some((x) => x.id === tpl.id);
        return { ...d, templates: exists ? d.templates.map((x) => (x.id === tpl.id ? tpl : x)) : [...d.templates, tpl] };
      });
    }
    load();
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await deleteTemplate(token, deleting.id);
      setData((d) => ({ ...d, templates: d.templates.filter((x) => x.id !== deleting.id) }));
      toast.success(t('live.obs.deleted'));
      setDeleting(null);
    } catch (err) {
      if (err.code === 'not_found') {
        // Already gone (deleted elsewhere): drop it from the list too.
        setData((d) => ({ ...d, templates: d.templates.filter((x) => x.id !== deleting.id) }));
        setDeleting(null);
      } else {
        toast.error(err.code === 'live' ? t('live.obs.deleteLive') : t('live.obs.deleteFailed'));
      }
    } finally {
      setDeleteBusy(false);
    }
  };

  if (!token) {
    return (
      <EmptyState icon="link_off" title={t('live.obs.tabs.templates')} className="st-empty-state">
        {t('live.obs.connectNeeded')}
      </EmptyState>
    );
  }

  const atLimit = data.templates.length >= TEMPLATE_LIMITS.templates;
  const newButton = (
    <Button
      variant="primary"
      icon="add"
      onClick={() => setEditing('new')}
      disabled={atLimit || data.status !== 'ready'}
      title={atLimit ? t('live.obs.limitReached', { max: TEMPLATE_LIMITS.templates }) : undefined}
    >
      {t('live.obs.newTemplate')}
    </Button>
  );
  const obsReady = premiumKnown && isPremium;

  return (
    <div className={cx('stream-templates', obsReady && 'has-guide')}>
      <div className="st-main">
        <p className="st-intro">{t('live.obs.pageIntro')}</p>

        {premiumKnown && (isPremium ? (
          <>
            <SecretBox token={token} />
            <ChatUrlBox overlayKey={data.chatOverlayKey} />
          </>
        ) : (
          <ObsProNotice user={user} />
        ))}

        <div className="st-list-head">
          <h2>{t('live.obs.yourTemplates')}</h2>
          {newButton}
        </div>

        {data.status === 'idle' && (
          <p className="st-loading" role="status">
            <Icon name="progress_activity" size={18} className="v2-spin" />{t('live.obs.loading')}
          </p>
        )}
        {data.status === 'error' && (
          <div className="v2-failure st-gate" role="alert">
            <b>{t('live.obs.loadFailed')}</b>
            <Button
              variant="secondary"
              size={36}
              icon="refresh"
              onClick={() => { setData((d) => ({ ...d, status: 'idle' })); load(); }}
            >
              {t('common.actions.retry')}
            </Button>
          </div>
        )}
        {data.status === 'ready' && data.templates.length === 0 && (
          <EmptyState icon="sensors" title={t('live.obs.yourTemplates')} className="st-empty-state">
            {t('live.obs.empty')}
          </EmptyState>
        )}
        {data.status === 'ready' && data.templates.length > 0 && (
          <div className="st-grid">
            {data.templates.map((tpl) => (
              <TemplateCard key={tpl.id} tpl={tpl} token={token} obsAllowed={obsReady} onEdit={setEditing} onDelete={setDeleting} onUse={onUse} />
            ))}
          </div>
        )}
      </div>

      {obsReady && (
        <aside className="st-aside">
          <ObsGuide isPremium={isPremium} defaultOpen={data.status === 'ready' && data.templates.length === 0} />
        </aside>
      )}

      {editing && (
        <TemplateEditor
          token={token}
          user={user}
          whipBase={data.whipBase}
          existing={editing === 'new' ? null : editing}
          isPremium={isPremium}
          onSaved={onSaved}
          onClose={() => setEditing(null)}
        />
      )}
      {deleting && (
        <ConfirmSheet
          title={t('live.obs.deleteTitle')}
          text={t('live.obs.deleteConfirm', { name: deleting.name })}
          confirmLabel={t('common.actions.delete')}
          danger
          busy={deleteBusy}
          onConfirm={confirmDelete}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  );
}

// ─── "Start from a template" on the New stream form ────────────────────────
/**
 * A template picker above the browser create form, so a saved setup can be
 * streamed from the browser studio as well as from OBS. Renders nothing for a
 * host without templates (or while they load). `onPick(template)` loads it.
 */
export function TemplatePicker({ token, onPick }) {
  const { t } = useTranslation();
  const [templates, setTemplates] = useState([]);
  useEffect(() => {
    if (!token) return undefined;
    let alive = true;
    listTemplates(token)
      .then((res) => { if (alive) setTemplates(Array.isArray(res.templates) ? res.templates : []); })
      .catch(() => { /* no picker; the form works as before */ });
    return () => { alive = false; };
  }, [token]);
  if (!templates.length) return null;
  return (
    <label className="st-picker">
      <Icon name="bookmarks" size={18} className="st-picker__icon" />
      <span>{t('live.obs.pickTemplate')}</span>
      <select
        className="v2-input is-select"
        value=""
        onChange={(e) => {
          const tpl = templates.find((x) => x.id === e.target.value);
          if (tpl) onPick(tpl);
        }}
      >
        <option value="">{t('live.obs.pickTemplatePlaceholder')}</option>
        {templates.map((tpl) => <option key={tpl.id} value={tpl.id}>{tpl.name}</option>)}
      </select>
    </label>
  );
}

// ─── "Save as template" on the New stream form ─────────────────────────────
const COMMUNITY_RE = /^hive-\d{1,7}$/;

/**
 * Template input from the create form's draft (the SDK's CreateRoomDraft) plus
 * the announcement settings shown in AnnounceOptions, which live in the shared
 * announce store rather than in the SDK form.
 */
function draftToTemplateInput(name, draft, announceCfg, isPremium) {
  const notify = !!draft.notifyOnHive && draft.visibility !== 'unlisted';
  const community = COMMUNITY_RE.test(announceCfg?.community || '') ? announceCfg.community : 'hive-181335';
  return {
    name: name.trim(),
    title: (draft.title || '').trim().slice(0, TEMPLATE_LIMITS.title),
    description: (draft.description || '').slice(0, TEMPLATE_LIMITS.description),
    thumbnail: draft.thumbnail || '',
    tags: (draft.tags || []).slice(0, TEMPLATE_LIMITS.tags).map((x) => String(x).slice(0, TEMPLATE_LIMITS.tagLength)),
    language: draft.language || 'en',
    visibility: draft.visibility || 'public',
    boost: {
      enabled: !!draft.boost?.enabled,
      minBoostUsd: Number(draft.boost?.minBoostUsd) || 0,
      creatorPayoutAccount: String(draft.boost?.creatorPayoutAccount || '').trim().toLowerCase().replace(/^@/, ''),
    },
    // The VOD replaces the announcement's video, so like the create form it only
    // counts when the stream is announced. Free hosts too (clips stay Pro).
    recording: {
      publishVod: notify && !!draft.recording?.autoVod,
      allowClips: !!isPremium && !!draft.recording?.allowClips,
    },
    announce: {
      enabled: notify,
      community,
      communityTitle: announceCfg?.communityTitle || '',
      declineRewards: !!announceCfg?.declineRewards,
      rewardPowerup: !!announceCfg?.rewardPowerup,
      beneficiaries: (announceCfg?.beneList || [])
        .filter((b) => b && b.account && b.weight > 0)
        .slice(0, TEMPLATE_LIMITS.beneficiaries),
    },
  };
}

function SaveAsTemplateSheet({ draft, token, user, isPremium, getAnnounceConfig, onManage, onClose }) {
  const { t } = useTranslation();
  const [name, setName] = useState(() => (draft.title || '').slice(0, TEMPLATE_LIMITS.name));
  const [whipBase, setWhipBase] = useState('');
  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState(null);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(null); // the created template

  useEffect(() => {
    let alive = true;
    listTemplates(token)
      .then((res) => { if (alive) setWhipBase(res.whipBase || ''); })
      .catch(() => { /* the preview just lacks its base */ });
    return () => { alive = false; };
  }, [token]);

  const hasTitle = !!(draft.title || '').trim();

  const save = async () => {
    if (saving) return;
    setNameError(null);
    setError(null);
    if (!slugifyTemplateName(name)) { setNameError(t('live.obs.form.nameRequired')); return; }
    if (!hasTitle) { setError(t('live.obs.save.needTitle')); return; }
    setSaving(true);
    try {
      const input = draftToTemplateInput(name, draft, getAnnounceConfig(), isPremium);
      const data = await createTemplate(token, input);
      setSaved(data.template);
      toast.success(t('live.obs.form.created'));
    } catch (err) {
      const e2 = templateSaveError(err, t);
      if (e2.field === 'name') setNameError(e2.message); else setError(e2.message);
    } finally {
      setSaving(false);
    }
  };

  const copyUrl = async () => {
    if (await copyText(saved?.whipUrl || '')) toast.success(t('live.obs.card.urlCopied'));
    else toast.error(t('live.obs.copyFailed'));
  };

  if (saved) {
    return (
      <Sheet
        wide
        title={t('live.obs.save.savedTitle')}
        onClose={onClose}
        footer={(
          <>
            <Button variant="secondary" icon="bookmarks" onClick={onManage}>{t('live.obs.save.manage')}</Button>
            <Button variant="primary" icon="check" onClick={onClose}>{t('common.actions.done')}</Button>
          </>
        )}
      >
        <div className="stream-templates st-saved">
          <div className="v2-success st-saved__intro">
            <Icon name="check_circle" size={24} className="st-saved__ok" />
            <p className="st-intro">{t('live.obs.save.savedIntro', { name: saved.name })}</p>
          </div>
          <div className="v2-field st-field">
            <span className="v2-eyebrow">{t('live.obs.save.serverUrl')}</span>
            <div className="st-copyrow">
              <code className="st-copyrow__value">{saved.whipUrl}</code>
              <Button variant="secondary" icon="content_copy" onClick={copyUrl}>{t('common.actions.copy')}</Button>
            </div>
          </div>
          <SecretBox token={token} />
          <ObsGuide isPremium={isPremium} defaultOpen />
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet
      title={t('live.obs.save.title')}
      onClose={onClose}
      footer={(
        <>
          {error && <span className="v2-field__err st-sheet__foot-error" role="alert">{error}</span>}
          <Button variant="secondary" onClick={onClose} disabled={saving}>{t('common.actions.cancel')}</Button>
          <Button variant="primary" icon="bookmark_add" onClick={save} disabled={saving || !hasTitle} loading={saving}>
            {saving ? t('common.actions.saving') : t('live.obs.save.submit')}
          </Button>
        </>
      )}
    >
      <div className="stream-templates st-form">
        <p className="st-intro">{t('live.obs.save.intro')}</p>
        {!hasTitle && <Banner tone="warn">{t('live.obs.save.needTitle')}</Banner>}
        <NameField
          value={name}
          onChange={(v) => { setName(v); setNameError(null); }}
          whipBase={whipBase}
          user={user}
          error={nameError}
          autoFocus
          onEnter={save}
        />
      </div>
    </Sheet>
  );
}

/**
 * "Save as template" under the New stream form. Rendered by the SDK's
 * CreateRoomDialog (renderStandaloneExtras) with the form's current values;
 * the sheet works on a snapshot taken at the click, so editing the form behind
 * it changes nothing. Saving never creates a room: the host can still go on and
 * start a browser stream.
 */
export function SaveAsTemplate({ draft, token, user, isPremium, getAnnounceConfig, onManage }) {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState(null);
  return (
    <div className="stream-templates st-save">
      <Button
        variant="secondary"
        size={48}
        block
        trailing="bookmark_add"
        className="st-save__btn"
        onClick={() => setSnapshot(draft)}
        disabled={!token}
      >
        {t('live.obs.save.button')}
      </Button>
      <span className="st-save__hint">{t('live.obs.save.hint')}</span>
      {snapshot && (
        <SaveAsTemplateSheet
          draft={snapshot}
          token={token}
          user={user}
          isPremium={isPremium}
          getAnnounceConfig={getAnnounceConfig}
          onManage={() => { setSnapshot(null); onManage?.(); }}
          onClose={() => setSnapshot(null)}
        />
      )}
    </div>
  );
}
