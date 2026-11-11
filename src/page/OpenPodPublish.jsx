import { useState, useEffect } from 'react';
import { getHiveUrl } from '../utils/hiveNode';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toastIn } from '../utils/toast';
import axios from 'axios';
import { useAppStore } from '../lib/store';
import { useHangout } from '../context/HangoutContext';
import { commentWithAioha } from '../hive-api/aioha';
import MarkdownComposer from '../components/studio/MarkdownComposer';
import Community_modal from '../components/modal/Community_modal';
import Beneficiary_modal from '../components/modal/Beneficiary_modal';
import AudioPlayerInline from '../components/AudioPlayerInline/AudioPlayerInline';
import { usePremiumStatus } from '../hooks/usePremiumStatus';
import { enforceLockedBeneficiaries } from '../utils/beneficiaries';
import './OpenPodPublish.scss';
import AccountImg from '../components/HiveAvatar/AccountImg';
import { Button, EmptyState, Field, Icon } from '../components/v2/ui';

// Every toast from this module is headed "Live"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Live');

const HANGOUTS_API = import.meta.env.VITE_HANGOUTS_API_URL;

export default function OpenPodPublish() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { authenticated, user } = useAppStore();
  const { sessionToken, sessionLoading, retryLogin } = useHangout();
  const premiumStatus = usePremiumStatus(user);
  const isPremium = !!premiumStatus?.premium;

  // Lazy login when actively opening Hangouts publish flow
  useEffect(() => {
    if (authenticated && user && !sessionToken && !sessionLoading) {
      retryLogin(user);
    }
  }, [authenticated, user, sessionToken, sessionLoading, retryLogin]);

  const audioUrl  = searchParams.get('audioUrl')  || '';
  const roomTitle = searchParams.get('title')      || '';
  const audioPerm = searchParams.get('audioPerm')  || '';
  const roomName  = searchParams.get('roomName')   || '';

  const [title, setTitle]             = useState(roomTitle);
  const [description, setDescription] = useState('');
  const [tagsInput, setTagsInput]     = useState('openpod 3speak');
  const [tagsPreview, setTagsPreview] = useState(['openpod', '3speak']);
  const [community, setCommunity]     = useState('hive-181335');
  const [declineRewards, setDeclineRewards]   = useState(false);
  const [rewardPowerup,  setRewardPowerup]    = useState(false);
  const [communitiesData, setCommunitiesData] = useState([]);
  const [communityModalOpen, setCommunityModalOpen] = useState(false);
  const [beneModalOpen,      setBeneModalOpen]      = useState(false);
  const [beneList,   setBeneList]     = useState([]);
  const [_beneCount, setBeneCount]    = useState(2);
  const [remaining,  setRemaining]    = useState(89);
  const [publishing, setPublishing]   = useState(false);
  const [thumbnailUrl, setThumbnailUrl] = useState('');

  // Fetch audio metadata (thumbnail) from the audio backend
  useEffect(() => {
    if (!audioPerm || !audioUrl) return;
    try {
      const base = new URL(audioUrl).origin;
      fetch(`${base}/api/audio?a=${audioPerm}`)
        .then(r => r.ok ? r.json() : null)
        .then(data => { if (data?.thumbnail_url) setThumbnailUrl(data.thumbnail_url); })
        .catch(() => {});
    } catch { /* invalid URL */ }
  }, [audioPerm, audioUrl]);

  // Fetch communities for the modal
  useEffect(() => {
    axios.post(getHiveUrl(), {
      jsonrpc: '2.0',
      method: 'bridge.list_communities',
      params: { last: '', limit: 100 },
      id: 1,
    }).then(res => setCommunitiesData(res.data.result || [])).catch(() => {});
  }, []);

  const handleTagsChange = (value) => {
    setTagsInput(value.toLowerCase());
    setTagsPreview(value.toLowerCase().trim().split(/\s+/).filter(Boolean));
  };

  const handleReward = (e) => {
    const v = e.target.value;
    setRewardPowerup(v === 'powerup');
    setDeclineRewards(v === 'decline');
  };

  const handlePublish = async () => {
    if (!authenticated) { toast.error(t('common.status.loginRequired')); return; }
    if (!title.trim())  { toast.error(t('live.publish.errors.noTitle')); return; }
    if (!audioUrl)      { toast.error(t('live.publish.errors.noAudio')); return; }

    const communityTag = typeof community === 'string' ? community : community?.name || 'hive-181335';
    const tags = ['3speak', 'openpod', communityTag,
      ...tagsPreview.filter(tag => !['3speak', 'openpod', communityTag].includes(tag)),
    ];

    const thumbnailLine = thumbnailUrl ? `![${title.trim()}](${thumbnailUrl})\n\n` : '';
    const descPart = description.trim() ? `${description.trim()}\n\n---\n\n` : '';
    const body = `${thumbnailLine}${descPart}<center>\n\n🎙️ **OpenPod Recording**\n\n${audioUrl}\n\n*Recorded live on [3speak OpenPods](https://3speak.tv/openpods)*\n\n</center>`;

    const permlink = `openpod-rec-${Date.now()}`;

    const jsonMetadata = {
      app: '3speak/openpod',
      format: 'markdown',
      tags,
      type: 'openpod-recording',
      audio: audioUrl,
      ...(thumbnailUrl && { image: [thumbnailUrl] }),
    };

    // Build beneficiaries — threespeakfund 10% is locked for non-Pro
    // hosts; Pro hosts skip the platform split entirely.
    // Beneficiary_modal hands back {account, percent}; Hive wants WEIGHT
    // (1/100th of a percent). Reading b.weight straight off the list silently
    // produced undefined weights, so added beneficiaries never applied.
    const beneMap = new Map();
    for (const b of beneList) {
      const weight = Number.isFinite(b.weight) ? b.weight : Math.round((Number(b.percent) || 0) * 100);
      if (!b.account || weight <= 0) continue;
      beneMap.set(b.account, Math.max(beneMap.get(b.account) || 0, weight));
    }
    enforceLockedBeneficiaries(beneMap, { isPremium, originalAuthor: null });
    const allBeneficiaries = [...beneMap.entries()]
      .map(([account, weight]) => ({ account, weight }))
      .sort((a, b) => a.account.localeCompare(b.account));

    const commentOptions = {
      author: user,
      permlink,
      max_accepted_payout: declineRewards ? '0.000 HBD' : '1000000.000 HBD',
      percent_hbd: rewardPowerup ? 0 : 10000,
      allow_votes: true,
      allow_curation_rewards: true,
      extensions: [[0, { beneficiaries: allBeneficiaries }]],
    };

    try {
      setPublishing(true);
      const result = await commentWithAioha(
        '',
        communityTag,
        permlink,
        title,
        body,
        jsonMetadata,
        commentOptions,
      );

      if (!result.success) throw new Error('Post failed');

      toast.success(t('live.publish.published'));

      // Best-effort: enrich the MongoDB audio entry with the Hive post data
      if (audioPerm && roomName && sessionToken) {
        fetch(
          `${HANGOUTS_API}/rooms/${encodeURIComponent(roomName)}/record/${encodeURIComponent(audioPerm)}/metadata`,
          {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${sessionToken}`,
            },
            body: JSON.stringify({
              title: title.trim(),
              description: description.trim() || undefined,
              tags,
              post_permlink: `${user}/${permlink}`,
            }),
          },
        ).catch(err => console.warn('Audio metadata sync failed (non-blocking):', err));
      }

      navigate(`/post/${user}/${permlink}`, {
        state: {
          title: title.trim(),
          body,
          author: user,
          permlink,
          tags,
          created: new Date().toISOString(),
          thumbnailUrl: thumbnailUrl || undefined,
          audioUrl: audioUrl || undefined,
        },
      });
    } catch (err) {
      console.error('Publish failed:', err);
      toast.error(t('live.publish.errors.failed'));
    } finally {
      setPublishing(false);
    }
  };

  if (!authenticated) {
    return (
      <div className="openpod-publish-page">
        <EmptyState
          icon="mic"
          title={t('live.publish.heading')}
          className="publish-login-gate"
          action={<Button variant="primary" icon="login" onClick={() => navigate('/login')}>{t('common.actions.login')}</Button>}
        >
          {t('live.publish.loginGate')}
        </EmptyState>
      </div>
    );
  }

  const communityLabel = typeof community === 'string'
    ? (community === 'hive-181335' ? '3Speak (hive-181335)' : community)
    : community?.title || community?.name || t('live.announce.selectCommunity');

  return (
    <div className="openpod-publish-page">
      <div className="publish-header">
        <span className="publish-bar" aria-hidden="true" />
        <h1>{t('live.publish.heading')}</h1>
      </div>

      {/* Audio preview */}
      {audioUrl && (
        <section className="publish-audio-preview">
          <div className="preview-copy">
            <span className="preview-label v2-eyebrow">{t('live.publish.previewLabel')}</span>
            <p>{t('live.publish.previewHint')}</p>
          </div>
          <AudioPlayerInline
            src={audioUrl}
            variant="preview"
            title={title || roomTitle || t('live.publish.recordingFallback')}
            artworkUrl={thumbnailUrl}
            externalUrl={audioUrl}
          />
        </section>
      )}

      <div className="publish-form">
        {/* Title */}
        <Field
          label={t('live.publish.title')}
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder={t('live.publish.titlePlaceholder')}
          className="publish-field"
        />

        {/* Description */}
        <div className="v2-field publish-field">
          <span className="v2-eyebrow">
            {t('live.publish.description')} <span className="v2-field__opt optional">{t('live.publish.optional')}</span>
          </span>
          <MarkdownComposer
            value={description}
            onChange={setDescription}
            placeholder={t('live.publish.descriptionPlaceholder')}
          />
        </div>

        {/* Tags */}
        <div className="publish-field">
          <Field
            label={t('live.publish.tags')}
            value={tagsInput}
            onChange={e => handleTagsChange(e.target.value)}
            placeholder={t('live.publish.tagsPlaceholder')}
          />
          {tagsPreview.length > 0 && (
            <div className="tags-preview">
              {tagsPreview.map((tag, i) => (
                <span key={i} className="tag-chip">#{tag}</span>
              ))}
            </div>
          )}
        </div>

        <div className="publish-row">
          {/* Community */}
          <div className="v2-field publish-field publish-field--half">
            <span className="v2-eyebrow">{t('live.announce.community')}</span>
            <button
              type="button"
              className="publish-selector"
              onClick={() => setCommunityModalOpen(true)}
            >
              {typeof community !== 'string' && community?.name && (
                <AccountImg
                  account={community.name}
                  alt=""
                  className="community-avatar"
                />
              )}
              <span>{communityLabel}</span>
              <Icon name="expand_more" size={18} className="selector-chevron" />
            </button>
          </div>

          {/* Rewards */}
          <div className="v2-field publish-field publish-field--half">
            <label className="v2-eyebrow" htmlFor="openpod-publish-rewards">{t('live.announce.rewards')}</label>
            <select id="openpod-publish-rewards" className="v2-input is-select publish-select" onChange={handleReward}>
              <option value="default">{t('live.announce.rewardDefault')}</option>
              <option value="powerup">{t('live.announce.rewardPowerup')}</option>
              <option value="decline">{t('live.publish.declinePayout')}</option>
            </select>
          </div>
        </div>

        {/* Beneficiaries: the locked 10% reads as a well with a lock (39a) */}
        <div className="bene-row">
          <Icon name={isPremium ? 'group' : 'lock'} size={18} className="bene-icon" />
          <div className="bene-info">
            <span className="bene-title">{t('live.announce.beneficiaries')}</span>
            <span className="bene-sub">
              {isPremium
                ? t('live.announce.beneProHint')
                : t('live.announce.beneLockedHint')}
            </span>
          </div>
          <Button
            variant="secondary"
            size={36}
            icon="group_add"
            className="bene-btn"
            onClick={() => setBeneModalOpen(true)}
          >
            {t('live.announce.beneficiaries')}
            {beneList.length > 0 && <span className="bene-count num">{beneList.length}</span>}
          </Button>
        </div>

        {/* Submit */}
        <div className="publish-actions">
          <Button
            variant="secondary"
            size={48}
            icon="arrow_back"
            className="publish-cancel"
            onClick={() => navigate('/openpods')}
          >
            {t('live.backToOpenPods')}
          </Button>
          <Button
            variant="primary"
            size={48}
            trailing="send"
            className="publish-submit"
            onClick={handlePublish}
            disabled={publishing}
            loading={publishing}
          >
            {publishing ? t('live.publish.publishing') : t('live.publish.submit')}
          </Button>
        </div>
      </div>

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
        />
      )}
    </div>
  );
}
