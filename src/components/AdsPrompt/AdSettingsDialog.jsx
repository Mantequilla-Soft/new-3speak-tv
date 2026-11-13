import { useState } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import { toastIn } from '../../utils/toast';
import { saveCreatorAdSettings } from '../../utils/adSettings';
import { Dialog, Button, SettingRow, Toggle } from '../v2/ui';
import './AdsPrompt.scss';

// Every toast from this module is headed "Advertising"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Advertising');

/**
 * Two steps: what the deal is, then what you want.
 *
 * Split in two on purpose. The numbers in step two only mean something once you
 * know what pool they divide, and a dialog that opens straight onto a percentage
 * box gets answered by whoever guesses fastest rather than by whoever understood.
 */
// Two callbacks rather than one with a flag: the dismiss paths are wired straight
// to onClick handlers, which would hand a click event to a `saved` argument and
// make every dismissal look like a save.
export default function AdSettingsDialog({ user, split, initialAdsEnabled, initialRollsEnabled, onSaved, onDismiss }) {
  const { t } = useTranslation();
  const [step, setStep] = useState(0);
  const [adsEnabled, setAdsEnabled] = useState(initialAdsEnabled !== false);
  // Off = banners and tickers only, no video rolls.
  const [rollsEnabled, setRollsEnabled] = useState(initialRollsEnabled !== false);
  // Seeded from the server's own default community share rather than a constant
  // kept here — see readCreatorAdChoice. (That default is 0 now, not the 25 this
  // comment used to name: sharing with a community is opt in.)
  const [community, setCommunity] = useState(split.communityPct);
  const [saving, setSaving] = useState(false);

  const pool = split.poolPct;
  const mine = pool - community;
  // Viewers are paid out of 3Speak's own cut, not the creator pool — `pool` is the
  // same number whether or not anyone watching is opted in. Both of these come from
  // the server for the same reason the pool does: a checker that changes the viewer
  // share must not need a frontend release to stop lying about it.
  //
  // A checker that predates the viewer share sends neither, and the fallback is the
  // old two-way split rather than a guess: showing an invented 5% here would be a
  // promise nothing in the payout run has made.
  const viewers = Number.isFinite(split.viewerPct) ? split.viewerPct : 0;
  const platform = Number.isFinite(split.platformPct) ? split.platformPct : 100 - pool;

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      const res = await saveCreatorAdSettings(user, {
        adsEnabled,
        rollsEnabled,
        communitySharePct: community,
      });
      if (res.chainSaved) {
        toast.success(t('ads.prompt.savedToHive'));
      } else {
        // The setting DID take effect — only the creator's own on-chain copy is
        // missing. Saying "saved" flatly would hide that; saying "failed" would be
        // a lie that has people set it twice.
        toast.warning(t('ads.prompt.savedOnlyOn3speak'));
      }
      onSaved();
    } catch (err) {
      toast.error((err && err.message) || t('ads.prompt.saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  // No dismiss-on-backdrop-click: this dialog asks for a decision that gets
  // written to the creator's own Hive account, and losing a half-made choice to
  // a stray click beside the card is a bad trade for the convenience. The ways
  // out are the X, Esc and the explicit "Not now" button.
  // Design 47d: "Step 1 of 2" beside the title; step one is the split as a
  // labelled bar and the four points, step two the two switches and the
  // community share.
  const segLabel = (pct, label) => (pct >= 12 ? label : null);
  return (
    <Dialog
      open
      onClose={() => onDismiss()}
      dismissible={!saving}
      backdropClose={false}
      title={t('ads.prompt.title')}
      sub={t('ads.prompt.stepOf', { step: step + 1, total: 2 })}
      closeLabel={t('common.actions.close')}
      width={480}
      className="ads-prompt-v2 ads-prompt-v2--settings"
      footer={step === 0 ? (
        <>
          <Button variant="secondary" size={44} onClick={() => onDismiss()}>
            {t('ads.prompt.notNow')}
          </Button>
          <Button variant="primary" size={44} next className="ads-prompt-v2__main" onClick={() => setStep(1)}>
            {t('common.actions.next')}
          </Button>
        </>
      ) : (
        <>
          <Button variant="secondary" size={44} icon="arrow_back" onClick={() => setStep(0)} disabled={saving}>
            {t('common.actions.back')}
          </Button>
          <Button variant="primary" size={44} className="ads-prompt-v2__main" onClick={save} disabled={saving} loading={saving}>
            {saving ? t('common.actions.saving') : t('common.actions.save')}
          </Button>
        </>
      )}
    >
      {step === 0 ? (
        <>
          {/* The split, labelled inside its parts: creator side (accent),
              the people watching (cyan), keeping 3Speak running (the rest).
              A part too narrow for its label carries it as a tooltip. */}
          <div className="ads-prompt-v2__bar" aria-hidden="true">
            <span className="is-creators" style={{ width: `${pool}%` }} title={`${t('ads.prompt.creatorSide')} ${pool}%`}>
              {segLabel(pool, `${t('ads.prompt.creatorSide')} ${pool}%`)}
            </span>
            {viewers > 0 ? (
              <span className="is-viewers" style={{ width: `${viewers}%` }} title={`${t('ads.prompt.peopleWatching')} ${viewers}%`}>
                {segLabel(viewers, t('ads.prompt.peopleWatching'))}
              </span>
            ) : null}
            <span className="is-platform" title={`${t('ads.prompt.keeping3speak')} ${platform}%`}>
              {segLabel(platform, t('ads.prompt.keeping3speak'))}
            </span>
          </div>

          <ul className="ads-prompt-v2__points">
            <li><Trans i18nKey="ads.prompt.pointPool" values={{ pool, rest: 100 - pool }} components={{ b: <strong /> }} /></li>
            <li><Trans i18nKey="ads.prompt.pointDivide" values={{ pool }} components={{ b: <strong /> }} /></li>
            {viewers > 0 ? (
              <li><Trans i18nKey="ads.prompt.pointViewers" values={{ viewers, pool }} components={{ b: <strong /> }} /></li>
            ) : null}
            <li><Trans i18nKey="ads.prompt.pointSayNo" components={{ b: <strong /> }} /></li>
          </ul>
        </>
      ) : (
        <>
          <span className="v2-eyebrow">{t('ads.prompt.yourChoice')}</span>

          <div className="ads-prompt-v2__rows">
            <SettingRow
              title={t('ads.prompt.allowAds')}
              sub={t('ads.prompt.allowAdsDesc')}
              control={<Toggle checked={adsEnabled} onChange={setAdsEnabled} label={t('ads.prompt.allowAds')} disabled={saving} />}
            />
            {adsEnabled && (
              <SettingRow
                title={t('ads.prompt.allowRolls')}
                sub={t('ads.prompt.allowRollsDesc')}
                control={<Toggle checked={rollsEnabled} onChange={setRollsEnabled} label={t('ads.prompt.allowRolls')} disabled={saving} />}
              />
            )}
          </div>

          {adsEnabled && (
            <div className="v2-slider ads-prompt-v2__share">
              {/* "Share with the community · 35% you · 15% community · 20% viewers":
                  the three-way breakdown, because "15%" on its own reads differently
                  depending on whether you think it is a share of the pool or of everything. */}
              <p className="ads-prompt-v2__breakdown">
                <label htmlFor="ads-prompt-community">{t('ads.prompt.shareCommunity')}</label>
                <span className="num">
                  {' · '}<Trans i18nKey="ads.prompt.breakdownYou" values={{ pct: mine }} components={{ b: <span /> }} />
                  {' · '}<Trans i18nKey="ads.prompt.breakdownCommunity" values={{ pct: community }} components={{ b: <span /> }} />
                  {viewers > 0 ? <>{' · '}<Trans i18nKey="ads.prompt.breakdownViewers" values={{ pct: viewers }} components={{ b: <span /> }} /></> : null}
                </span>
              </p>
              <input
                id="ads-prompt-community"
                type="range"
                min="0"
                max={pool}
                step="1"
                value={community}
                disabled={saving}
                onChange={(e) => setCommunity(parseInt(e.target.value, 10))}
              />
              <span className="v2-meta-sm">{t('ads.prompt.shareCommunityDesc', { pool })}</span>
            </div>
          )}
          <p className="v2-meta-sm">{t('ads.prompt.savingNote')}</p>
        </>
      )}
    </Dialog>
  );
}
