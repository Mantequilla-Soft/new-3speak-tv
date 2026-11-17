import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toastIn } from '../../utils/toast';
import { KNOWN_NODES, checkNode, getHiveUrl, getNodeChoice, setNodeChoice } from '../../utils/hiveNode';
import { Button, Icon } from '../v2/ui';

const toast = toastIn('Settings');

const HTTPS_RE = /^https:\/\/[^\s/]+\.[^\s]+$/;
const norm = (url) => String(url || '').trim().replace(/\/+$/, '');

/**
 * The Hive RPC node row in About, opening the choice: automatic (the race and
 * failover in utils/hiveNode.js), one of the known nodes, or the viewer's own.
 * A node is checked (hived and hivemind, from this page) before it is saved,
 * and every Hive call moves over at once, no reload. `onRowTap` is the About
 * row's own tap handler (the hidden Butter Auth unlock).
 */
export default function HiveNodePicker({ onRowTap }) {
  const { t } = useTranslation();
  const [choice, setChoice] = useState(getNodeChoice);
  const [inUse, setInUse] = useState(getHiveUrl);
  const ownChoice = choice && !KNOWN_NODES.includes(choice) ? choice : null;
  const [open, setOpen] = useState(false);
  // url -> { ok, ms }; missing = still checking
  const [status, setStatus] = useState({});
  const [ownOpen, setOwnOpen] = useState(!!ownChoice);
  const [own, setOwn] = useState(ownChoice || 'https://');
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return undefined;
    let alive = true;
    setStatus({});
    [...KNOWN_NODES, ...(ownChoice ? [ownChoice] : [])].forEach((url) => {
      checkNode(url).then((r) => { if (alive) setStatus((s) => ({ ...s, [url]: r })); });
    });
    return () => { alive = false; };
  }, [open, ownChoice]);

  const switchTo = async (url) => {
    setChoice(url);
    setInUse(url || getHiveUrl());
    const node = await setNodeChoice(url);
    setInUse(node || getHiveUrl());
    toast.success(t('settings.about.node.switched', { node: node || getHiveUrl() }));
  };

  const pick = async (url) => {
    setError('');
    if (url === choice) return;
    if (!url) { await switchTo(null); return; }
    setBusy(url);
    const r = await checkNode(url);
    setBusy(null);
    if (!r.ok) { setError(t('settings.about.node.failed')); return; }
    await switchTo(url);
  };

  const submitOwn = () => {
    const url = norm(own);
    if (!HTTPS_RE.test(url)) { setError(t('settings.about.node.badUrl')); return; }
    pick(url);
  };

  const meta = (url) => {
    if (busy === url) return t('settings.about.node.checking');
    const s = status[url];
    if (!s) return t('settings.about.node.checking');
    return s.ok ? t('settings.about.node.ms', { ms: s.ms }) : t('settings.about.node.down');
  };

  const option = (key, checked, label, sub, onPick, mono = false) => (
    <button
      key={key}
      type="button"
      role="radio"
      aria-checked={checked}
      className={`settings-node-opt v2-well${checked ? ' is-on' : ''}`}
      onClick={onPick}
      disabled={!!busy}
    >
      <span className="settings-node-dot" aria-hidden="true" />
      <span className={`settings-node-label${mono ? ' mono' : ''}`}>{label}</span>
      {sub && <span className="settings-node-meta">{sub}</span>}
    </button>
  );

  return (
    <>
      <button
        type="button"
        className="settings-kv v2-well is-link"
        aria-expanded={open}
        onClick={() => { onRowTap?.(); setOpen((o) => !o); }}
      >
        <span>{t('settings.about.rpcNode')}{!choice && ` · ${t('settings.about.node.modeAuto')}`}</span>
        <b className="mono">{inUse}</b>
        <Icon name={open ? 'expand_less' : 'expand_more'} size={16} />
      </button>
      {open && (
        <div className="settings-node" role="radiogroup" aria-label={t('settings.about.rpcNode')}>
          {option('auto', !choice, t('settings.about.node.auto'), t('settings.about.node.autoHint'), () => pick(null))}
          {KNOWN_NODES.map((url) => option(url, choice === url, url, meta(url), () => pick(url), true))}
          {option('own', !!ownChoice || ownOpen, t('settings.about.node.own'), ownChoice ? meta(ownChoice) : null, () => { setError(''); setOwnOpen(true); })}
          {ownOpen && (
            <form className="settings-copy-well v2-well" onSubmit={(e) => { e.preventDefault(); submitOwn(); }}>
              <input
                type="url"
                inputMode="url"
                value={own}
                onChange={(e) => { setOwn(e.target.value); setError(''); }}
                aria-label={t('settings.about.node.own')}
                spellCheck={false}
                autoCapitalize="off"
              />
              <Button type="submit" variant="primary" size={36} disabled={!!busy} loading={busy === norm(own)}>
                {t('settings.about.node.use')}
              </Button>
            </form>
          )}
          {error && <p className="settings-node-error" role="alert"><Icon name="error" size={16} />{error}</p>}
          <p className="settings-hint">{t('settings.about.node.fallback')}</p>
        </div>
      )}
    </>
  );
}
