import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { STT_WS_URL, sttEnabledFor } from '../../utils/config';
import { createLiveCaptionSource, captionLanguages } from '../../utils/liveCaptionSource';
import { speechInfo } from '../../utils/transcribe';
import { usePremiumStatus } from '../../hooks/usePremiumStatus';
import { saveCaptionEdit } from '../../lib/captionEdit';
import { toastIn } from '../../utils/toast';
import { t as tGlobal } from '../../i18n';
import './LiveCaptions.scss';

/**
 * Live captions for the OpenPods studio (H11). The host's browser streams its
 * own mic to the teleprompter's speech server (no new server) only when the
 * host switches "Live captions" on; the hangouts server caps how many streams
 * caption at once. A Pro feature (owner 2026-11-17): offered to Pro hosts
 * wherever the site has a speech server (sttEnabledFor) with a language for it.
 * Where the server runs stream captions on Whisper (/live) the finals are
 * Whisper's sentences and every Whisper language can be picked; else they run
 * on /stt with the live (Vosk) models.
 */

/** The SDK studio's captions setting text, in the site language. */
export function studioCaptionLabels(t) {
  return {
    title: t('liveCaptions.studio.title'),
    toggle: t('liveCaptions.studio.toggle'),
    hint: t('liveCaptions.studio.hint'),
    language: t('liveCaptions.studio.language'),
    onlyLanguage: t('liveCaptions.studio.onlyLanguage'),
    statusOff: t('liveCaptions.studio.statusOff'),
    statusWaiting: t('liveCaptions.studio.statusWaiting'),
    statusMicOff: t('liveCaptions.studio.statusMicOff'),
    statusStarting: t('liveCaptions.studio.statusStarting'),
    statusOn: t('liveCaptions.studio.statusOn'),
    statusFull: t('liveCaptions.studio.statusFull'),
    statusUnavailable: t('liveCaptions.studio.statusUnavailable'),
    statusError: t('liveCaptions.studio.statusError'),
  };
}

/** `captions` for <HangoutsRoom>: undefined when this host cannot caption. */
export function useStudioCaptionsOptions(user, active = true) {
  const { t, i18n } = useTranslation();
  const uiLang = i18n.resolvedLanguage || i18n.language;
  const pro = !!usePremiumStatus(user)?.premium;
  const enabled = active && pro && sttEnabledFor(user);
  const [info, setInfo] = useState(null);

  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    speechInfo().then((i) => { if (alive) setInfo(i); });
    return () => { alive = false; };
  }, [enabled]);

  const live = !!info?.live;
  const source = useMemo(() => createLiveCaptionSource({
    url: STT_WS_URL,
    liveUrl: live ? STT_WS_URL.replace(/\/stt\/?$/, '/live') : null,
    user,
  }), [live, user]);
  return useMemo(() => {
    if (!enabled || !info) return undefined;
    // The host's own language first: the studio starts on the first one
    const base = (uiLang || 'en').split('-')[0].toLowerCase();
    const languages = captionLanguages(live ? info.live.langs : info.models, uiLang)
      .sort((x, y) => (y.code.split('-')[0] === base) - (x.code.split('-')[0] === base));
    if (!languages.length) return undefined;
    return { source, languages, labels: studioCaptionLabels(t) };
  }, [enabled, info, live, uiLang, source, t]);
}

const toast = toastIn('Captions');

/**
 * The stream's live captions as the replay's subtitles: saved on the
 * announcement post (author = host, permlink = room name, the same identity
 * the server publishes the VOD under) through the captions editor's signed
 * save, which adds a language the video has none in yet. Fire and forget.
 */
export async function saveStreamCaptions({ author, permlink, captions, save = saveCaptionEdit }) {
  if (!author || !permlink || !captions?.cues?.length) return false;
  try {
    await save({ author, permlink, lang: captions.lang || 'en', cues: captions.cues });
    toast.success(tGlobal('liveCaptions.vod.saved'));
    return true;
  } catch {
    toast.error(tGlobal('liveCaptions.vod.failed'));
    return false;
  }
}
