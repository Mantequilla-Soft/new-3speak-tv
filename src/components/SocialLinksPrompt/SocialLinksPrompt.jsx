import { lazy, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../lib/store';
import { getLinks } from '../../utils/socialVerifier';
import { usePromptsActive, setPromptActive } from '../../utils/welcomeGate';
import MountWhenOpened from '../common/LazyMount';
import { Button, Dialog } from '../v2/ui';
import { Icon } from '../v2/Icon';
import './SocialLinksPrompt.scss';

const SettingsModal = lazy(() => import('../SettingsModal/SettingsModal'));

// Per-account "already asked" flag (browser storage): the prompt shows once,
// however it was closed (owner 2026-11-17).
const PROMPTED_KEY = '3speak_social_links_prompted';
const loadPrompted = () => {
  try { return JSON.parse(localStorage.getItem(PROMPTED_KEY) || '[]'); } catch { return []; }
};
const wasPrompted = (username) => loadPrompted().includes(username);
const markPrompted = (username) => {
  try {
    const set = new Set(loadPrompted());
    set.add(username);
    localStorage.setItem(PROMPTED_KEY, JSON.stringify([...set]));
  } catch { /* ignore storage errors */ }
};

/**
 * One-time nudge for a Hive account with no linked social profiles: link
 * YouTube and the others and import from them. "Link profiles" opens Settings
 * on Connections, where the linking is. Warm-up accounts are not asked.
 * Mounted once at the app root, after the other prompts (utils/welcomeGate).
 */
export default function SocialLinksPrompt() {
  const { t } = useTranslation();
  const user = useAppStore((s) => s.user);
  const incubationHandle = useAppStore((s) => s.incubationHandle);
  const authenticated = useAppStore((s) => s.authenticated);
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const promptsActive = usePromptsActive('socialLinks');

  useEffect(() => {
    if (!authenticated || !user || incubationHandle || wasPrompted(user)) return undefined;
    if (promptsActive) return undefined;
    let alive = true;
    const timer = setTimeout(async () => {
      // A link still being verified counts: they have found the place.
      const links = await getLinks(user, { includePending: true }).catch(() => null);
      if (!alive) return;
      if (links == null) return;     // checker unreachable: ask next session
      if (links.length > 0) { markPrompted(user); return; }
      setPromptActive('socialLinks', true);
      setOpen(true);
    }, 1500);
    return () => { alive = false; clearTimeout(timer); };
  }, [authenticated, user, incubationHandle, promptsActive]);

  useEffect(() => () => setPromptActive('socialLinks', false), []);

  const close = () => {
    markPrompted(user);
    setOpen(false);
    setPromptActive('socialLinks', false);
  };

  // The slot stays claimed while Settings is up, so no other prompt opens on it.
  const linkProfiles = () => {
    markPrompted(user);
    setOpen(false);
    setSettingsOpen(true);
  };

  const closeSettings = () => {
    setSettingsOpen(false);
    setPromptActive('socialLinks', false);
  };

  return (
    <>
      {open && (
        <Dialog
          open
          onClose={close}
          title={t('app.socialLinks.title')}
          closeLabel={t('common.actions.close')}
          width={460}
          tone="cyan"
          className="social-links-prompt"
          footer={(
            <>
              <Button variant="secondary" size={44} onClick={close}>
                {t('common.actions.close')}
              </Button>
              <Button variant="cyan" size={44} icon="link" className="social-links-prompt__main" onClick={linkProfiles}>
                {t('app.socialLinks.link')}
              </Button>
            </>
          )}
        >
          <div className="social-links-prompt__icons" aria-hidden="true">
            <span><Icon name="smart_display" size={22} /></span>
            <span><Icon name="podcasts" size={22} /></span>
            <span><Icon name="music_note" size={22} /></span>
          </div>
          <p className="social-links-prompt__lede">{t('app.socialLinks.body')}</p>
          <p className="v2-meta-sm">{t('app.socialLinks.note')}</p>
        </Dialog>
      )}
      <MountWhenOpened when={settingsOpen} name="settings">
        <SettingsModal isOpen={settingsOpen} initialTab="connections" onClose={closeSettings} />
      </MountWhenOpened>
    </>
  );
}
