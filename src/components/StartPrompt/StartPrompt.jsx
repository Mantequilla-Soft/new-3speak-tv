import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../lib/store';
import { hasDecided } from '../../lib/consent';
import { markStartPromptAnswered } from '../../lib/lastPage';
import { blockedNow } from '../InstallAppPrompt/installGate';
import { Button, Dialog } from '../v2/ui';
import { Icon } from '../v2/Icon';
import {
  ANSWERED_KEY, FIRST_DELAY_MS, RETRY_MS, shouldAsk,
} from './startPromptGate';
import './StartPrompt.scss';

const readAnswered = () => {
  try { return localStorage.getItem(ANSWERED_KEY) === '1'; } catch { return false; }
};

/**
 * "Pick up where you left off?" (owner 2026-11-16): asks someone who used 3Speak
 * before, once, whether to turn on Continue where I left off (Settings, General;
 * a first visit has it on already). Comes after the changelog popup (it waits
 * while `appUpdatedFrom` is set), never over another dialog, the cookie banner or
 * the tour. Turn on, Not now, the X and Escape all count as answered.
 */
export default function StartPrompt() {
  const { t } = useTranslation();
  const appUpdatedFrom = useAppStore((s) => s.appUpdatedFrom);
  const setResumeLastPage = useAppStore((s) => s.setResumeLastPage);
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState(false);
  const shownRef = useRef(false);

  useEffect(() => {
    const id = setTimeout(() => setArmed(true), FIRST_DELAY_MS);
    return () => clearTimeout(id);
  }, []);

  useEffect(() => {
    if (!armed || shownRef.current || appUpdatedFrom) return undefined;
    const ask = () => shouldAsk({
      answered: readAnswered(),
      resumeLastPage: useAppStore.getState().resumeLastPage,
    });
    if (!ask()) return undefined;
    let id = null;
    const tryShow = () => {
      if (blockedNow({ consentDecided: hasDecided() })) {
        id = setTimeout(tryShow, RETRY_MS);
        return;
      }
      if (!ask()) return;
      shownRef.current = true;
      setOpen(true);
    };
    tryShow();
    return () => clearTimeout(id);
  }, [armed, appUpdatedFrom]);

  if (!open) return null;

  const close = () => { markStartPromptAnswered(); setOpen(false); };
  const turnOn = () => { setResumeLastPage(true); setOpen(false); };

  return (
    <Dialog
      open
      onClose={close}
      title={t('settings.startPrompt.title')}
      closeLabel={t('common.actions.close')}
      tone="cyan"
      width={420}
      backdropClose={false}
      className="start-prompt"
      footer={(
        <div className="start-prompt__foot">
          <Button variant="secondary" center onClick={close}>{t('settings.startPrompt.notNow')}</Button>
          <Button variant="primary" center onClick={turnOn}>{t('settings.startPrompt.turnOn')}</Button>
        </div>
      )}
    >
      <div className="start-prompt__body">
        <span className="start-prompt__icon" aria-hidden="true"><Icon name="history" size={24} /></span>
        <p>{t('settings.startPrompt.intro')}</p>
      </div>
    </Dialog>
  );
}
