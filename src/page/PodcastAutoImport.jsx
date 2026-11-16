import { useEffect, useState } from "react";
import { useTranslation, Trans } from "react-i18next";
import { Button, Field, Icon, Segmented } from "../components/v2/ui";
import { cx } from "../components/v2/helpers";
import CommunityModal from "../components/modal/Community_modal";
import Beneficiary_modal from "../components/modal/Beneficiary_modal";
import { SettingSheet } from "../components/embed-studio/SettingInfo";
import AccountImg from "../components/HiveAvatar/AccountImg";
import ModalHeader from "../components/ModalHeader/ModalHeader";
import { usePremiumStatus } from "../hooks/usePremiumStatus";
import { fetchCreatorAdPrefs } from "../lib/advertiseData";
import { saveAutoImport } from "../lib/youtubeImport";
import { addThreespeakToPostingAuth, waitForThreespeakPostingAuth } from "../utils/postingAuthority";
import { getCurrentProvider, Providers } from "../hive-api/aioha";
import { LOCKED_FUND_ACCOUNT, LOCKED_FUND_PERCENT } from "../utils/beneficiaries";
import { PickTile, ToggleTile } from "./ImportTiles";
// Styles: YoutubeImportPage.scss (.yt-auto-*, and the batch modal's .yt-batch-*).

// 🔁 Automatic podcast import: the status card on the Podcast tab and its
// settings form. The server checks the feed and posts (server/import-auto.cjs).

const DEFAULT_COMMUNITY = 'hive-181335';
const PAYOUTS = ['default', 'powerup', 'decline'];
// The audio service's kinds, labelled like the audio uploader does.
const KINDS = [
  { value: 'podcast', labelKey: 'audio.categories.podcast' },
  { value: 'interview', labelKey: 'audio.categories.interview' },
  { value: 'audiobook', labelKey: 'audio.categories.audiobook' },
  { value: 'song', labelKey: 'audio.categories.music' },
  { value: 'voice_message', labelKey: 'audio.categories.voice' },
];
const TITLE_PRESETS = ['{title}', '{show}: {title}', '{show} #{episode}: {title}'];

/** The title as the server will write it (server/import-batch.cjs renderTemplate). */
export function previewTitle(tpl, sample) {
  const values = { title: sample.title || '', show: sample.show || '', episode: sample.episode ?? '', season: sample.season ?? '', date: sample.date || '' };
  return String(tpl || '')
    .replace(/\{(title|show|episode|season|date)\}/g, (_, k) => String(values[k]))
    .replace(/\(\s*\)|\[\s*\]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*([:|·–-])\s*([:|·–-]\s*)+/g, ' $1 ')
    .replace(/^[\s:|·–#-]+|[\s:|·–#-]+$/g, '')
    .replace(/\s+#\s*(?=[:|·–-]|$)/g, '')
    .trim();
}

/** The content settings as the forms keep them (tags as typed text). */
export function audioContentState(saved = {}) {
  return {
    type: saved.type || 'podcast',
    target: saved.target === 'snap' ? 'snap' : 'post',
    // A new setup starts from the source; a saved one keeps its choice.
    fromSource: saved.type ? saved.fromSource === true : true,
    titleTemplate: saved.titleTemplate || '{title}',
    tags: (saved.tags || []).join(' '),
    hashtags: saved.hashtags !== false,
    useNotes: saved.useNotes !== false,
    addendum: saved.addendum || '',
    text: saved.text || '',
  };
}

/** What the server takes (server/import-auto.cjs parseSettings). */
export function audioContentSettings(v) {
  return {
    type: v.type, target: v.target, fromSource: v.fromSource, titleTemplate: v.titleTemplate, useNotes: v.useNotes,
    addendum: v.addendum, text: v.text, tags: v.tags.split(/[\s,]+/).filter(Boolean), hashtags: v.hashtags,
  };
}

/** A description of your own is needed when neither the source nor the notes give one. */
export const audioContentMissingText = (v) => !v.fromSource && !v.useNotes && !v.text.trim();

/**
 * The post's content for podcast episodes: the kind of audio, then "Import from
 * source" (title, description and tags from each episode) or the creator's own
 * title format, tags, show notes or text, and an addendum. Used by the batch form
 * and the automatic import form.
 */
export function AudioContentFields({ value, onChange, sample, disabled }) {
  const { t } = useTranslation();
  const set = (patch) => onChange({ ...value, ...patch });
  const titlePreview = previewTitle(value.titleTemplate, sample) || sample.title;
  return (
    <div className="yt-auto-form__content">
      <div className="v2-field">
        <span className="v2-eyebrow">{t('ytimport.auto.kind')}</span>
        <Segmented block={false} scroll value={value.type} onChange={(type) => set({ type })} options={KINDS.map((k) => ({ value: k.value, label: t(k.labelKey) }))} />
      </div>
      <div className="v2-field">
        <span className="v2-eyebrow">{t('ytimport.auto.target')}</span>
        <Segmented
          block={false}
          value={value.target}
          onChange={(target) => set({ target })}
          options={[{ value: 'post', label: t('ytimport.auto.targetPost') }, { value: 'snap', label: t('ytimport.auto.targetSnap') }]}
        />
        <div className="v2-field__hint">{value.target === 'snap' ? t('ytimport.auto.targetSnapHint') : t('ytimport.auto.targetPostHint')}</div>
      </div>
      <div className="yt-batch-modal__tiles">
        <ToggleTile label={t('ytimport.auto.fromSource')} info={t('ytimport.auto.fromSourceInfo')}
          hint={value.fromSource ? t('ytimport.auto.fromSourceOn') : t('ytimport.auto.fromSourceOff')}
          checked={value.fromSource} onChange={(fromSource) => set({ fromSource })} disabled={disabled} />
      </div>
      {!value.fromSource && (
        <>
          <Field
            label={t('ytimport.auto.titleLabel')}
            value={value.titleTemplate}
            maxLength={200}
            onChange={(e) => set({ titleTemplate: e.target.value })}
            disabled={disabled}
            hint={t('ytimport.auto.titleHint')}
          />
          <div className="yt-auto-form__presets">
            {TITLE_PRESETS.map((p) => (
              <button type="button" key={p} className={cx('yt-auto-form__chip', value.titleTemplate === p && 'is-on')} onClick={() => set({ titleTemplate: p })} disabled={disabled}>
                {previewTitle(p, { title: t('ytimport.auto.sampleTitle'), show: sample.show || t('ytimport.auto.sampleShow'), episode: 12 })}
              </button>
            ))}
          </div>
          <p className="yt-auto-form__preview"><Icon name="visibility" size={14} />{t('ytimport.auto.titlePreview', { title: titlePreview })}</p>
          <Field
            label={t('ytimport.auto.tagsLabel')}
            value={value.tags}
            onChange={(e) => set({ tags: e.target.value })}
            placeholder="podcast talk hive"
            disabled={disabled}
            hint={t('ytimport.auto.tagsHint')}
          />
          <div className="yt-batch-modal__tiles">
            <ToggleTile label={t('ytimport.auto.hashtags')} info={t('ytimport.auto.hashtagsInfo')} hint={t('ytimport.auto.hashtagsHint')}
              checked={value.hashtags} onChange={(hashtags) => set({ hashtags })} disabled={disabled} />
            <ToggleTile label={t('ytimport.auto.useNotes')} info={t('ytimport.auto.useNotesInfo')} hint={value.useNotes ? t('ytimport.auto.useNotesOn') : t('ytimport.auto.useNotesOff')}
              checked={value.useNotes} onChange={(useNotes) => set({ useNotes })} disabled={disabled} />
          </div>
          {value.useNotes ? (
            <Field as="textarea" rows={3} label={t('ytimport.auto.addendumLabel')} optional optionalLabel={t('ytimport.auto.optional')}
              value={value.addendum} maxLength={2000} onChange={(e) => set({ addendum: e.target.value })} disabled={disabled} hint={t('ytimport.auto.addendumHint')} />
          ) : (
            <Field as="textarea" rows={4} label={t('ytimport.auto.textLabel')}
              value={value.text} maxLength={4000} onChange={(e) => set({ text: e.target.value })} disabled={disabled} hint={t('ytimport.auto.textHint')} />
          )}
        </>
      )}
    </div>
  );
}

const ERROR_KEYS = { no_link: 'noLink', no_grant: 'noGrant', unreadable: 'unreadable' };

/** The card above the episodes: on or off, what happened last, and the settings. */
export function PodcastAutoCard({ user, show, info, sample, granted, onGranted, onSaved }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const config = info?.configs?.find((c) => c.feedUrl === show.url) || null;
  const on = !!config?.enabled;
  const st = config?.status || {};
  const errorKey = st.lastErrorCode ? (ERROR_KEYS[st.lastErrorCode] || 'generic') : null;
  return (
    <section className={cx('yt-auto', on && 'is-on')} aria-label={t('ytimport.auto.title')}>
      <div className="yt-auto__head">
        <span className="yt-auto__icon"><Icon name="event_repeat" size={20} /></span>
        <div className="yt-auto__text">
          <b>{t('ytimport.auto.title')}</b>
          <span>
            {!info?.available ? t('ytimport.auto.unavailable')
              : on ? t('ytimport.auto.onSince', { date: new Date(config.enabledAt).toLocaleDateString(), minutes: info.intervalMin })
                : t('ytimport.auto.off')}
          </span>
        </div>
        <span className={cx('yt-auto__pill', on && 'is-on')}>{on ? t('ytimport.auto.pillOn') : t('ytimport.auto.pillOff')}</span>
      </div>
      {on && (
        <ul className="yt-auto__facts">
          {st.queued > 0 && <li><Icon name="check_circle" size={14} />{t('ytimport.auto.queued', { count: st.queued })}</li>}
          {st.lastCheckAt && <li><Icon name="schedule" size={14} />{t('ytimport.auto.lastCheck', { time: new Date(st.lastCheckAt).toLocaleString() })}</li>}
          {st.waiting > 0 && <li><Icon name="hourglass_top" size={14} />{t('ytimport.auto.waiting', { count: st.waiting, max: info.maxPerDay })}</li>}
          {st.lastSkipped?.length > 0 && (
            <li><Icon name="block" size={14} />{t('ytimport.auto.skipped', { titles: st.lastSkipped.map((x) => x.title).join(', ') })}</li>
          )}
          {errorKey && <li className="is-error"><Icon name="error" size={14} />{t(`ytimport.auto.errors.${errorKey}`)}</li>}
        </ul>
      )}
      {info?.available && (
        <div className="yt-import__actions">
          <Button variant={on ? 'secondary' : 'primary'} size={40} icon={on ? 'tune' : 'event_repeat'} onClick={() => setOpen(true)}>
            {on ? t('ytimport.auto.edit') : t('ytimport.auto.setUp')}
          </Button>
        </div>
      )}
      {open && (
        <AutoImportForm
          user={user}
          show={show}
          config={config}
          sample={sample}
          granted={granted}
          onGranted={onGranted}
          maxPerDay={info.maxPerDay}
          onClose={() => setOpen(false)}
          onSaved={(c) => { onSaved(c); setOpen(false); }}
        />
      )}
    </section>
  );
}

/** The settings, in the batch form's modal: what each new episode's post looks like. */
export function AutoImportForm({ user, show, config, sample, granted, onGranted, maxPerDay, onClose, onSaved }) {
  const { t } = useTranslation();
  const s0 = config?.settings || {};
  const o0 = config?.options || {};
  const [enabled, setEnabled] = useState(config ? !!config.enabled : true);
  const [content, setContent] = useState(() => audioContentState(s0));
  const [community, setCommunity] = useState(o0.community || DEFAULT_COMMUNITY);
  const [communityOpen, setCommunityOpen] = useState(false);
  const [payout, setPayout] = useState(o0.payout || 'default');
  const [rewardsOpen, setRewardsOpen] = useState(false);
  const [benesOpen, setBenesOpen] = useState(false);
  const [nsfw, setNsfw] = useState(!!o0.nsfw);
  const [reblog, setReblog] = useState(!!o0.reblog);
  const [ads, setAds] = useState(o0.ads !== false);
  const [busy, setBusy] = useState(false);
  const [granting, setGranting] = useState(false);
  const [error, setError] = useState('');

  // Beneficiaries: audio pays the platform fund (not Pro), never the encoder.
  const isPremium = usePremiumStatus(user)?.premium === true;
  const extras = (o0.beneficiaries || []).map((b) => ({ account: b.account, percent: b.percent }));
  const [list, setList] = useState(() => [
    ...(isPremium ? [] : [{ account: LOCKED_FUND_ACCOUNT, percent: LOCKED_FUND_PERCENT, locked: true, minPercent: LOCKED_FUND_PERCENT }]),
    ...extras.filter((b) => b.account !== LOCKED_FUND_ACCOUNT),
  ]);
  const [remaining, setRemaining] = useState(() => 100 - list.reduce((sum, b) => sum + Number(b.percent || 0), 0));
  // Pro (known after the first render): no fund row, its share back to the creator.
  // Two plain updates while rendering, never one inside the other's updater
  // (React may run an updater twice, which gave the share back twice).
  const proFund = isPremium ? list.find((b) => b.account === LOCKED_FUND_ACCOUNT && b.locked) : null;
  if (proFund) {
    setList(list.filter((b) => b !== proFund));
    setRemaining(Math.min(100, remaining + Number(proFund.percent)));
  }

  const [accountAdsOn, setAccountAdsOn] = useState(false);
  useEffect(() => {
    let alive = true;
    fetchCreatorAdPrefs(user).then((p) => { if (alive) setAccountAdsOn(p?.adsEnabled === true); }).catch(() => {});
    return () => { alive = false; };
  }, [user]);

  const communityName = typeof community === 'string' ? community : community?.name || DEFAULT_COMMUNITY;
  const communityTitle = typeof community === 'string'
    ? (community === DEFAULT_COMMUNITY ? 'Threespeak' : community)
    : community?.title || community?.name;

  const grant = async () => {
    setError('');
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

  const save = async () => {
    setError('');
    if (audioContentMissingText(content)) { setError(t('ytimport.auto.textRequired')); return; }
    setBusy(true);
    try {
      const { config: saved } = await saveAutoImport({
        feedUrl: show.url,
        enabled,
        settings: audioContentSettings(content),
        options: {
          community: communityName,
          payout,
          beneficiaries: list.filter((b) => !b.locked).map((b) => ({ account: b.account, percent: Number(b.percent) })),
          nsfw,
          reblog,
          ads: accountAdsOn ? ads : true,
        },
      });
      onSaved(saved);
    } catch (e) {
      if (e.code === 'no_grant') onGranted(false);
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const locked = busy || granting;
  return (
    <div className="yt-batch-modal" role="dialog" aria-modal="true" aria-label={t('ytimport.auto.formTitle')}>
      <div className="yt-batch-modal__overlay" onClick={locked ? undefined : onClose} />
      <div className="yt-batch-modal__sheet">
        <div className="v2-dialog__grab" aria-hidden="true" />
        <ModalHeader title={t('ytimport.auto.formTitle')} onClose={locked ? undefined : onClose} />
        <div className="yt-batch-modal__body yt-auto-form">
          <p className="yt-import__note">
            <Trans i18nKey="ytimport.auto.formIntro" values={{ show: show.title || show.url, max: maxPerDay }} components={{ b: <b /> }} />
          </p>

          <div className={cx('yt-batch-modal__tiles', locked && 'is-busy')}>
            <ToggleTile label={t('ytimport.auto.enabled')} info={t('ytimport.auto.enabledInfo')} hint={enabled ? t('ytimport.auto.enabledOn') : t('ytimport.auto.enabledOff')}
              checked={enabled} onChange={setEnabled} disabled={locked} />
          </div>

          <h3 className="yt-auto-form__section">{t('ytimport.auto.sections.content')}</h3>
          <AudioContentFields value={content} onChange={setContent} sample={sample} disabled={locked} />

          <h3 className="yt-auto-form__section">{t('ytimport.auto.sections.post')}</h3>
          <div className={cx('yt-batch-modal__tiles', locked && 'is-busy')}>
            {content.target !== 'snap' && (
              <PickTile
                className="community-tile"
                label={t('upload.details.community.label')}
                info={t('upload.details.community.info')}
                hint={t('upload.details.community.hint')}
                value={<span className="community-value"><AccountImg account={communityName} alt="" /><span>{communityTitle}</span></span>}
                onOpen={() => setCommunityOpen(true)}
                disabled={locked}
              />
            )}
            <PickTile
              label={t('upload.details.rewards.label')}
              info={t('upload.details.rewards.info')}
              hint={t('upload.details.rewards.hint')}
              value={t(`upload.details.rewards.${payout}`)}
              onOpen={() => setRewardsOpen(true)}
              disabled={locked}
            />
            {payout !== 'decline' && (
              <PickTile
                label={t('upload.details.beneficiaries.label')}
                info={t('upload.details.beneficiaries.info')}
                hint={t('upload.details.beneficiaries.hint')}
                value={list.length > 0 ? t('upload.details.beneficiaries.accounts', { count: list.length }) : t('upload.details.beneficiaries.none')}
                onOpen={() => setBenesOpen(true)}
                disabled={locked}
              />
            )}
            <ToggleTile label={t('upload.details.nsfw.label')} info={<Trans i18nKey="upload.details.nsfw.info" components={{ code: <code /> }} />}
              hint={t('upload.details.nsfw.hint')} checked={nsfw} onChange={setNsfw} disabled={locked} />
            {content.target !== 'snap' && (
              <ToggleTile label={t('upload.details.addToBlog.label')} info={t('upload.details.addToBlog.info')} hint={t('upload.details.addToBlog.hint')}
                checked={reblog} onChange={setReblog} disabled={locked} />
            )}
            {accountAdsOn && (
              <ToggleTile label={t('upload.details.ads.label')} info={t('upload.details.ads.info')}
                hint={ads ? t('upload.details.ads.hintOn') : t('upload.details.ads.hintOff')} checked={ads} onChange={setAds} disabled={locked} />
            )}
          </div>

          <SettingSheet title={t('upload.details.rewards.label')} open={rewardsOpen} onClose={() => setRewardsOpen(false)}>
            <div className="option-sheet">
              {PAYOUTS.map((p) => (
                <button type="button" key={p} className={`option-sheet__item${payout === p ? ' is-active' : ''}`} onClick={() => { setPayout(p); setRewardsOpen(false); }}>
                  <strong>{t(`upload.details.rewards.${p}`)}</strong>
                  <span>{t(`upload.details.rewards.${p}Hint`)}</span>
                </button>
              ))}
            </div>
          </SettingSheet>

          <p className="yt-batch-modal__small"><Icon name="schedule" size={14} />{t('ytimport.auto.onlyNew')}</p>

          {enabled && !granted && (
            <div className="yt-batch-modal__grant">
              <span>{t('ytimport.auto.grantNeeded')}</span>{' '}
              <button type="button" className="yt-batch-modal__grant-btn" onClick={grant} disabled={granting} aria-busy={granting || undefined}>
                {granting && <Icon name="progress_activity" size={14} className="v2-spin" />}
                {granting ? t('ytimport.batch.granting') : t('ytimport.batch.grantButton')}
              </button>
            </div>
          )}
          {error && <p className="yt-import__error" role="alert">{error}</p>}
        </div>

        <div className="yt-batch-modal__foot">
          <Button variant="secondary" size={44} center className="is-half" onClick={onClose} disabled={locked}>{t('ytimport.cancel')}</Button>
          <Button variant="primary" size={44} center className="is-half" onClick={save} disabled={locked || (enabled && !granted)} loading={busy}>
            {t('ytimport.auto.save')}
          </Button>
        </div>
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
