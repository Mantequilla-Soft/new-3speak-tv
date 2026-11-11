import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../lib/store';
import {
  getAllLanguages,
  subscribeLanguages,
  getEnglishResources,
  loadBundledFlat,
  fetchOverlay,
  applyLiveChanges,
  registerCommunityLanguages,
  loadCommunityLanguages,
  getLanguage,
  formatNumber,
  formatTimeAgo,
  LANGUAGES,
} from '../../i18n';
import {
  flatten,
  pluralCategories,
  validateEntry,
  validateLanguageName,
  LANG_CODE_RE,
  PLURAL_SUFFIX,
  proofHash,
} from '../../i18n/rules';
import {
  fetchTranslatorStatus,
  verifyAccount,
  saveStrings,
  addLanguage,
  fetchProofread,
  saveProofread,
} from '../../lib/translatorApi';
import { AREA_INFO } from './areaInfo';
import { toastIn } from '../../utils/toast';
import { Button, Checkbox, Dialog, Field, Icon, StatusPill } from '../../components/v2/ui';
import { cx } from '../../components/v2/helpers';
import './Translate.scss';

const toast = toastIn('Settings');

const CONTRIBUTE_URL = 'https://github.com/Mantequilla-Soft/new-3speak-tv/blob/develop/TRANSLATING.md';
const BATCH = 200;
const PAGE = 150;
const PROOF_BATCH = 500;
const PROOF_DEBOUNCE_MS = 600;
const has = (obj, k) => Object.prototype.hasOwnProperty.call(obj, k);
// Floored to 0.1%: whole percent hid single ticks in big areas (1 of 200 = 0.5%).
const percent = (done, total) => formatNumber(total ? Math.floor((done / total) * 1000) / 1000 : 1, { style: 'percent', maximumFractionDigits: 1 });

/**
 * /translate: the in-app translation editor, for accounts on the server's
 * TRANSLATORS list. Everyone else gets a friendly "not available" page; the
 * server refuses their writes anyway (server/i18n-editor.cjs), this page only
 * decides what to show.
 */
export default function Translate() {
  const { t } = useTranslation();
  const { authenticated, user } = useAppStore();
  const [status, setStatus] = useState(null);
  const [verifying, setVerifying] = useState(false);

  const refresh = useCallback(() => {
    fetchTranslatorStatus().then(setStatus);
  }, []);
  useEffect(() => { refresh(); }, [refresh, user]);

  if (!status) {
    return (
      <div className="translate-page translate-gate">
        <div className="v2-card translate-gate__card" role="status">
          <Icon name="progress_activity" size={20} className="v2-spin translate-gate__spin" />
          <p className="translate-muted">{t('translator.loading')}</p>
        </div>
      </div>
    );
  }

  if (!status.translator) {
    // Signed in here but the server cannot see a proven session yet: a wallet
    // login has to sign a one-time challenge first.
    const canVerify = !status.user && authenticated && !!user;
    const verify = async () => {
      setVerifying(true);
      const ok = await verifyAccount();
      setVerifying(false);
      if (!ok) toast.error(t('translator.verify.failed'));
      refresh();
    };
    return (
      <div className="translate-page translate-gate">
        <div className="v2-card translate-gate__card">
          <span className="translate-gate__icon" aria-hidden="true"><Icon name="translate" size={22} /></span>
          <h1>{t('translator.notAvailable.title')}</h1>
          <p className="translate-muted">{t('translator.notAvailable.body')}</p>
          <a className="translate-gate__link" href={CONTRIBUTE_URL} target="_blank" rel="noopener noreferrer">
            {t('translator.notAvailable.contribute')}
            <Icon name="open_in_new" size={14} />
          </a>
          {canVerify && (
            <>
              <hr className="v2-divider" />
              <p className="translate-muted">{t('translator.verify.body')}</p>
              <Button variant="inverse" size={40} block loading={verifying} disabled={verifying} onClick={verify}>
                {verifying ? t('translator.loading') : t('translator.verify.button')}
              </Button>
            </>
          )}
        </div>
      </div>
    );
  }

  return <Editor me={status.user} />;
}

// ---- Editor -----------------------------------------------------------------------

function AutoTextarea({ value, onChange, invalid, lang, dir, label }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      rows={1}
      className={`translate-input${invalid ? ' is-invalid' : ''}`}
      value={value}
      lang={lang}
      dir={dir}
      aria-label={label}
      aria-invalid={invalid || undefined}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function buildRows(englishFlat, categories) {
  const rows = [];
  for (const [key, text] of Object.entries(englishFlat)) {
    const m = key.match(PLURAL_SUFFIX);
    const area = key.split('.')[0];
    if (!m) { rows.push({ key, area, english: text }); continue; }
    if (m[1] !== 'other') continue; // one group per plural, built from _other
    const base = key.replace(PLURAL_SUFFIX, '');
    for (const c of categories) {
      const k = `${base}_${c}`;
      rows.push({ key: k, area, english: englishFlat[k] ?? text, plural: c });
    }
  }
  return rows;
}

/**
 * Proofreading: which rows count as proofread for the shown texts. A row needs
 * proofreading when it has a text (overlay ?? bundled) and no mark whose hash is
 * proofHash(that text); a mark with another hash is stale ("changed since check").
 */
function proofStatus(rows, hashes, marks) {
  const ok = new Set();
  const stale = new Set();
  const areas = {};
  let done = 0;
  let total = 0;
  for (const r of rows) {
    const h = hashes[r.key];
    if (!h) continue; // no text yet: nothing to proofread
    const a = (areas[r.area] ||= { done: 0, total: 0 });
    a.total++;
    total++;
    const m = marks[r.key];
    if (m && m.hash === h) { ok.add(r.key); a.done++; done++; } else if (m) stale.add(r.key);
  }
  return { ok, stale, areas, done, total, needs: total - done };
}

function Editor({ me }) {
  const { t } = useTranslation();
  const allLanguages = useSyncExternalStore(subscribeLanguages, getAllLanguages);
  const targets = useMemo(() => allLanguages.filter((l) => l.code !== 'en'), [allLanguages]);
  const englishNested = useMemo(() => getEnglishResources(), []);
  const englishFlat = useMemo(() => flatten(englishNested), [englishNested]);
  const areas = useMemo(() => Object.keys(englishNested).sort(), [englishNested]);

  const [lang, setLang] = useState(() => {
    const ui = getLanguage();
    return ui && ui !== 'en' ? ui : (getAllLanguages().find((l) => l.code !== 'en')?.code || '');
  });
  // The loaded language's texts; `loading` is derived, so no setState in effects.
  // `marks` is null when there is nothing to proofread (English) or loading failed;
  // `proofAtLoad` says whether the proofread UI shows (sticky for this visit).
  const [loaded, setLoaded] = useState({ lang: null, bundled: {}, overlay: {}, marks: null, proofAtLoad: false });
  const loading = loaded.lang !== lang;
  const bundled = loaded.bundled;
  const overlay = loaded.overlay;
  const marks = loaded.marks;
  const setOverlay = (fn) => setLoaded((s) => ({ ...s, overlay: fn(s.overlay) }));
  const [drafts, setDrafts] = useState({}); // key -> string | null (null = reset)
  const [serverErrors, setServerErrors] = useState({});
  const [area, setArea] = useState(areas[0] || '');
  const [search, setSearch] = useState('');
  const [missingOnly, setMissingOnly] = useState(false);
  const [communityOnly, setCommunityOnly] = useState(false);
  const [unproofreadOnly, setUnproofreadOnly] = useState(false);
  // "Show more" count, reset whenever the filters change (keyed by them).
  const [paging, setPaging] = useState({ sig: '', n: PAGE });
  const [saving, setSaving] = useState(false);
  const [showAdd, setShowAdd] = useState(false);

  useEffect(() => { loadCommunityLanguages(); }, []);

  const langInfo = allLanguages.find((l) => l.code === lang);
  const categories = useMemo(() => (lang ? pluralCategories(lang) : ['one', 'other']), [lang]);
  const rows = useMemo(() => buildRows(englishFlat, categories), [englishFlat, categories]);

  // Load the target language: bundled text + the live overlay, fresh, plus the
  // proofread marks for any non-English language.
  useEffect(() => {
    if (!lang) return undefined;
    let alive = true;
    Promise.all([
      loadBundledFlat(lang).catch(() => ({})),
      fetchOverlay(lang, { fresh: true }),
      lang === 'en' ? null : fetchProofread(lang),
    ]).then(([b, o, p]) => {
      if (!alive) return;
      const bundledFlat = b || {};
      const overlayFlat = o || {};
      let marksFlat = null;
      if (p && p.ok && p.data?.marks && typeof p.data.marks === 'object') marksFlat = p.data.marks;
      else if (p) toast.error(t('translator.proofread.loadFailed'));
      // Bundled languages were machine-translated, so they always get the
      // proofread UI. A community language only once it holds text nobody has
      // checked (new English strings machine-translated into it); one written
      // entirely in the editor is all auto-marked and keeps the UI hidden.
      const isBundled = LANGUAGES.some((l) => l.code === lang && l.code !== 'en');
      let proofAtLoad = false;
      if (marksFlat) {
        if (isBundled) proofAtLoad = true;
        else {
          for (const r of rows) {
            const v = overlayFlat[r.key] ?? bundledFlat[r.key] ?? '';
            if (v && marksFlat[r.key]?.hash !== proofHash(v)) { proofAtLoad = true; break; }
          }
        }
      }
      setLoaded({ lang, bundled: bundledFlat, overlay: overlayFlat, marks: marksFlat, proofAtLoad });
    });
    return () => { alive = false; };
  }, [lang, rows, t]);

  const valueOf = useCallback((key) => {
    if (Object.prototype.hasOwnProperty.call(drafts, key)) {
      return drafts[key] === null ? (bundled[key] ?? '') : drafts[key];
    }
    return overlay[key] ?? bundled[key] ?? '';
  }, [drafts, overlay, bundled]);

  const dirtyKeys = useMemo(() => Object.keys(drafts).filter((k) => {
    const d = drafts[k];
    if (d === null) return Object.prototype.hasOwnProperty.call(overlay, k);
    return d !== (overlay[k] ?? bundled[k] ?? '');
  }), [drafts, overlay, bundled]);

  const dirtySet = useMemo(() => new Set(dirtyKeys), [dirtyKeys]);

  const clientErrors = useMemo(() => {
    const out = {};
    for (const k of dirtyKeys) {
      if (drafts[k] === null) continue;
      const err = validateEntry(k, drafts[k], englishFlat, categories);
      if (err) out[k] = err;
    }
    return out;
  }, [dirtyKeys, drafts, englishFlat, categories]);

  // Unsaved-work guard: closing/reloading the tab, and in-app links.
  useEffect(() => {
    if (!dirtyKeys.length) return undefined;
    const onBeforeUnload = (e) => { e.preventDefault(); e.returnValue = ''; };
    const onClick = (e) => {
      const a = e.target?.closest?.('a[href]');
      if (!a || a.target === '_blank' || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (!window.confirm(t('translator.unsavedConfirm'))) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [dirtyKeys.length, t]);

  const progress = useMemo(() => {
    const out = {};
    for (const r of rows) {
      const p = (out[r.area] ||= { done: 0, total: 0 });
      p.total++;
      if (overlay[r.key] || bundled[r.key]) p.done++;
    }
    return out;
  }, [rows, overlay, bundled]);

  // Fingerprints of the texts shown now (overlay ?? bundled), for proofreading.
  const marksLoaded = !!marks;
  const hashes = useMemo(() => {
    const out = {};
    if (!marksLoaded) return out;
    for (const r of rows) {
      const v = overlay[r.key] ?? bundled[r.key] ?? '';
      if (v) out[r.key] = proofHash(v);
    }
    return out;
  }, [rows, overlay, bundled, marksLoaded]);
  const proof = useMemo(() => (marks ? proofStatus(rows, hashes, marks) : null), [rows, hashes, marks]);
  const showProof = !!proof && lang !== 'en' && !loading && (loaded.proofAtLoad || proof.needs > 0);
  const filterUnproofread = showProof && unproofreadOnly;

  const q = search.trim().toLowerCase();
  const visible = useMemo(() => rows.filter((r) => {
    if (!q && r.area !== area) return false;
    if (missingOnly && (overlay[r.key] || bundled[r.key])) return false;
    if (communityOnly && !Object.prototype.hasOwnProperty.call(overlay, r.key)) return false;
    if (filterUnproofread && (!hashes[r.key] || proof.ok.has(r.key))) return false;
    if (q) {
      const hay = `${r.key}\n${r.english}\n${overlay[r.key] ?? bundled[r.key] ?? ''}\n${drafts[r.key] ?? ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }), [rows, area, q, missingOnly, communityOnly, filterUnproofread, hashes, proof, overlay, bundled, drafts]);

  const pageSig = JSON.stringify([area, q, missingOnly, communityOnly, filterUnproofread, lang]);
  const limit = paging.sig === pageSig ? paging.n : PAGE;
  const showMore = () => setPaging({ sig: pageSig, n: limit + PAGE });

  const edit = (key, value) => {
    setDrafts((d) => ({ ...d, [key]: value }));
    setServerErrors((e) => {
      if (!e[key]) return e;
      const next = { ...e };
      delete next[key];
      return next;
    });
  };
  const discard = (key) => setDrafts((d) => {
    const next = { ...d };
    delete next[key];
    return next;
  });

  const confirmDiscard = () => !dirtyKeys.length || window.confirm(t('translator.unsavedConfirm'));

  // ---- proofread ticks: optimistic, batched, reverted on failure ----
  const setMarks = useCallback((forLang, fn) => setLoaded((s) => (
    s.lang === forLang && s.marks ? { ...s, marks: fn(s.marks) } : s
  )), []);
  // { lang, marks: { key: { checked, hash } }, prev: { key: mark | null } }
  const pendingProof = useRef(null);
  const proofTimer = useRef(null);

  const flushProof = useCallback(async () => {
    clearTimeout(proofTimer.current);
    proofTimer.current = null;
    const p = pendingProof.current;
    pendingProof.current = null;
    if (!p) return;
    const keys = Object.keys(p.marks);
    for (let i = 0; i < keys.length; i += PROOF_BATCH) {
      const chunk = keys.slice(i, i + PROOF_BATCH);
      let r;
      try {
        r = await saveProofread(p.lang, Object.fromEntries(chunk.map((k) => [k, p.marks[k]])));
      } catch (e) {
        r = { ok: false, status: 0, data: { error: e?.message || '' } };
      }
      if (r.ok) {
        const server = r.data?.marks || {};
        setMarks(p.lang, (m) => {
          const next = { ...m };
          for (const k of chunk) if (p.marks[k].checked && server[k]) next[k] = server[k];
          return next;
        });
        continue;
      }
      // Put back what the server had, except rows ticked again meanwhile.
      const failed = keys.slice(i);
      const newer = pendingProof.current?.lang === p.lang ? pendingProof.current.marks : {};
      setMarks(p.lang, (m) => {
        const next = { ...m };
        for (const k of failed) {
          if (has(newer, k)) continue;
          if (p.prev[k]) next[k] = p.prev[k];
          else delete next[k];
        }
        return next;
      });
      if (r.status === 401) toast.error(t('translator.notSignedIn'));
      else if (r.status === 403) toast.error(t('translator.forbidden'));
      else if (r.status === 429) toast.error(t('translator.rateLimited'));
      else {
        const why = r.data?.error || (r.data?.errors ? Object.values(r.data.errors)[0] : '') || r.status;
        toast.error(t('translator.proofread.saveFailed', { error: why }));
      }
      return;
    }
  }, [setMarks, t]);

  // Leaving the page sends what is still waiting.
  useEffect(() => () => { flushProof(); }, [flushProof]);

  const toggleProof = (key, checked) => {
    const hash = hashes[key];
    if (!hash || !marks) return;
    if (pendingProof.current && pendingProof.current.lang !== lang) flushProof();
    const p = (pendingProof.current ||= { lang, marks: {}, prev: {} });
    if (!has(p.prev, key)) p.prev[key] = marks[key] || null;
    p.marks[key] = checked ? { checked: true, hash } : { checked: false };
    setMarks(lang, (m) => {
      const next = { ...m };
      if (checked) next[key] = { by: me || '', at: new Date().toISOString(), hash };
      else delete next[key];
      return next;
    });
    clearTimeout(proofTimer.current);
    proofTimer.current = setTimeout(flushProof, PROOF_DEBOUNCE_MS);
  };

  // Tab walks the column you are in: from a translation field to the next field,
  // from a proofread checkbox to the next checkbox (Shift+Tab goes back). Past the
  // first/last one the browser's normal tab order takes over again.
  const onRowsKeyDown = (e) => {
    if (e.key !== 'Tab' || e.altKey || e.ctrlKey || e.metaKey) return;
    const el = e.target;
    let selector = null;
    if (el.matches('textarea.translate-input')) selector = 'textarea.translate-input';
    else if (el.matches('.translate-proof input[type="checkbox"]')) selector = '.translate-proof input[type="checkbox"]:not(:disabled)';
    if (!selector) return;
    const list = [...e.currentTarget.querySelectorAll(selector)];
    const next = list[list.indexOf(el) + (e.shiftKey ? -1 : 1)];
    if (!next) return;
    e.preventDefault();
    next.focus();
    next.scrollIntoView({ block: 'nearest' });
  };

  const proofTitle = (m) =>t('translator.proofread.checkedBy', { user: m.by, when: formatTimeAgo(m.at) });

  const changeLanguage = (code) => {
    if (code === '__add') { setShowAdd(true); return; }
    if (code === lang || !confirmDiscard()) return;
    flushProof();
    setDrafts({});
    setServerErrors({});
    setLang(code);
  };

  const save = async () => {
    if (!dirtyKeys.length) { toast.info(t('translator.nothingToSave')); return; }
    if (Object.keys(clientErrors).length) { toast.error(t('translator.fixErrors')); return; }
    setSaving(true);
    let savedCount = 0;
    const savedChanges = {};
    const savedMarks = {};
    const unmarked = [];
    try {
      for (let i = 0; i < dirtyKeys.length; i += BATCH) {
        const chunk = dirtyKeys.slice(i, i + BATCH);
        const changes = Object.fromEntries(chunk.map((k) => [k, drafts[k]]));
        const r = await saveStrings(lang, changes);
        if (!r.ok) {
          if (r.status === 400 && r.data?.errors) {
            setServerErrors((e) => ({ ...e, ...r.data.errors }));
            toast.error(savedCount ? t('translator.partialSaved') : t('translator.fixErrors'));
          } else if (r.status === 401) toast.error(t('translator.notSignedIn'));
          else if (r.status === 403) toast.error(t('translator.forbidden'));
          else if (r.status === 429) toast.error(t('translator.rateLimited'));
          else toast.error(t('translator.saveFailed', { error: r.data?.error || r.status }));
          break;
        }
        Object.assign(savedChanges, changes);
        // The server marks saved strings proofread and unmarks reset ones.
        if (r.data?.marks && typeof r.data.marks === 'object') Object.assign(savedMarks, r.data.marks);
        if (Array.isArray(r.data?.unmarked)) unmarked.push(...r.data.unmarked);
        savedCount += chunk.length;
      }
    } catch (e) {
      toast.error(t('translator.saveFailed', { error: e?.message || '' }));
    } finally {
      setSaving(false);
    }
    if (!savedCount) return;

    setOverlay((o) => {
      const next = { ...o };
      for (const [k, v] of Object.entries(savedChanges)) {
        if (v === null) delete next[k];
        else next[k] = v;
      }
      return next;
    });
    setDrafts((d) => {
      const next = { ...d };
      for (const k of Object.keys(savedChanges)) delete next[k];
      return next;
    });
    if (Object.keys(savedMarks).length || unmarked.length) {
      setMarks(lang, (m) => {
        const next = { ...m };
        for (const k of unmarked) delete next[k];
        Object.assign(next, savedMarks);
        return next;
      });
    }
    applyLiveChanges(lang, savedChanges, bundled);
    if (savedCount === dirtyKeys.length) toast.success(t('translator.saved', { count: savedCount }));
  };

  const errors = { ...serverErrors, ...clientErrors };
  const shown = visible.slice(0, limit);

  const errorCount = Object.keys(errors).length;
  const filters = [
    { id: 'missing', label: t('translator.missingOnly'), on: missingOnly, set: setMissingOnly },
    { id: 'community', label: t('translator.communityOnly'), on: communityOnly, set: setCommunityOnly },
    ...(showProof ? [{ id: 'proof', label: t('translator.proofread.filter'), on: unproofreadOnly, set: setUnproofreadOnly }] : []),
  ];

  return (
    <div className="translate-page">
      <header className="translate-header">
        <div className="translate-header__title">
          <h1>{t('translator.title')}{langInfo ? <span className="translate-header__lang" lang={langInfo.code}> · {langInfo.native}</span> : null}</h1>
          <p className="translate-muted small">{t('translator.intro')}</p>
        </div>
        {showProof && (
          <div className="translate-proof-progress">
            <span className="translate-proof-progress__text">
              {t('translator.proofread.progress', {
                count: proof.total,
                done: formatNumber(proof.done),
                total: formatNumber(proof.total),
                percent: percent(proof.done, proof.total),
              })}
            </span>
            <span
              className="translate-proof-bar"
              role="progressbar"
              aria-label={t('translator.proofread.progressLabel')}
              aria-valuemin={0}
              aria-valuemax={proof.total}
              aria-valuenow={proof.done}
            >
              <span style={{ width: `${proof.total ? (proof.done / proof.total) * 100 : 100}%` }} />
            </span>
          </div>
        )}
      </header>

      <div className="translate-toolbar">
        <label className="translate-select" htmlFor="translate-lang-select">
          <span className="translate-sr-only">{t('translator.language')}</span>
          <Icon name="language" size={16} aria-hidden="true" />
          <select id="translate-lang-select" className="v2-input is-select h32" value={lang} onChange={(e) => changeLanguage(e.target.value)}>
            {!lang && <option value="" />}
            {targets.map((l) => (
              <option key={l.code} value={l.code} lang={l.code}>
                {l.native}{l.native !== l.english ? ` (${l.english})` : ''} · {l.code}{l.community ? ` · ${t('translator.communityLanguage')}` : ''}
              </option>
            ))}
            <option value="__add">+ {t('translator.addLanguage')}</option>
          </select>
        </label>
        <label className="translate-select translate-areas-select">
          <span className="translate-sr-only">{t('translator.areas')}</span>
          <Icon name="folder_open" size={16} aria-hidden="true" />
          <select className="v2-input is-select h32" value={area} onChange={(e) => setArea(e.target.value)} aria-label={t('translator.areas')}>
            {areas.map((a) => {
              const pa = showProof ? (proof.areas[a] || { done: 0, total: 0 }) : null;
              return (
                <option key={a} value={a} title={AREA_INFO[a] || undefined}>
                  {a} ({progress[a]?.done || 0}/{progress[a]?.total || 0}
                  {pa ? ` · ${t('translator.proofread.areaShort', { percent: percent(pa.done, pa.total) })}` : ''})
                </option>
              );
            })}
          </select>
        </label>
        <label className="translate-search">
          <Icon name="search" size={16} aria-hidden="true" />
          <input
            type="search"
            className="v2-input h32"
            placeholder={t('translator.search')}
            aria-label={t('translator.search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <div className="translate-filters">
          {filters.map((f) => (
            <button key={f.id} type="button" className={cx('translate-filter', f.on && 'is-on')} aria-pressed={f.on} onClick={() => f.set(!f.on)}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="translate-layout">
        <nav className="translate-areas" aria-label={t('translator.areas')}>
          <div className="v2-eyebrow translate-areas__label">{t('translator.areas')}</div>
          <ul className="translate-areas-list">
            {areas.map((a) => {
              const p = progress[a] || { done: 0, total: 0 };
              const pct = p.total ? Math.round((p.done / p.total) * 100) : 100;
              const pa = showProof ? (proof.areas[a] || { done: 0, total: 0 }) : null;
              const proofLabel = pa ? t('translator.proofread.areaShort', { percent: percent(pa.done, pa.total) }) : '';
              return (
                <li key={a}>
                  <button type="button" className={a === area && !q ? 'is-active' : ''} onClick={() => setArea(a)} title={AREA_INFO[a] || undefined}>
                    <span className="translate-area-name">{a}</span>
                    <span className="translate-area-pct">{pct}%</span>
                    <span className="translate-area-bar"><span style={{ width: `${pct}%` }} /></span>
                    {pa && (
                      <>
                        <span className="translate-area-bar is-proof" aria-hidden="true">
                          <span style={{ width: `${pa.total ? (pa.done / pa.total) * 100 : 100}%` }} />
                        </span>
                        <span className="translate-area-pct is-proof" title={proofLabel}>
                          <Icon name="check" size={12} />{formatNumber(pa.done)}/{formatNumber(pa.total)}
                          <span className="translate-sr-only"> {proofLabel}</span>
                        </span>
                      </>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <main className="translate-main">
          {!q && area && (
            <div className="translate-area-head">
              <h2>{area}</h2>
              {AREA_INFO[area] && <p className="translate-area-info" lang="en" dir="ltr">{AREA_INFO[area]}</p>}
            </div>
          )}

          {loading ? (
            <div className="translate-loading" role="status">
              <Icon name="progress_activity" size={18} className="v2-spin" />
              <span>{t('translator.loading')}</span>
            </div>
          ) : (
            <>
              <div className={`translate-rows${showProof ? ' has-proof' : ''}`} role="list" onKeyDown={onRowsKeyDown}>
                <div className="translate-row translate-row-head" aria-hidden="true">
                  <span>{t('translator.columns.key')}</span>
                  <span>{t('translator.columns.english')}</span>
                  <span>{t('translator.columns.translation')}</span>
                  {showProof && <span>{t('translator.proofread.checkbox')}</span>}
                </div>
                {shown.map((r) => {
                  const pendingReset = drafts[r.key] === null;
                  const isDirty = dirtySet.has(r.key);
                  const edited = Object.prototype.hasOwnProperty.call(overlay, r.key);
                  const err = errors[r.key];
                  const mark = showProof ? marks[r.key] : null;
                  const proofed = showProof && proof.ok.has(r.key);
                  const stale = showProof && proof.stale.has(r.key);
                  const hasText = !!hashes[r.key];
                  let proofHint = t('translator.proofread.notChecked');
                  if (!hasText) proofHint = t('translator.proofread.noText');
                  else if (isDirty) proofHint = t('translator.proofread.saveFirst');
                  else if (proofed) proofHint = proofTitle(mark);
                  return (
                    <div key={r.key} role="listitem" className={`translate-row${isDirty ? ' is-dirty' : ''}${err ? ' has-error' : ''}`}>
                      <div className="translate-key">
                        <code>{r.key}</code>
                        {r.plural && <span className="translate-plural">{t('translator.pluralForm', { category: r.plural })}</span>}
                        {edited && <StatusPill tone="cyan" className="translate-tag is-community">{t('translator.editedBadge')}</StatusPill>}
                      </div>
                      <div className="translate-english" lang="en" dir="ltr">{r.english}</div>
                      <div className="translate-cell">
                        <AutoTextarea
                          value={valueOf(r.key)}
                          onChange={(v) => edit(r.key, v)}
                          invalid={!!err}
                          lang={lang}
                          dir={langInfo?.dir || 'ltr'}
                          label={r.key}
                        />
                        {err && <p className="translate-error" role="alert">{err}</p>}
                        {pendingReset && <p className="translate-muted small">{t('translator.pendingReset')}</p>}
                        <div className="translate-row-actions">
                          {isDirty && (
                            <Button variant="secondary" size={28} icon="undo" onClick={() => discard(r.key)}>{t('translator.undo')}</Button>
                          )}
                          {edited && !pendingReset && (
                            <Button variant="danger" size={28} icon="restart_alt" title={t('translator.resetTitle')} onClick={() => edit(r.key, null)}>
                              {t('translator.reset')}
                            </Button>
                          )}
                        </div>
                      </div>
                      {showProof && (
                        <div className="translate-proof-cell">
                          <label className={`translate-proof${proofed ? ' is-checked' : ''}`} title={proofHint}>
                            <input
                              type="checkbox"
                              checked={proofed}
                              disabled={!hasText || isDirty}
                              aria-label={t('translator.proofread.checkboxFor', { key: r.key })}
                              onChange={(e) => toggleProof(r.key, e.target.checked)}
                            />
                            {/* Who checked it and when, or that nobody has (45d). */}
                            <span aria-hidden="true">
                              {proofed && mark ? proofTitle(mark) : proofed ? t('translator.proofread.checkbox') : t('translator.proofread.notCheckedShort')}
                            </span>
                          </label>
                          {stale && (
                            <span
                              className="translate-tag is-stale"
                              title={t('translator.proofread.changedTitle', { user: mark.by, when: formatTimeAgo(mark.at) })}
                            >
                              <Icon name="sync_problem" size={14} />
                              {t('translator.proofread.changed')}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {!visible.length && (
                <div className="v2-empty translate-empty">
                  <Icon name="filter_alt_off" size={28} />
                  <p>{t('translator.noRows')}</p>
                </div>
              )}
              {visible.length > shown.length && (
                <div className="translate-more">
                  <span className="translate-muted small">{t('translator.showing', { shown: shown.length, total: visible.length })}</span>
                  <Button variant="secondary" size={36} icon="expand_more" onClick={showMore}>{t('translator.showMore')}</Button>
                </div>
              )}
            </>
          )}
        </main>
      </div>

      <div className={cx('translate-savebar', dirtyKeys.length > 0 && 'is-dirty')}>
        <b className="translate-savebar__count">{t('translator.unsaved', { count: dirtyKeys.length })}</b>
        {errorCount > 0 && <span className="translate-savebar__err">{t('translator.fixErrors')}</span>}
        {/* Undo drops every unsaved edit at once (45d); each row keeps its own. */}
        {dirtyKeys.length > 0 && (
          <Button variant="ghost" size={36} onClick={() => { setDrafts({}); setServerErrors({}); }} disabled={saving}>
            {t('translator.undo')}
          </Button>
        )}
        <Button variant="cyan" size={36} onClick={save} loading={saving} disabled={saving || !dirtyKeys.length}>
          {saving ? t('translator.saving') : t('translator.save')}
        </Button>
      </div>

      {showAdd && (
        <AddLanguage
          onClose={() => setShowAdd(false)}
          onAdded={(l) => {
            registerCommunityLanguages([l]);
            setShowAdd(false);
            if (confirmDiscard()) {
              setDrafts({});
              setServerErrors({});
              setLang(l.code);
            }
          }}
        />
      )}
    </div>
  );
}

function AddLanguage({ onClose, onAdded }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({ code: '', native: '', english: '', rtl: false });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const codeRef = useRef(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  // The dialog focuses itself when it opens; the code field is where typing starts.
  useEffect(() => { codeRef.current?.focus(); }, []);

  const submit = async (e) => {
    e.preventDefault();
    const code = form.code.trim();
    const errs = {};
    if (!LANG_CODE_RE.test(code)) errs.code = t('translator.add.invalidCode');
    const n = validateLanguageName(form.native);
    if (n) errs.native = n;
    const en = validateLanguageName(form.english);
    if (en) errs.english = en;
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      const r = await addLanguage({ code, native: form.native.trim(), english: form.english.trim(), dir: form.rtl ? 'rtl' : 'ltr' });
      if (r.ok && r.data?.language) {
        toast.success(t('translator.add.added', { name: r.data.language.native }));
        onAdded(r.data.language);
        return;
      }
      if (r.data?.errors) setErrors(r.data.errors);
      else if (r.status === 401) toast.error(t('translator.notSignedIn'));
      else if (r.status === 403) toast.error(t('translator.forbidden'));
      else if (r.status === 429) toast.error(t('translator.rateLimited'));
      else toast.error(r.data?.error || t('translator.add.failed'));
    } catch {
      toast.error(t('translator.add.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('translator.add.title')}
      closeLabel={t('translator.add.cancel')}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>{t('translator.add.cancel')}</Button>
          <Button variant="primary" type="submit" form="translate-add-form" loading={busy} disabled={busy}>{t('translator.add.submit')}</Button>
        </>
      )}
    >
      <form id="translate-add-form" className="translate-add" onSubmit={submit} noValidate>
        <Field
          label={t('translator.add.code')}
          hint={t('translator.add.codeHint')}
          error={errors.code}
          ref={codeRef}
          value={form.code}
          onChange={set('code')}
          maxLength={6}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="translate-add__code"
        />
        <Field
          label={t('translator.add.native')}
          hint={t('translator.add.nativeHint')}
          error={errors.native}
          value={form.native}
          onChange={set('native')}
          maxLength={40}
          dir={form.rtl ? 'rtl' : 'auto'}
        />
        <Field
          label={t('translator.add.english')}
          error={errors.english}
          value={form.english}
          onChange={set('english')}
          maxLength={40}
        />
        <Checkbox label={t('translator.add.rtl')} checked={form.rtl} onChange={set('rtl')} />
        {errors.dir && <p className="translate-error" role="alert">{errors.dir}</p>}
      </form>
    </Dialog>
  );
}
