import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation, Trans } from "react-i18next";
import { Button, Icon, SettingRow, Toggle } from "../components/v2/ui";
import { cx } from "../components/v2/helpers";
import CommunityModal from "../components/modal/Community_modal";
import Beneficiary_modal from "../components/modal/Beneficiary_modal";
import SettingInfo, { SettingSheet } from "../components/embed-studio/SettingInfo";
import { createImportBatch, cancelImportBatch, fmtDuration } from "../lib/youtubeImport";
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
// Styles: YoutubeImportPage.scss (.yt-batch-*), loaded by the page.

// ▶️ Batch import UI: the one-time form for up to 5 picked videos, and the status
// of the creator's batches. The server does everything else (import-batch.cjs).

const DEFAULT_COMMUNITY = 'hive-181335';
const PAYOUTS = ['default', 'powerup', 'decline'];

/** One on/off setting: a SettingRow with a Toggle (STYLE_GUIDE §11). */
function ToggleTile({ label, info, hint, checked, onChange, disabled }) {
  return (
    <SettingRow
      className="yt-batch-setting"
      title={<>{label}<SettingInfo title={label}>{info}</SettingInfo></>}
      sub={hint}
      control={<Toggle checked={!!checked} onChange={onChange} disabled={disabled} label={label} />}
    />
  );
}

/** A setting that opens a picker: title, hint and the current value. */
function PickTile({ label, info, hint, value, onOpen, disabled, className }) {
  const open = () => { if (!disabled) onOpen(); };
  return (
    <div
      className={cx('yt-batch-pick', disabled && 'is-disabled', className)}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled || undefined}
      onClick={open}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }}
    >
      <div className="yt-batch-pick__body">
        <b>{label}<SettingInfo title={label}>{info}</SettingInfo></b>
        <span>{hint}</span>
      </div>
      <span className="yt-batch-pick__value">{value}</span>
      <Icon name="chevron_right" size={18} className="yt-batch-pick__go" />
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
        <div className="v2-dialog__grab" aria-hidden="true" />
        <ModalHeader title={t('ytimport.batch.formTitle', { count: videos.length })} onClose={busy || granting ? undefined : onClose} />
        {/* 4px step bar with the labels under it (§11 multi-step pattern). */}
        <ol className="yt-batch-steps" aria-label={t('ytimport.batch.formTitle', { count: videos.length })}>
          {[t('ytimport.batch.steps.content'), t('ytimport.batch.steps.settings')].map((label, i) => (
            <li key={label} className={cx(i + 1 <= step && 'is-on')} aria-current={i + 1 === step ? 'step' : undefined}>
              <span className="yt-batch-steps__bar" />
              <span className="yt-batch-steps__label">{label}</span>
            </li>
          ))}
        </ol>
        <div className="yt-batch-modal__body">

        {step === 1 && (
          <>
            <p className="yt-import__note">{t('ytimport.batch.contentIntro')}</p>
            <ul className="yt-batch-modal__picked">
              {videos.map((v) => (
                <li key={v.id}>
                  <span className="yt-batch-modal__thumb v2-thumb r8">{v.thumbnail && <img src={v.thumbnail} alt="" />}</span>
                  <div>
                    <span className="yt-batch-modal__picked-title">{v.title}</span>
                    <span className="yt-import__muted num">
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
            <div className={cx('yt-batch-modal__tiles', busy && 'is-busy')}>
              <PickTile
                className="community-tile"
                label={t('upload.details.community.label')}
                info={t('upload.details.community.info')}
                hint={t('upload.details.community.hint')}
                value={<span className="community-value"><AccountImg account={communityName} alt="" /><span>{communityTitle}</span></span>}
                onOpen={() => setCommunityOpen(true)}
                disabled={busy}
              />
              <PickTile
                label={t('upload.details.rewards.label')}
                info={t('upload.details.rewards.info')}
                hint={t('upload.details.rewards.hint')}
                value={t(`upload.details.rewards.${payout}`)}
                onOpen={() => setRewardsOpen(true)}
                disabled={busy}
              />
              {payout !== 'decline' && (
                <PickTile
                  label={t('upload.details.beneficiaries.label')}
                  info={t('upload.details.beneficiaries.info')}
                  hint={t('upload.details.beneficiaries.hint')}
                  value={list.length > 0
                    ? t('upload.details.beneficiaries.accounts', { count: list.length })
                    : t('upload.details.beneficiaries.none')}
                  onOpen={() => setBenesOpen(true)}
                  disabled={busy}
                />
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

            {hasShorts && <p className="yt-batch-modal__small"><Icon name="view_day" size={14} />{t('ytimport.batch.shortsNote')}</p>}
            <p className="yt-batch-modal__small"><Icon name="schedule" size={14} />{t('ytimport.batch.spacing', { minutes: spacingMin })}</p>

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
              <div className="yt-batch-modal__grant v2-banner is-info">
                <Icon name="key" size={18} className="v2-banner__icon" />
                <div className="v2-banner__body">
                  <p>{t('ytimport.batch.grantNeeded')}</p>
                  <Button variant="cyan" size={40} icon="verified_user" loading={granting} onClick={grant} disabled={granting}>
                    {granting ? t('ytimport.batch.granting') : t('ytimport.batch.grantButton')}
                  </Button>
                </div>
              </div>
            )}
          </>
        )}

        {error && <p className="yt-import__error" role="alert">{error}</p>}
        </div>

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
// One Material Symbol per row state (posted = cyan check, failed = accent).
const STATE_ICON = {
  queued: 'schedule',
  downloading: 'progress_activity',
  uploading: 'progress_activity',
  scheduling: 'progress_activity',
  scheduled: 'event',
  posted: 'check_circle',
  failed: 'error',
  publish_failed: 'error',
  cancelled: 'block',
};

/** The creator's newest batch: one row per video with its state. */
export function BatchStatus({ batch, user, onChange }) {
  const { t } = useTranslation();
  const [stopping, setStopping] = useState(false);
  // Stopping also cancels posts that are already scheduled, so it asks first.
  const [confirming, setConfirming] = useState(false);
  const [, tick] = useState(0);
  // Keep the "publishes at" times honest while the page stays open.
  useEffect(() => {
    const iv = setInterval(() => tick((n) => n + 1), 30000);
    return () => clearInterval(iv);
  }, []);
  if (!batch) return null;
  const stoppable = batch.items.some((it) => RUNNING.has(it.status) || it.status === 'scheduled');
  const doneCount = batch.items.filter((it) => it.status === 'posted').length;

  const stop = async () => {
    setStopping(true);
    try { onChange(await cancelImportBatch(batch.id)); } catch { /* the next poll shows the state */ } finally { setStopping(false); setConfirming(false); }
  };

  const label = (it) => {
    if (it.status === 'scheduled' && it.scheduledOn) {
      // Batches post a few minutes later on purpose; say how long, or the wait
      // looks like nothing is happening.
      const at = new Date(it.scheduledOn);
      const minutes = Math.ceil((at.getTime() - Date.now()) / 60000);
      if (minutes <= 0) return t('ytimport.batch.status.publishingNow');
      return t('ytimport.batch.status.scheduledIn', { time: at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), minutes });
    }
    return t(`ytimport.batch.status.${it.status}`);
  };

  return (
    <section className="yt-batch-status" aria-live="polite">
      <div className="yt-batch-status__head">
        <span className="yt-batch-status__bar" aria-hidden="true" />
        <h3 className="yt-import__section">{t('ytimport.batch.statusTitle')}</h3>
        <span className="yt-batch-status__count num">{doneCount}/{batch.items.length}</span>
      </div>
      {stoppable && confirming && (
        <div className="yt-batch-status__confirm" role="alert">
          <p>{t('ytimport.batch.stopConfirm')}</p>
          <div className="yt-import__actions">
            <Button variant="primary" size={36} icon="stop_circle" loading={stopping} onClick={stop} disabled={stopping}>
              {t('ytimport.batch.stopYes')}
            </Button>
            <Button variant="secondary" size={36} onClick={() => setConfirming(false)} disabled={stopping}>
              {t('ytimport.batch.stopKeep')}
            </Button>
          </div>
        </div>
      )}
      {/* Everything happens on the server (import-batch.cjs), so say so: people
          otherwise keep the tab open for hours. */}
      {stoppable && (
        <p className="yt-batch-status__leave"><Icon name="check" size={16} /> {t('ytimport.batch.canLeave')}</p>
      )}
      <ul>
        {batch.items.map((it) => (
          <li key={it.sourceId} className={`yt-batch-status__item is-${it.status}`}>
            <span className="yt-batch-status__thumb v2-thumb r8">{it.thumbnail && <img src={it.thumbnail} alt="" />}</span>
            <div className="yt-batch-status__body">
              <span className="yt-import__title">{it.title}</span>
              <span className={cx('yt-batch-status__state', `is-${it.status}`)}>
                {STATE_ICON[it.status] && <Icon name={STATE_ICON[it.status]} size={14} className={RUNNING.has(it.status) && it.status !== 'queued' ? 'v2-spin' : ''} />}
                {label(it)}
                {it.isShort && <> · {t('ytimport.batch.short')}</>}
                {it.status === 'posted' && it.permlink && (
                  <> · <Link to={it.isShort ? `/shorts?v=${user}/${it.permlink}` : `/@${user}/${it.permlink}`}>{t('ytimport.viewPost')}</Link></>
                )}
              </span>
              {RUNNING.has(it.status) && it.status !== 'queued' && (
                <div className="v2-progress is-thin"><span className="is-cyan" style={{ width: `${it.progress}%` }} /></div>
              )}
              {it.error && (it.status === 'failed' || it.status === 'publish_failed') && <span className="yt-import__error">{it.error}</span>}
            </div>
          </li>
        ))}
      </ul>
      {stoppable && !confirming && (
        <Button variant="danger" size={48} trailing="stop_circle" className="is-next yt-batch-status__stop" onClick={() => setConfirming(true)}>
          {t('ytimport.batch.stop')}
        </Button>
      )}
    </section>
  );
}
