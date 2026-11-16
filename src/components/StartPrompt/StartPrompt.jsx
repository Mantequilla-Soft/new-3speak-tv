import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../lib/store';
import { consentDecidedAt, hasConsent, hasDecided, setConsent } from '../../lib/consent';
import { notifyAdConsentChanged } from '../../lib/thirdPartyAds';
import { blockedNow } from '../InstallAppPrompt/installGate';
import { Button, Dialog, SettingRow, Toggle } from '../v2/ui';
import {
  ANSWERED_KEY, ALWAYS_ON_HOSTS, FIRST_DELAY_MS, RETRY_MS, startPromptItems,
} from './startPromptGate';
import './StartPrompt.scss';

const readAnswered = () => {
  try { return localStorage.getItem(ANSWERED_KEY) === '1'; } catch { return false; }
};
const markAnswered = () => {
  try { localStorage.setItem(ANSWERED_KEY, '1'); } catch { /* asked again next visit */ }
};

/**
 * "Pick up where you left off?" (owner 2026-11-16): asks once whether to turn on
 * Continue where I left off (Settings, General), and, for someone who answered
 * the cookie banner without it, whether to remember where they left off in each
 * video. Comes after the changelog popup (it waits while `appUpdatedFrom` is set),
 * never over another dialog, the cookie banner or the tour. Both switches start
 * at what is set now, so nothing optional is ticked for anyone. Save, Not now,
 * the X and Escape all count as answered.
 */
export default function StartPrompt() {
  const { t } = useTranslation();
  const appUpdatedFrom = useAppStore((s) => s.appUpdatedFrom);
  const resumeLastPage = useAppStore((s) => s.resumeLastPage);
  const setResumeLastPage = useAppStore((s) => s.setResumeLastPage);
  const [items, setItems] = useState(null);
  const [resumeOn, setResumeOn] = useState(false);
  const [playbackOn, setPlaybackOn] = useState(false);
  const [armed, setArmed] = useState(false);
  const shownRef = useRef(false);

  useEffect(() => {
    const id = setTimeout(() => setArmed(true), FIRST_DELAY_MS);
    return () => clearTimeout(id);
  }, []);

  useEffect(() => {
    if (!armed || shownRef.current || appUpdatedFrom) return undefined;
    const ask = () => startPromptItems({
      always: typeof window !== 'undefined' && ALWAYS_ON_HOSTS.includes(window.location.hostname),
      answered: readAnswered(),
      resumeLastPage: useAppStore.getState().resumeLastPage,
      consentDecidedAt: consentDecidedAt(),
      functionalConsent: hasConsent('functional'),
    });
    if (!ask().length) return undefined;
    let id = null;
    const tryShow = () => {
      if (blockedNow({ consentDecided: hasDecided() })) {
        id = setTimeout(tryShow, RETRY_MS);
        return;
      }
      const list = ask();
      if (!list.length) return;
      shownRef.current = true;
      setResumeOn(!!useAppStore.getState().resumeLastPage);
      setPlaybackOn(hasConsent('functional'));
      setItems(list);
    };
    tryShow();
    return () => clearTimeout(id);
  }, [armed, appUpdatedFrom]);

  if (!items) return null;

  const close = () => { markAnswered(); setItems(null); };
  const save = () => {
    if (items.includes('lastPage') && resumeOn !== !!resumeLastPage) setResumeLastPage(resumeOn);
    if (items.includes('playback') && playbackOn !== hasConsent('functional')) {
      setConsent({ functional: playbackOn, advertising: hasConsent('advertising') });
      notifyAdConsentChanged();
    }
    close();
  };

  return (
    <Dialog
      open
      onClose={close}
      title={t('settings.startPrompt.title')}
      closeLabel={t('common.actions.close')}
      tone="cyan"
      width={440}
      backdropClose={false}
      className="start-prompt"
      footer={(
        <div className="start-prompt__foot">
          <Button variant="secondary" center onClick={close}>{t('settings.startPrompt.notNow')}</Button>
          <Button variant="primary" center onClick={save}>{t('common.actions.save')}</Button>
        </div>
      )}
    >
      <p className="start-prompt__intro">{t('settings.startPrompt.intro')}</p>
      <div className="start-prompt__rows">
        {items.includes('lastPage') && (
          <SettingRow
            icon="history"
            title={t('settings.startup.resume.title')}
            sub={t('settings.startup.resume.desc')}
            control={<Toggle tone="cyan" checked={resumeOn} onChange={setResumeOn} label={t('settings.startup.resume.title')} />}
          />
        )}
        {items.includes('playback') && (
          <SettingRow
            icon="replay"
            title={t('consent.toggles.resumeTitle')}
            sub={t('consent.toggles.resumeDesc')}
            control={<Toggle tone="cyan" checked={playbackOn} onChange={setPlaybackOn} label={t('consent.toggles.resumeTitle')} />}
          />
        )}
      </div>
    </Dialog>
  );
}
