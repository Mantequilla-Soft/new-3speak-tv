import { useState, useEffect } from 'react';
import { getHiveUrl } from '../utils/hiveNode';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toastIn } from '../utils/toast';
import axios from 'axios';
import { MdMic, MdPeopleAlt } from 'react-icons/md';
import { IoIosArrowDropdownCircle } from 'react-icons/io';
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

// Every toast from this module is headed "Live"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Live');

const HANGOUTS_API = import.meta.env.VITE_HANGOUTS_API_URL;

export default function OpenPodPublish() {
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
    if (!authenticated) { toast.error('Please log in first'); return; }
    if (!title.trim())  { toast.error('Please add a title'); return; }
    if (!audioUrl)      { toast.error('No audio URL found'); return; }

    const communityTag = typeof community === 'string' ? community : community?.name || 'hive-181335';
    const tags = ['3speak', 'openpod', communityTag,
      ...tagsPreview.filter(t => !['3speak', 'openpod', communityTag].includes(t)),
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

      toast.success('Recording published to Hive!');

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
      toast.error('Failed to publish. Please try again.');
    } finally {
      setPublishing(false);
    }
  };

  if (!authenticated) {
    return (
      <div className="openpod-publish-page">
        <div className="publish-login-gate">
          <MdMic className="gate-icon" />
          <p>Log in to publish your recording.</p>
          <button onClick={() => navigate('/login')}>Log in</button>
        </div>
      </div>
    );
  }

  const communityLabel = typeof community === 'string'
    ? (community === 'hive-181335' ? '3Speak (hive-181335)' : community)
    : community?.title || community?.name || 'Select Community';

  return (
    <div className="openpod-publish-page">
      <div className="publish-header">
        <MdMic className="publish-mic-icon" />
        <h1>Publish OpenPod Recording</h1>
      </div>

      {/* Audio preview */}
      {audioUrl && (
        <div className="publish-audio-preview">
          <div className="preview-copy">
            <span className="preview-label">Recording preview</span>
            <p>Review the audio before publishing. This is the same player readers will see on the post.</p>
          </div>
          <AudioPlayerInline
            src={audioUrl}
            variant="preview"
            title={title || roomTitle || 'OpenPod Recording'}
            artworkUrl={thumbnailUrl}
            externalUrl={audioUrl}
          />
        </div>
      )}

      <div className="publish-form">
        {/* Title */}
        <div className="publish-field">
          <label>Title</label>
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Give your recording a title"
            className="publish-input"
          />
        </div>

        {/* Description */}
        <div className="publish-field">
          <label>Description <span className="optional">(optional)</span></label>
          <MarkdownComposer
            value={description}
            onChange={setDescription}
            placeholder="What did you talk about? Add show notes, links, or a summary..."
          />
        </div>

        {/* Tags */}
        <div className="publish-field">
          <label>Tags</label>
          <input
            type="text"
            value={tagsInput}
            onChange={e => handleTagsChange(e.target.value)}
            placeholder="Space-separated tags"
            className="publish-input"
          />
          <div className="tags-preview">
            {tagsPreview.map((t, i) => (
              <span key={i} className="tag-chip">{t}</span>
            ))}
          </div>
        </div>

        <div className="publish-row">
          {/* Community */}
          <div className="publish-field publish-field--half">
            <label>Community</label>
            <button
              type="button"
              className="publish-selector"
              onClick={() => setCommunityModalOpen(true)}
            >
              {typeof community !== 'string' && community?.name && (
                <img
                  src={`https://images.hive.blog/u/${community.name}/avatar/small`}
                  alt=""
                  className="community-avatar"
                />
              )}
              <span>{communityLabel}</span>
              <IoIosArrowDropdownCircle size={16} className="selector-chevron" />
            </button>
          </div>

          {/* Rewards */}
          <div className="publish-field publish-field--half">
            <label>Rewards</label>
            <select className="publish-select" onChange={handleReward}>
              <option value="default">Default 50/50</option>
              <option value="powerup">Power up 100%</option>
              <option value="decline">Decline Payout</option>
            </select>
          </div>
        </div>

        {/* Beneficiaries */}
        <div className="publish-field">
          <div className="bene-row">
            <div className="bene-info">
              <span className="bene-title">Beneficiaries</span>
              <span className="bene-sub">
                {isPremium
                  ? 'You’re on 3Speak Pro — no platform fee. Add splits if you like.'
                  : '10% to @threespeakfund is locked. You can add more.'}
              </span>
            </div>
            <button
              type="button"
              className="bene-btn"
              onClick={() => setBeneModalOpen(true)}
            >
              {beneList.length > 0 && <span className="bene-count">{beneList.length}</span>}
              <MdPeopleAlt />
              <span>Beneficiaries</span>
            </button>
          </div>
        </div>

        {/* Submit */}
        <div className="publish-actions">
          <button
            type="button"
            className="publish-cancel"
            onClick={() => navigate('/openpods')}
          >
            Back to OpenPods
          </button>
          <button
            type="button"
            className="publish-submit"
            onClick={handlePublish}
            disabled={publishing}
          >
            {publishing ? 'Publishing…' : 'Publish Recording'}
          </button>
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
