import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import { MdPeopleAlt } from 'react-icons/md';
import { IoIosArrowDropdownCircle } from 'react-icons/io';
import { getHiveUrl } from '../../utils/hiveNode';
import { getAnnounceConfig, setAnnounceConfig } from '../../utils/openpodAnnounce';
import Community_modal from '../modal/Community_modal';
import Beneficiary_modal from '../modal/Beneficiary_modal';
import './AnnounceOptions.scss';

/**
 * Integrator-owned announcement controls (community / payout / beneficiaries),
 * reused in TWO places — the create-room dialog AND the studio's post tab —
 * so both edit the SAME shared config (openpodAnnounce's module store). Each
 * instance initializes from the store and writes back on every change, so a
 * value set in the create dialog is still there in the studio, and vice versa.
 */
export default function AnnounceOptions({ announceType, isPremium = false, onChange, showAnnounceToggle = false, announceEnabled: announceEnabledProp, onAnnounceEnabledChange }) {
  const { t } = useTranslation();
  const init = getAnnounceConfig();
  const [announceEnabledLocal, setAnnounceEnabledLocal] = useState(init.announceEnabled !== false);
  // Controlled when the parent supplies a value (OpenPodModal needs to know,
  // so it can hide the studio's "replace the stream with a video" option).
  const announceEnabled = announceEnabledProp !== undefined ? announceEnabledProp : announceEnabledLocal;
  const setAnnounceEnabled = (v) => {
    setAnnounceEnabledLocal(v);
    onAnnounceEnabledChange?.(v);
  };
  // Restore as an OBJECT when we also stored a title, so a saved community
  // comes back showing its name + avatar rather than a raw `hive-123456` id.
  const [community, setCommunity] = useState(() => (
    init.communityTitle && init.community
      ? { name: init.community, title: init.communityTitle }
      : (init.community || 'hive-181335')
  ));
  const [communitiesData, setCommunitiesData] = useState([]);
  const [communityModalOpen, setCommunityModalOpen] = useState(false);
  const [declineRewards, setDeclineRewards] = useState(!!init.declineRewards);
  const [rewardPowerup, setRewardPowerup] = useState(!!init.rewardPowerup);
  const [beneModalOpen, setBeneModalOpen] = useState(false);
  // Beneficiary_modal works in PERCENT ({account, percent}); the Hive publish
  // path needs WEIGHT (1/100th of a percent). Convert on the way in…
  const [beneList, setBeneList] = useState(() => (init.beneList || []).map((b) => ({
    account: b.account,
    percent: Number.isFinite(b.percent) ? b.percent : (Number(b.weight) || 0) / 100,
  })));
  const [_beneCount, setBeneCount] = useState(2);

  // How much of the payout the author still has to give away. For a session
  // announcement the ONLY locked split is @threespeakfund's 10% for non-Pro
  // hosts (no encoder — nothing is encoded), so a Pro host starts at a full
  // 100%. This must match enforceLockedBeneficiaries() at publish time.
  const baseRemaining = isPremium ? 100 : 90;
  const [remaining, setRemaining] = useState(baseRemaining);

  // Keep it DERIVED from the baseline minus what's actually allocated. Premium
  // status resolves asynchronously, so the baseline can change after mount —
  // and deriving it also self-corrects any drift from add/remove arithmetic.
  useEffect(() => {
    const allocatedPct = (beneList || []).reduce((sum, b) => (
      sum + (Number.isFinite(b.percent) ? Number(b.percent) : (Number(b.weight) || 0) / 100)
    ), 0);
    setRemaining(Math.max(0, baseRemaining - allocatedPct));
  }, [baseRemaining, beneList]);

  const rewardInitial = init.declineRewards ? 'decline' : init.rewardPowerup ? 'powerup' : 'default';

  // Fetch communities once for the picker (post mode only needs it, but
  // fetching eagerly keeps the modal instant when the host switches).
  useEffect(() => {
    axios.post(getHiveUrl(), {
      jsonrpc: '2.0',
      method: 'bridge.list_communities',
      params: { last: '', limit: 100 },
      id: 1,
    }).then(res => setCommunitiesData(res.data.result || [])).catch(() => {});
  }, []);

  // Persist every choice to the shared store (single source of truth read at
  // post time) and notify any parent that passed onChange.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => {
    const cfg = {
      // Always store the TAG as a plain string — postFullPost falls back to the
      // default when it isn't one. The title rides alongside, for display only.
      community: typeof community === 'string' ? community : community?.name || 'hive-181335',
      communityTitle: typeof community === 'object' ? (community?.title || '') : '',
      declineRewards,
      rewardPowerup,
      // …and back out to WEIGHT here, so the publish path (and the persisted
      // config) always sees the canonical {account, weight} Hive shape.
      beneList: (beneList || [])
        .map((b) => ({
          account: b.account,
          weight: Number.isFinite(b.weight) ? b.weight : Math.round((Number(b.percent) || 0) * 100),
        }))
        .filter((b) => b.account && b.weight > 0),
      // Only the studio instance owns this switch; the dialog leaves it alone.
      ...(showAnnounceToggle ? { announceEnabled } : {}),
    };
    setAnnounceConfig(cfg);
    onChangeRef.current?.({ announceType, ...cfg });
  }, [announceType, community, declineRewards, rewardPowerup, beneList, announceEnabled, showAnnounceToggle]);

  const handleReward = (e) => {
    const v = e.target.value;
    setRewardPowerup(v === 'powerup');
    setDeclineRewards(v === 'decline');
  };

  const communityLabel = typeof community === 'string'
    ? (community === 'hive-181335' ? '3Speak (hive-181335)' : community)
    : community?.title || community?.name || t('live.announce.selectCommunity');

  return (
    <div className="hh-announce-opts">
      {/* Studio only — and the studio is always a standalone stream, so the
          wording matches the create dialog's standalone label. Lets the host
          still call off the post before they hit Start; hides the rest of the
          controls when switched off. */}
      {showAnnounceToggle && (
        <label className="hh-announce-opts__toggle">
          <input
            type="checkbox"
            checked={announceEnabled}
            onChange={(e) => setAnnounceEnabled(e.target.checked)}
          />
          <span>{t('live.announce.shareToggle')}</span>
        </label>
      )}

      {showAnnounceToggle && !announceEnabled ? null : (
      <>
      <div className="hh-announce-opts__row">
        {/* Community — only relevant to a full top-level post */}
        {announceType === 'post' && (
          <div className="hh-announce-opts__field">
            <label>{t('live.announce.community')}</label>
            <button
              type="button"
              className="hh-announce-opts__selector"
              onClick={() => setCommunityModalOpen(true)}
            >
              {typeof community !== 'string' && community?.name && (
                <img
                  src={`/img/u/${community.name}/avatar/small`}
                  alt=""
                  className="hh-announce-opts__avatar"
                />
              )}
              <span>{communityLabel}</span>
              <IoIosArrowDropdownCircle size={16} className="hh-announce-opts__chevron" />
            </button>
          </div>
        )}

        {/* Payout / rewards */}
        <div className="hh-announce-opts__field">
          <label>{t('live.announce.rewards')}</label>
          <select className="hh-announce-opts__select" onChange={handleReward} defaultValue={rewardInitial}>
            <option value="default">{t('live.announce.rewardDefault')}</option>
            <option value="powerup">{t('live.announce.rewardPowerup')}</option>
            <option value="decline">{t('live.announce.rewardDecline')}</option>
          </select>
        </div>
      </div>

      {/* Beneficiaries */}
      <div className="hh-announce-opts__bene">
        <div className="hh-announce-opts__bene-info">
          <span className="hh-announce-opts__bene-title">{t('live.announce.beneficiaries')}</span>
          <span className="hh-announce-opts__bene-sub">
            {isPremium
              ? t('live.announce.beneProHint')
              : t('live.announce.beneLockedHint')}
          </span>
        </div>
        <button
          type="button"
          className="hh-announce-opts__bene-btn"
          onClick={() => setBeneModalOpen(true)}
        >
          {beneList.length > 0 && <span className="hh-announce-opts__bene-count">{beneList.length}</span>}
          <MdPeopleAlt />
          <span>{t('live.announce.beneficiaries')}</span>
        </button>
      </div>
      </>
      )}

      {communityModalOpen && (
        <Community_modal
          isOpen={communityModalOpen}
          data={communitiesData}
          close={() => setCommunityModalOpen(false)}
          setCommunity={(c) => { setCommunity(c); setCommunityModalOpen(false); }}
        />
      )}

      {beneModalOpen && (
        <Beneficiary_modal
          isOpen={beneModalOpen}
          close={() => setBeneModalOpen(false)}
          setBeneficiaries={() => {}}
          setBeneficiaryList={setBeneCount}
          setList={setBeneList}
          list={beneList}
          remaingPercent={remaining}
          setRemaingPercent={setRemaining}
          variant="stream"
        />
      )}
    </div>
  );
}
