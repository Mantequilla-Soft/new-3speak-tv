import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Copy, Eye, EyeOff, Pencil, Plus, RefreshCw, Trash2, X, ImagePlus, Radio, ChevronDown, Clapperboard, MessageSquare } from 'lucide-react';
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

/** Centred dialog on desktop, bottom sheet on phones. Portalled to <body>. */
function Sheet({ title, onClose, children, footer, wide = false }) {
  const { t } = useTranslation();
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal(
    <div className="st-sheet-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className={`st-sheet${wide ? ' st-sheet--wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="st-sheet__head">
          <h3>{title}</h3>
          <button type="button" className="st-icon-btn" onClick={onClose} aria-label={t('common.actions.close')}>
            <X size={18} />
          </button>
        </div>
        <div className="st-sheet__body">{children}</div>
        {footer && <div className="st-sheet__foot">{footer}</div>}
      </div>
    </div>,
    document.body,
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
          <button type="button" className="st-btn st-btn--ghost" onClick={onCancel} disabled={busy}>{t('common.actions.cancel')}</button>
          <button type="button" className={`st-btn ${danger ? 'st-btn--danger' : 'st-btn--primary'}`} onClick={onConfirm} disabled={busy}>
            {confirmLabel}
          </button>
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
    <section className="st-secret">
      <div className="st-secret__text">
        <h2>{t('live.obs.secret.title')}</h2>
        <p>{t('live.obs.secret.desc')}</p>
      </div>
      <div className="st-secret__row">
        <code className={`st-secret__value${revealed ? '' : ' is-masked'}`}>
          {revealed && secret ? secret : '••••••••••••••••••••••••'}
        </code>
        <div className="st-secret__actions">
          <button type="button" className="st-btn st-btn--ghost" onClick={reveal} disabled={busy}>
            {revealed ? <EyeOff size={15} /> : <Eye size={15} />}
            <span>{revealed ? t('live.obs.secret.hide') : t('live.obs.secret.reveal')}</span>
          </button>
          <button type="button" className="st-btn st-btn--ghost" onClick={copy} disabled={busy}>
            <Copy size={15} /><span>{t('common.actions.copy')}</span>
          </button>
          <button type="button" className="st-btn st-btn--danger" onClick={() => setConfirmReset(true)} disabled={busy}>
            <RefreshCw size={15} /><span>{t('common.actions.reset')}</span>
          </button>
        </div>
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

// ─── OBS guide ─────────────────────────────────────────────────────────────
function ObsGuide({ isPremium, defaultOpen }) {
  const { t } = useTranslation();
  // Follows `defaultOpen` (open while there are no templates yet) until the
  // reader toggles it themselves.
  const [openPick, setOpen] = useState(null);
  const open = openPick ?? defaultOpen;
  return (
    <section className={`st-guide${open ? ' is-open' : ''}`}>
      <button type="button" className="st-guide__toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span>{t('live.obs.guide.title')}</span>
        <ChevronDown size={18} />
      </button>
      {open && (
        <div className="st-guide__body">
          <ol className="st-guide__steps">
            <li>{t('live.obs.guide.step1')}</li>
            <li>{t('live.obs.guide.step2')}</li>
            <li>{t('live.obs.guide.step3')}</li>
            <li>{t('live.obs.guide.step4')}</li>
            <li>{t('live.obs.guide.step5')}</li>
          </ol>
          <h4>{t('live.obs.guide.outputTitle')}</h4>
          <ul className="st-guide__list">
            <li>{t('live.obs.guide.keyframe')}</li>
            <li>{t('live.obs.guide.bitrate')}</li>
            <li>{t('live.obs.guide.encoder')}</li>
            <li>{t('live.obs.guide.audio')}</li>
            <li>{t('live.obs.guide.bframes')}</li>
          </ul>
          <h4>{t('live.obs.guide.chatTitle')}</h4>
          <ol className="st-guide__steps">
            <li>{t('live.obs.guide.chat1')}</li>
            <li>{t('live.obs.guide.chat2')}</li>
            <li>{t('live.obs.guide.chat3')}</li>
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

function TemplateCard({ tpl, token, onEdit, onDelete, onUse }) {
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

  // OBS Browser Source for this template's live chat (see page/ObsChatOverlay).
  const copyChatUrl = async () => {
    const url = `${window.location.origin}/obs/chat?key=${encodeURIComponent(tpl.chatOverlayKey || '')}`;
    if (await copyText(url)) toast.success(t('live.obs.card.chatUrlCopied'));
    else toast.error(t('live.obs.copyFailed'));
  };

  return (
    <article ref={ref} className={`st-card st-card--${state}`}>
      <div className="st-card__thumb">
        {tpl.thumbnail ? <img src={tpl.thumbnail} alt="" loading="lazy" /> : <Radio size={28} />}
        <span className={`st-badge st-badge--${state}`}>{t(`live.obs.state.${state}`, { defaultValue: state })}</span>
      </div>
      <div className="st-card__body">
        <div className="st-card__name">{tpl.name}</div>
        <div className="st-card__title">{tpl.title}</div>
        <code className="st-card__url" title={tpl.whipUrl}>{tpl.whipUrl}</code>
        {state === 'live' && ingress && (
          <div className="st-card__ingress">
            {[ingress.width && ingress.height ? `${ingress.width}×${ingress.height}` : null,
              ingress.bitrate ? `${Math.round(ingress.bitrate / 1000)} kbps` : null,
              ingress.fps ? `${Math.round(ingress.fps)} fps` : null].filter(Boolean).join(' · ')}
          </div>
        )}
        {state === 'live' && status?.room && (
          <Link className="st-card__watch" to={`/watch/${encodeURIComponent(status.room)}`}>{t('live.obs.card.watch')}</Link>
        )}
        {status?.announced && status.announced.ok === false
          && tpl.announce?.enabled && tpl.visibility !== 'unlisted' && (
          <div className="st-card__warn">
            {status.announced.reason === 'no_posting_authority'
              ? t('live.obs.card.notAnnouncedAuth')
              : t('live.obs.card.notAnnounced')}
          </div>
        )}
        {/* We gave up on the session, but OBS may still think it is live. */}
        {state === 'idle' && status?.lastEnd?.reason === 'never_published' && (
          <div className="st-card__warn">{t('live.obs.card.stuck')}</div>
        )}
        <div className="st-card__meta">
          {lastLive
            ? t('live.obs.card.lastLive', { date: lastLive.toLocaleString(getLanguage(), { dateStyle: 'medium', timeStyle: 'short' }) })
            : t('live.obs.card.neverLive')}
        </div>
        <div className="st-card__actions">
          {/* The browser studio, no OBS: fills "New stream" from this template. */}
          {onUse && (
            <button type="button" className="st-btn st-btn--ghost" onClick={() => onUse(tpl)}>
              <Clapperboard size={15} /><span>{t('live.obs.card.useInStudio')}</span>
            </button>
          )}
          <button type="button" className="st-btn st-btn--ghost" onClick={copyUrl}>
            <Copy size={15} /><span>{t('live.obs.card.copyUrl')}</span>
          </button>
          {tpl.chatOverlayKey && (
            <button type="button" className="st-btn st-btn--ghost" onClick={copyChatUrl}>
              <MessageSquare size={15} /><span>{t('live.obs.card.copyChatUrl')}</span>
            </button>
          )}
          <button type="button" className="st-btn st-btn--ghost" onClick={() => onEdit(tpl)}>
            <Pencil size={15} /><span>{t('common.actions.edit')}</span>
          </button>
          <button type="button" className="st-btn st-btn--danger" onClick={() => onDelete(tpl)} disabled={state === 'live'}>
            <Trash2 size={15} /><span>{t('common.actions.delete')}</span>
          </button>
        </div>
      </div>
    </article>
  );
}

// ─── Name → stream address ─────────────────────────────────────────────────
/** The template name field, with the stream address it turns into. */
function NameField({ value, onChange, whipBase, user, error, autoFocus = false, onEnter }) {
  const { t } = useTranslation();
  const slug = slugifyTemplateName(value);
  return (
    <label className="st-field">
      <span className="st-field__label">{t('live.obs.form.name')}</span>
      <input
        className="st-input"
        value={value}
        maxLength={TEMPLATE_LIMITS.name}
        placeholder={t('live.obs.form.namePlaceholder')}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onEnter?.(); } }}
      />
      <span className="st-field__hint">{t('live.obs.form.nameHint')}</span>
      <code className="st-field__preview">{`${whipBase || ''}/${user}/${slug || '…'}`}</code>
      {error && <span className="st-field__error">{error}</span>}
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
      <p>{t('live.obs.form.authNeeded')}</p>
      <button type="button" className="st-btn st-btn--primary" onClick={grant} disabled={busy}>
        {busy ? t('settings.postingAuth.adding') : t('live.obs.form.authGrant')}
      </button>
      {error && <p className="st-field__error">{error}</p>}
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

  return (
    <Sheet
      wide
      title={existing ? t('live.obs.form.editTitle') : t('live.obs.form.newTitle')}
      onClose={onClose}
      footer={(
        <>
          {formError && <span className="st-field__error st-sheet__foot-error">{formError}</span>}
          <button type="button" className="st-btn st-btn--ghost" onClick={onClose} disabled={saving}>{t('common.actions.cancel')}</button>
          <button type="button" className="st-btn st-btn--primary" onClick={save} disabled={saving || uploading}>
            {saving ? t('common.actions.saving') : t('common.actions.save')}
          </button>
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

        <label className="st-field">
          <span className="st-field__label">{t('live.obs.form.title')}</span>
          <input
            className="st-input"
            value={form.title}
            maxLength={TEMPLATE_LIMITS.title}
            placeholder={t('live.obs.form.titlePlaceholder')}
            onChange={(e) => set({ title: e.target.value })}
          />
        </label>

        <div className="st-field">
          <span className="st-field__label">{t('live.obs.form.description')}</span>
          <MarkdownComposer
            value={form.description}
            onChange={(v) => set({ description: String(v ?? '').slice(0, TEMPLATE_LIMITS.description) })}
            placeholder={t('live.lobby.descriptionPlaceholder')}
          />
        </div>

        <div className="st-field">
          <span className="st-field__label">{t('live.obs.form.thumbnail')}</span>
          <div className="st-thumb">
            {form.thumbnail
              ? <img src={form.thumbnail} alt="" />
              : <div className="st-thumb__empty"><ImagePlus size={24} /></div>}
            <div className="st-thumb__actions">
              {IMAGE_KEY && (
                <button type="button" className="st-btn st-btn--ghost" onClick={() => fileRef.current?.click()} disabled={uploading}>
                  {uploading ? t('live.obs.form.uploading') : t('live.obs.form.upload')}
                </button>
              )}
              {form.thumbnail && (
                <button type="button" className="st-btn st-btn--ghost" onClick={() => set({ thumbnail: '' })}>
                  {t('common.actions.remove')}
                </button>
              )}
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={onImage} />
            </div>
          </div>
        </div>

        <div className="st-field">
          <span className="st-field__label">
            {t('live.obs.form.tags')} <em>({form.tags.length}/{TEMPLATE_LIMITS.tags})</em>
          </span>
          <div className="st-tags">
            {form.tags.map((tag) => (
              <span key={tag} className="st-tag">
                {tag}
                <button type="button" onClick={() => set({ tags: form.tags.filter((x) => x !== tag) })} aria-label={t('common.actions.remove')}>×</button>
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

        <label className="st-field">
          <span className="st-field__label">{t('live.obs.form.language')}</span>
          <select className="st-input" value={form.language} onChange={(e) => set({ language: e.target.value })}>
            {LANGUAGE_CODES.map((c) => <option key={c} value={c}>{languageName(c)}</option>)}
          </select>
        </label>

        <div className="st-field">
          <span className="st-field__label">{t('live.obs.form.visibility')}</span>
          <div className="st-tiles">
            {visibilities.map((v) => (
              <button
                key={v.id}
                type="button"
                className={`st-tile${form.visibility === v.id ? ' is-active' : ''}`}
                onClick={() => set({ visibility: v.id })}
              >
                <strong>{v.label}</strong>
                <span>{v.desc}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Boost */}
        <div className="st-field">
          <label className="st-check">
            <input type="checkbox" checked={!!form.boost.enabled} onChange={(e) => setIn('boost', { enabled: e.target.checked })} />
            <span>{t('live.obs.form.boost')}</span>
          </label>
          {form.boost.enabled && (
            <div className="st-row">
              <label className="st-field">
                <span className="st-field__label">{t('live.obs.form.minBoost')}</span>
                <input
                  className="st-input"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.boost.minBoostUsd}
                  onChange={(e) => setIn('boost', { minBoostUsd: e.target.value })}
                />
              </label>
              <label className="st-field">
                <span className="st-field__label">{t('live.obs.form.payoutAccount')}</span>
                <input
                  className="st-input"
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
        <div className="st-field">
          <span className="st-field__label">{t('live.obs.form.whenEnds')}</span>
          <label className={`st-check${isPremium ? '' : ' is-locked'}`}>
            <input
              type="checkbox"
              disabled={!isPremium}
              checked={isPremium && !!form.recording.publishVod}
              onChange={(e) => setIn('recording', { publishVod: e.target.checked })}
            />
            <span>
              {t('live.obs.form.publishVod')}
              {!isPremium && <em className="st-pro-hint">{t('live.obs.form.proOnly')}</em>}
            </span>
          </label>
          <label className={`st-check${isPremium ? '' : ' is-locked'}`}>
            <input
              type="checkbox"
              disabled={!isPremium}
              checked={isPremium && !!form.recording.allowClips}
              onChange={(e) => setIn('recording', { allowClips: e.target.checked })}
            />
            <span>
              {t('live.obs.form.allowClips')}
              {!isPremium && <em className="st-pro-hint">{t('live.obs.form.proOnly')}</em>}
            </span>
          </label>
        </div>

        {/* Hive announcement */}
        <div className="st-field st-announce">
          <label className="st-check">
            <input
              type="checkbox"
              checked={!!form.announce.enabled}
              onChange={(e) => setIn('announce', { enabled: e.target.checked })}
            />
            <span>{t('live.obs.form.announce')}</span>
          </label>
          {form.announce.enabled && form.visibility === 'unlisted' && (
            <p className="st-field__hint">{t('live.obs.form.announceUnlisted')}</p>
          )}
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
export function StreamTemplatesPanel({ token, user, isPremium, onUse }) {
  const { t } = useTranslation();
  const [data, setData] = useState({ status: 'idle', templates: [], whipBase: '' });
  const [editing, setEditing] = useState(null);   // null | 'new' | template
  const [deleting, setDeleting] = useState(null); // template awaiting confirmation
  const [deleteBusy, setDeleteBusy] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const res = await listTemplates(token);
      setData({ status: 'ready', templates: Array.isArray(res.templates) ? res.templates : [], whipBase: res.whipBase || '' });
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

  if (!token) return <p className="st-empty">{t('live.obs.connectNeeded')}</p>;

  const atLimit = data.templates.length >= TEMPLATE_LIMITS.templates;

  return (
    <div className="stream-templates">
      <p className="st-intro">{t('live.obs.pageIntro')}</p>

      <SecretBox token={token} />

      <ObsGuide isPremium={isPremium} defaultOpen={data.status === 'ready' && data.templates.length === 0} />

      <div className="st-list-head">
        <h2>{t('live.obs.yourTemplates')}</h2>
        <button
          type="button"
          className="st-btn st-btn--primary"
          onClick={() => setEditing('new')}
          disabled={atLimit || data.status !== 'ready'}
          title={atLimit ? t('live.obs.limitReached', { max: TEMPLATE_LIMITS.templates }) : undefined}
        >
          <Plus size={16} /><span>{t('live.obs.newTemplate')}</span>
        </button>
      </div>

      {data.status === 'idle' && <p className="st-empty">{t('live.obs.loading')}</p>}
      {data.status === 'error' && (
        <div className="st-gate">
          <p>{t('live.obs.loadFailed')}</p>
          <button
            type="button"
            className="st-btn st-btn--ghost"
            onClick={() => { setData((d) => ({ ...d, status: 'idle' })); load(); }}
          >
            {t('common.actions.retry')}
          </button>
        </div>
      )}
      {data.status === 'ready' && data.templates.length === 0 && (
        <p className="st-empty">{t('live.obs.empty')}</p>
      )}
      {data.status === 'ready' && data.templates.length > 0 && (
        <div className="st-grid">
          {data.templates.map((tpl) => (
            <TemplateCard key={tpl.id} tpl={tpl} token={token} onEdit={setEditing} onDelete={setDeleting} onUse={onUse} />
          ))}
        </div>
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
      <span>{t('live.obs.pickTemplate')}</span>
      <select
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
    // Pro perks. The VOD replaces the announcement's video, so like the create
    // form it only counts when the stream is announced.
    recording: {
      publishVod: !!isPremium && notify && !!draft.recording?.autoVod,
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
            <button type="button" className="st-btn st-btn--ghost" onClick={onManage}>{t('live.obs.save.manage')}</button>
            <button type="button" className="st-btn st-btn--primary" onClick={onClose}>{t('common.actions.done')}</button>
          </>
        )}
      >
        <div className="stream-templates st-saved">
          <p className="st-intro">{t('live.obs.save.savedIntro', { name: saved.name })}</p>
          <div className="st-field">
            <span className="st-field__label">{t('live.obs.save.serverUrl')}</span>
            <div className="st-secret__row">
              <code className="st-secret__value">{saved.whipUrl}</code>
              <button type="button" className="st-btn st-btn--ghost" onClick={copyUrl}>
                <Copy size={15} /><span>{t('common.actions.copy')}</span>
              </button>
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
          {error && <span className="st-field__error st-sheet__foot-error">{error}</span>}
          <button type="button" className="st-btn st-btn--ghost" onClick={onClose} disabled={saving}>{t('common.actions.cancel')}</button>
          <button type="button" className="st-btn st-btn--primary" onClick={save} disabled={saving || !hasTitle}>
            {saving ? t('common.actions.saving') : t('live.obs.save.submit')}
          </button>
        </>
      )}
    >
      <div className="stream-templates st-form">
        <p className="st-intro">{t('live.obs.save.intro')}</p>
        {!hasTitle && <p className="st-field__error">{t('live.obs.save.needTitle')}</p>}
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
      <button
        type="button"
        className="st-btn st-btn--ghost"
        onClick={() => setSnapshot(draft)}
        disabled={!token}
      >
        <Radio size={15} /><span>{t('live.obs.save.button')}</span>
      </button>
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
