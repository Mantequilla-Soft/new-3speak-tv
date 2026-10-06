import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { FaCheck, FaTimes } from "react-icons/fa";
import CommunityModal from "../components/modal/Community_modal";
import { createImportBatch, cancelImportBatch } from "../lib/youtubeImport";
import { addThreespeakToPostingAuth, waitForThreespeakPostingAuth } from "../utils/postingAuthority";
import { getCurrentProvider, Providers } from "../hive-api/aioha";
import AccountImg from "../components/HiveAvatar/AccountImg";

// ▶️ Batch import UI: the one-time form for up to 5 picked videos, and the status
// of the creator's batches. The server does everything else (import-batch.cjs).

const DEFAULT_COMMUNITY = 'hive-181335';

/**
 * The one-time form. Title, description, tags and thumbnail come from each
 * video; these settings apply to all of them.
 */
export function BatchForm({ user, videos, spacingMin, granted, onGranted, onClose, onStarted }) {
  const { t } = useTranslation();
  const [community, setCommunity] = useState(DEFAULT_COMMUNITY);
  const [communityOpen, setCommunityOpen] = useState(false);
  const [payout, setPayout] = useState('default');
  const [benes, setBenes] = useState([]);
  const [nsfw, setNsfw] = useState(false);
  const [ads, setAds] = useState(true);
  const [busy, setBusy] = useState(false);
  const [granting, setGranting] = useState(false);
  const [error, setError] = useState('');

  const communityName = typeof community === 'string' ? community : community?.name || DEFAULT_COMMUNITY;
  const communityTitle = typeof community === 'string'
    ? (community === DEFAULT_COMMUNITY ? 'Threespeak' : community)
    : community?.title || community?.name;

  const grant = async () => {
    setError('');
    // HiveSigner signs in its own window, which must open on this click.
    const signWindow = getCurrentProvider() === Providers.HiveSigner ? window.open('', '_blank') : undefined;
    setGranting(true);
    try {
      await addThreespeakToPostingAuth(user, { signWindow });
      if (await waitForThreespeakPostingAuth(user, true)) onGranted();
      else setError(t('ytimport.batch.grantPending'));
    } catch (e) {
      setError(e.message);
    } finally {
      setGranting(false);
    }
  };

  const start = async () => {
    setError('');
    setBusy(true);
    try {
      const items = videos.map((v) => (v.token ? { token: v.token } : { videoId: v.id }));
      const batch = await createImportBatch(items, {
        community: communityName,
        payout,
        beneficiaries: benes.filter((b) => b.account.trim()).map((b) => ({ account: b.account.trim(), percent: Number(b.percent) })),
        nsfw,
        ads,
      });
      onStarted(batch);
    } catch (e) {
      if (e.code === 'no_grant') onGranted(false);
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const setBene = (i, patch) => setBenes((list) => list.map((b, j) => (j === i ? { ...b, ...patch } : b)));

  return (
    <div className="yt-batch-modal" role="dialog" aria-modal="true" aria-label={t('ytimport.batch.formTitle', { count: videos.length })}>
      <div className="yt-batch-modal__overlay" onClick={busy || granting ? undefined : onClose} />
      <div className="yt-batch-modal__sheet">
        <div className="yt-batch-modal__head">
          <h2>{t('ytimport.batch.formTitle', { count: videos.length })}</h2>
          <button type="button" className="yt-batch-modal__close" onClick={onClose} disabled={busy || granting} aria-label={t('ytimport.cancel')}>
            <FaTimes />
          </button>
        </div>
        <p className="yt-import__note">{t('ytimport.batch.formIntro')}</p>

        <ul className="yt-batch-modal__picked">
          {videos.map((v) => (
            <li key={v.id}><img src={v.thumbnail} alt="" /><span>{v.title}</span></li>
          ))}
        </ul>

        <div className="yt-batch-modal__field">
          <span className="yt-batch-modal__label">{t('ytimport.batch.community')}</span>
          <button type="button" className="yt-import__btn yt-import__btn--outline" onClick={() => setCommunityOpen(true)} disabled={busy}>
            <AccountImg className="yt-batch-modal__avatar" account={communityName} alt="" /> {communityTitle}
          </button>
        </div>

        <div className="yt-batch-modal__field">
          <span className="yt-batch-modal__label">{t('ytimport.batch.rewards')}</span>
          <div className="yt-batch-modal__choices" role="radiogroup">
            {['default', 'powerup', 'decline'].map((p) => (
              <label key={p} className={`yt-batch-modal__choice${payout === p ? ' is-on' : ''}`}>
                <input type="radio" name="yt-batch-payout" checked={payout === p} onChange={() => setPayout(p)} disabled={busy} />
                {t(`ytimport.batch.payout.${p}`)}
              </label>
            ))}
          </div>
        </div>

        {payout !== 'decline' && (
          <div className="yt-batch-modal__field">
            <span className="yt-batch-modal__label">{t('ytimport.batch.beneficiaries')}</span>
            {benes.map((b, i) => (
              <div className="yt-batch-modal__bene" key={i}>
                <input type="text" value={b.account} placeholder={t('ytimport.batch.accountPlaceholder')} autoComplete="off"
                  onChange={(e) => setBene(i, { account: e.target.value.toLowerCase().replace(/[^a-z0-9.@-]/g, '') })} disabled={busy} />
                <input type="number" min="1" max="100" step="1" value={b.percent} aria-label="%"
                  onChange={(e) => setBene(i, { percent: e.target.value })} disabled={busy} />
                <span>%</span>
                <button type="button" className="yt-import__linkbtn" onClick={() => setBenes((l) => l.filter((_, j) => j !== i))} disabled={busy}>
                  {t('ytimport.batch.remove')}
                </button>
              </div>
            ))}
            {benes.length < 6 && (
              <button type="button" className="yt-import__linkbtn" onClick={() => setBenes((l) => [...l, { account: '', percent: 5 }])} disabled={busy}>
                + {t('ytimport.batch.addBeneficiary')}
              </button>
            )}
            <p className="yt-import__note yt-batch-modal__small">{t('ytimport.batch.lockedNote')}</p>
          </div>
        )}

        <label className="yt-batch-modal__check">
          <input type="checkbox" checked={nsfw} onChange={(e) => setNsfw(e.target.checked)} disabled={busy} />
          {t('ytimport.batch.nsfw')}
        </label>
        <label className="yt-batch-modal__check">
          <input type="checkbox" checked={ads} onChange={(e) => setAds(e.target.checked)} disabled={busy} />
          {t('ytimport.batch.ads')}
        </label>

        <p className="yt-import__note yt-batch-modal__small">{t('ytimport.batch.spacing', { minutes: spacingMin })}</p>

        {!granted && (
          <div className="yt-batch-modal__grant">
            <p>{t('ytimport.batch.grantNeeded')}</p>
            <button type="button" className="yt-import__btn" onClick={grant} disabled={granting}>
              {granting ? t('ytimport.batch.granting') : t('ytimport.batch.grantButton')}
            </button>
          </div>
        )}

        {error && <p className="yt-import__error">{error}</p>}

        <div className="yt-import__actions">
          <button type="button" className="yt-import__btn" onClick={start} disabled={!granted || busy || granting}>
            {busy ? t('ytimport.batch.starting') : t('ytimport.batch.start')}
          </button>
          <button type="button" className="yt-import__btn yt-import__btn--outline" onClick={onClose} disabled={busy || granting}>
            {t('ytimport.cancel')}
          </button>
        </div>
      </div>
      {communityOpen && (
        <CommunityModal isOpen={communityOpen} data={[]} close={() => setCommunityOpen(false)} setCommunity={setCommunity} selected={communityName} />
      )}
    </div>
  );
}

const RUNNING = new Set(['queued', 'downloading', 'uploading', 'scheduling']);

/** The creator's newest batch: one row per video with its state. */
export function BatchStatus({ batch, user, onChange }) {
  const { t } = useTranslation();
  const [stopping, setStopping] = useState(false);
  const [, tick] = useState(0);
  // Keep the "publishes at" times honest while the page stays open.
  useEffect(() => {
    const iv = setInterval(() => tick((n) => n + 1), 30000);
    return () => clearInterval(iv);
  }, []);
  if (!batch) return null;
  const stoppable = batch.items.some((it) => RUNNING.has(it.status) || it.status === 'scheduled');

  const stop = async () => {
    setStopping(true);
    try { onChange(await cancelImportBatch(batch.id)); } catch { /* the next poll shows the state */ } finally { setStopping(false); }
  };

  const label = (it) => {
    if (it.status === 'scheduled' && it.scheduledOn) {
      return t('ytimport.batch.status.scheduled', { time: new Date(it.scheduledOn).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) });
    }
    return t(`ytimport.batch.status.${it.status}`);
  };

  return (
    <section className="yt-batch-status" aria-live="polite">
      <div className="yt-batch-status__head">
        <h3 className="yt-import__section">{t('ytimport.batch.statusTitle')}</h3>
        {stoppable && (
          <button type="button" className="yt-import__btn yt-import__btn--outline" onClick={stop} disabled={stopping}>
            {t('ytimport.batch.stop')}
          </button>
        )}
      </div>
      <ul>
        {batch.items.map((it) => (
          <li key={it.sourceId} className={`yt-batch-status__item is-${it.status}`}>
            {it.thumbnail ? <img src={it.thumbnail} alt="" /> : <span className="yt-batch-status__noimg" />}
            <div className="yt-batch-status__body">
              <span className="yt-import__title">{it.title}</span>
              <span className="yt-import__muted">
                {it.status === 'posted' && <FaCheck />} {label(it)}
                {it.isShort && <> · {t('ytimport.batch.short')}</>}
                {it.status === 'posted' && it.permlink && (
                  <> · <Link to={it.isShort ? `/shorts?v=${user}/${it.permlink}` : `/watch?v=${user}/${it.permlink}`}>{t('ytimport.viewPost')}</Link></>
                )}
              </span>
              {RUNNING.has(it.status) && it.status !== 'queued' && (
                <div className="yt-import__bar"><span style={{ width: `${it.progress}%` }} /></div>
              )}
              {it.error && (it.status === 'failed' || it.status === 'publish_failed') && <span className="yt-import__error">{it.error}</span>}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
