import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation, Trans } from "react-i18next";
import { FaCheck } from "react-icons/fa";
import { IoIosArrowDropdownCircle } from "react-icons/io";
import CommunityModal from "../components/modal/Community_modal";
import Beneficiary_modal from "../components/modal/Beneficiary_modal";
import SettingInfo, { SettingSheet } from "../components/embed-studio/SettingInfo";
import { createImportBatch, cancelImportBatch, fmtDuration } from "../lib/youtubeImport";
import { StepProgress } from "../components/legacy-studio/StepProgress";
import StepActions from "../components/embed-studio/StepActions";
import { addThreespeakToPostingAuth, waitForThreespeakPostingAuth } from "../utils/postingAuthority";
import { getCurrentProvider, Providers } from "../hive-api/aioha";
import AccountImg from "../components/HiveAvatar/AccountImg";
import ModalHeader from "../components/ModalHeader/ModalHeader";
import { usePremiumStatus } from "../hooks/usePremiumStatus";
import { fetchCreatorAdPrefs } from "../lib/advertiseData";
import { readAddToBlog, writeAddToBlog } from "../utils/addToBlog";
import {
  LOCKED_FUND_ACCOUNT, LOCKED_FUND_PERCENT, LOCKED_ENCODER_ACCOUNT, LOCKED_ENCODER_PERCENT, chargesEncoder,
} from "../utils/beneficiaries";
// The settings tiles are the upload wizard's own (EmbedDetails), styles included.
import "../components/embed-studio/EmbedDetails.scss";

// ▶️ Batch import UI: the one-time form for up to 5 picked videos, and the status
// of the creator's batches. The server does everything else (import-batch.cjs).

const DEFAULT_COMMUNITY = 'hive-181335';
const PAYOUTS = ['default', 'powerup', 'decline'];

/** One on/off tile, the same markup as the wizard's. */
function ToggleTile({ label, info, hint, checked, onChange, disabled }) {
  return (
    <div className="beneficiary-wrap" onClick={() => { if (!disabled) onChange(!checked); }}>
      <div className="wrap">
        <span>{label}<SettingInfo title={label}>{info}</SettingInfo></span>
        <span>{hint}</span>
      </div>
      <label className={`toggle-switch${disabled ? ' disabled' : ''}`} onClick={(e) => e.stopPropagation()}>
        <input type="checkbox" checked={!!checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        <span className="toggle-track"><span className="toggle-thumb" /></span>
      </label>
    </div>
  );
}

/**
 * The one-time form, as a two-step wizard: Content (the picked videos) and
 * Settings. Title, description, tags and thumbnail come from each video; the
 * settings apply to all of them. They are the upload wizard's settings tiles,
 * minus the ones that only make sense for one video (channel trailer,
 * supporters-only, schedule: the batch spaces its own posts).
 */
export function BatchForm({ user, videos, spacingMin, granted, onGranted, onClose, onStarted }) {
  const { t } = useTranslation();
  const [step, setStep] = useState(1);
  const [community, setCommunity] = useState(DEFAULT_COMMUNITY);
  const [communityOpen, setCommunityOpen] = useState(false);
  const [payout, setPayout] = useState('default');
  const [rewardsOpen, setRewardsOpen] = useState(false);
  const [benesOpen, setBenesOpen] = useState(false);
  const [reusable, setReusable] = useState(true);
  const [nsfw, setNsfw] = useState(false);
  const [addToBlog, setAddToBlogState] = useState(readAddToBlog);
  const setAddToBlog = (on) => { setAddToBlogState(on); writeAddToBlog(on); };
  const [ads, setAds] = useState(true);
  const [rolls, setRolls] = useState(true);
  const [busy, setBusy] = useState(false);
  const [granting, setGranting] = useState(false);
  const [error, setError] = useState('');

  // Beneficiaries in the wizard's dialog, starting from the same locked rows.
  // Pro drops them like EmbedUploadContext does; the server enforces its own copy.
  const isPremium = usePremiumStatus(user)?.premium === true;
  const [list, setList] = useState([
    { account: LOCKED_FUND_ACCOUNT, percent: LOCKED_FUND_PERCENT, locked: true, minPercent: LOCKED_FUND_PERCENT },
    { account: LOCKED_ENCODER_ACCOUNT, percent: LOCKED_ENCODER_PERCENT, locked: true, minPercent: LOCKED_ENCODER_PERCENT },
  ]);
  const [remaining, setRemaining] = useState(100 - LOCKED_FUND_PERCENT - LOCKED_ENCODER_PERCENT);
  const prunedRef = useRef(false);
  useEffect(() => {
    if (!isPremium || prunedRef.current) return;
    prunedRef.current = true;
    const keepEncoder = chargesEncoder({ isPremium, username: user, includeEncoder: true });
    setList((prev) => prev.filter((b) => b.account !== LOCKED_FUND_ACCOUNT && (keepEncoder || b.account !== LOCKED_ENCODER_ACCOUNT)));
    setRemaining((prev) => Math.min(100, prev + (keepEncoder ? LOCKED_FUND_PERCENT : LOCKED_FUND_PERCENT + LOCKED_ENCODER_PERCENT)));
  }, [isPremium, user]);

  // Ads and rolls tiles only when the account carries them, as in the wizard.
  const [accountAdsOn, setAccountAdsOn] = useState(false);
  const [accountRollsOn, setAccountRollsOn] = useState(false);
  useEffect(() => {
    let alive = true;
    fetchCreatorAdPrefs(user)
      .then((p) => {
        if (!alive) return;
        setAccountAdsOn(p?.adsEnabled === true);
        setAccountRollsOn(p?.adsEnabled === true && p?.rollsEnabled !== false);
      })
      .catch(() => { if (alive) { setAccountAdsOn(false); setAccountRollsOn(false); } });
    return () => { alive = false; };
  }, [user]);

  // Shorts land in the Shorts feed as replies: community, blog and ads skip them.
  const hasShorts = videos.some((v) => v.type === 'shorts' || v.platform === 'tiktok' || v.platform === 'instagram');

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
        // Locked rows too: someone may have raised them, and the server keeps the larger share.
        beneficiaries: list.map((b) => ({ account: b.account, percent: Number(b.percent) })),
        reusable,
        nsfw,
        reblog: addToBlog,
        ads: accountAdsOn ? ads : true,
        rolls: accountRollsOn && ads ? rolls : true,
      });
      onStarted(batch);
    } catch (e) {
      if (e.code === 'no_grant') onGranted(false);
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="yt-batch-modal" role="dialog" aria-modal="true" aria-label={t('ytimport.batch.formTitle', { count: videos.length })}>
      <div className="yt-batch-modal__overlay" onClick={busy || granting ? undefined : onClose} />
      <div className="yt-batch-modal__sheet">
        <ModalHeader title={t('ytimport.batch.formTitle', { count: videos.length })} onClose={busy || granting ? undefined : onClose} />
        <StepProgress step={step} labels={[t('ytimport.batch.steps.content'), t('ytimport.batch.steps.settings')]} />

        {step === 1 && (
          <>
            <p className="yt-import__note">{t('ytimport.batch.contentIntro')}</p>
            <ul className="yt-batch-modal__picked">
              {videos.map((v) => (
                <li key={v.id}>
                  <img src={v.thumbnail} alt="" />
                  <div>
                    <span className="yt-batch-modal__picked-title">{v.title}</span>
                    <span className="yt-import__muted">
                      {[v.duration > 0 && fmtDuration(v.duration), v.type === 'shorts' && t('ytimport.batch.short')].filter(Boolean).join(' · ')}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}

        {step === 2 && (
          <>
            <p className="yt-import__note">{t('ytimport.batch.settingsIntro')}</p>
            <div className={`advance-option yt-batch-modal__tiles${busy ? ' is-busy' : ''}`}>
              <div className="beneficiary-wrap community-tile is-clickable" onClick={() => { if (!busy) setCommunityOpen(true); }}>
                <div className="wrap">
                  <span>{t('upload.details.community.label')}<SettingInfo title={t('upload.details.community.label')}>{t('upload.details.community.info')}</SettingInfo></span>
                  <span>{t('upload.details.community.hint')}</span>
                </div>
                <div className="tile-value community-value">
                  <div className="wrap"><AccountImg account={communityName} alt="" /><span>{communityTitle}</span></div>
                  <IoIosArrowDropdownCircle size={16} />
                </div>
              </div>
              <div className="beneficiary-wrap is-clickable" onClick={() => { if (!busy) setRewardsOpen(true); }}>
                <div className="wrap">
                  <span>{t('upload.details.rewards.label')}<SettingInfo title={t('upload.details.rewards.label')}>{t('upload.details.rewards.info')}</SettingInfo></span>
                  <span>{t('upload.details.rewards.hint')}</span>
                </div>
                <div className="tile-value">{t(`upload.details.rewards.${payout}`)}</div>
              </div>
              {payout !== 'decline' && (
                <div className="beneficiary-wrap is-clickable" onClick={() => { if (!busy) setBenesOpen(true); }}>
                  <div className="wrap">
                    <span>{t('upload.details.beneficiaries.label')}<SettingInfo title={t('upload.details.beneficiaries.label')}>{t('upload.details.beneficiaries.info')}</SettingInfo></span>
                    <span>{t('upload.details.beneficiaries.hint')}</span>
                  </div>
                  <div className="tile-value">{list.length > 0
                    ? t('upload.details.beneficiaries.accounts', { count: list.length })
                    : t('upload.details.beneficiaries.none')}</div>
                </div>
              )}
              <ToggleTile label={t('upload.details.remix.label')} info={t('upload.details.remix.info')} hint={t('upload.details.remix.hint')}
                checked={reusable} onChange={setReusable} disabled={busy} />
              <ToggleTile label={t('upload.details.nsfw.label')} info={<Trans i18nKey="upload.details.nsfw.info" components={{ code: <code /> }} />}
                hint={t('upload.details.nsfw.hint')} checked={nsfw} onChange={setNsfw} disabled={busy} />
              <ToggleTile label={t('upload.details.addToBlog.label')} info={t('upload.details.addToBlog.info')} hint={t('upload.details.addToBlog.hint')}
                checked={addToBlog} onChange={setAddToBlog} disabled={busy} />
              {accountAdsOn && (
                <ToggleTile label={t('upload.details.ads.label')} info={t('upload.details.ads.info')}
                  hint={ads ? t('upload.details.ads.hintOn') : t('upload.details.ads.hintOff')} checked={ads} onChange={setAds} disabled={busy} />
              )}
              {accountAdsOn && accountRollsOn && ads && (
                <ToggleTile label={t('upload.details.rolls.label')} info={t('upload.details.rolls.info')}
                  hint={rolls ? t('upload.details.rolls.hintOn') : t('upload.details.rolls.hintOff')} checked={rolls} onChange={setRolls} disabled={busy} />
              )}
            </div>

            {hasShorts && <p className="yt-import__note yt-batch-modal__small">{t('ytimport.batch.shortsNote')}</p>}
            <p className="yt-import__note yt-batch-modal__small">{t('ytimport.batch.spacing', { minutes: spacingMin })}</p>

            <SettingSheet title={t('upload.details.rewards.label')} open={rewardsOpen} onClose={() => setRewardsOpen(false)}>
              <div className="option-sheet">
                {PAYOUTS.map((p) => (
                  <button
                    type="button"
                    key={p}
                    className={`option-sheet__item${payout === p ? ' is-active' : ''}`}
                    onClick={() => { setPayout(p); setRewardsOpen(false); }}
                  >
                    <strong>{t(`upload.details.rewards.${p}`)}</strong>
                    <span>{t(`upload.details.rewards.${p}Hint`)}</span>
                  </button>
                ))}
              </div>
            </SettingSheet>

            {!granted && (
              <div className="yt-batch-modal__grant">
                <p>{t('ytimport.batch.grantNeeded')}</p>
                <button type="button" className="yt-import__btn" onClick={grant} disabled={granting}>
                  {granting ? t('ytimport.batch.granting') : t('ytimport.batch.grantButton')}
                </button>
              </div>
            )}
          </>
        )}

        {error && <p className="yt-import__error">{error}</p>}

        {step === 1 ? (
          <StepActions
            secondary={[{ key: 'cancel', label: t('ytimport.cancel'), onClick: onClose }]}
            primary={[{ key: 'next', label: t('common.actions.next'), onClick: () => setStep(2) }]}
          />
        ) : (
          <StepActions
            back={{ label: t('common.actions.back'), onClick: () => setStep(1), disabled: busy || granting }}
            primary={[{
              key: 'start',
              label: busy ? t('ytimport.batch.starting') : t('ytimport.batch.start'),
              onClick: start,
              disabled: !granted || busy || granting,
            }]}
          />
        )}
      </div>
      {communityOpen && (
        <CommunityModal isOpen={communityOpen} data={[]} close={() => setCommunityOpen(false)} setCommunity={setCommunity} selected={communityName} />
      )}
      {benesOpen && (
        <Beneficiary_modal
          isOpen={benesOpen}
          close={() => setBenesOpen(false)}
          setBeneficiaries={() => {}}
          setBeneficiaryList={() => {}}
          setList={setList}
          list={list}
          remaingPercent={remaining}
          setRemaingPercent={setRemaining}
          variant="embed"
        />
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
      {/* Everything happens on the server (import-batch.cjs), so say so: people
          otherwise keep the tab open for hours. */}
      {stoppable && (
        <p className="yt-batch-status__leave"><FaCheck aria-hidden="true" /> {t('ytimport.batch.canLeave')}</p>
      )}
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
                  <> · <Link to={it.isShort ? `/shorts?v=${user}/${it.permlink}` : `/@${user}/${it.permlink}`}>{t('ytimport.viewPost')}</Link></>
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
