import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useAppStore } from '../../lib/store';
import { adsEnabledFor, adsBetaUserFor } from '../../utils/config';
import { readCreatorAdChoice } from '../../utils/adSettings';
import { fetchAdAccess } from '../../lib/advertiseData';
import { usePromptsActive, setPromptActive } from '../../utils/welcomeGate';
import AdSettingsDialog from './AdSettingsDialog';
import './AdsPrompt.scss';

/**
 * The ad prompt a creator sees once: choose how ads run on your videos.
 *
 * There used to be a second one after it, pitching creators to buy a spot of
 * their own. It was dropped (2026-09-24) as too pushy: /advertise is still in
 * the account menu for anyone who wants it.
 *
 * Mounted once at the app root.
 */

// Per-user "already asked" flag.
const SETTINGS_KEY = '3speak_ad_settings_prompted';

const load = (key) => {
  try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; }
};
const wasSeen = (key, username) => load(key).includes(username);
const markSeen = (key, username) => {
  try {
    const set = new Set(load(key));
    set.add(username);
    localStorage.setItem(key, JSON.stringify([...set]));
  } catch { /* ignore storage errors */ }
};

export default function AdsPrompt() {
  const user = useAppStore((s) => s.user);
  const authenticated = useAppStore((s) => s.authenticated);
  // 'settings' | null
  const [stage, setStage] = useState(null);
  // The server's own split (pool size and the default community share) so no
  // number in this flow is a second copy of a platform default living in the
  // browser, where it would drift out of step with what the save is checked against.
  const [split, setSplit] = useState(null);
  const [adsEnabled, setAdsEnabled] = useState(true);
  const promptsActive = usePromptsActive('ads');

  // Closed testing. Two conditions, and both are needed.
  //
  // The build flag says whether the ad UI exists here at all — with it off there
  // is no /advertise page to send anyone to. But VITE_ENABLE_ADS=true opens that
  // UI to every visitor, while the checker's own gate (ADS_STAGE + ADS_BETA_USERS)
  // still refuses an application or a settings save from anyone outside the test.
  // Prompting on the flag alone is how everyone ended up being pitched a feature
  // the server would then turn them down for.
  //
  // So the second condition is the checker's answer for THIS account, asked of the
  // gate that actually enforces it. `null` = not answered yet, and stays closed.
  const uiAvailable = adsEnabledFor(user);

  // And never on /advertise itself. Someone already reading the ad page does not
  // need a dialog opening on top of it to tell them the page exists, and from the
  // rollout on this is a link people arrive at from outside 3Speak. Held rather
  // than spent: the "already asked" flags are untouched, so a prompt that is still
  // owed comes up once they are somewhere else.
  const { pathname } = useLocation();
  const onAdvertise = (() => {
    const p = String(pathname || '').toLowerCase();
    return p === '/advertise' || p.startsWith('/advertise/');
  })();
  const mayPrompt = uiAvailable && !onAdvertise;

  // Stamped with the account it was fetched for, so a session switch invalidates
  // it rather than carrying one creator's verdict over to the next.
  const [access, setAccess] = useState(null);
  const visible = mayPrompt && !!user && access?.account === user && access.allowed === true;

  useEffect(() => {
    if (!authenticated || !user || !uiAvailable) return undefined;
    let alive = true;
    fetchAdAccess(user).then((a) => {
      if (!alive) return;
      // No answer (a checker without the /access route, or the network): fall back
      // to the accounts this build knows are testers — NOT to the blanket flag,
      // which is the thing that was wrong.
      setAccess({ account: user, allowed: a ? a.allowed : adsBetaUserFor(user) });
    });
    return () => { alive = false; };
  }, [authenticated, user, uiAvailable]);

  useEffect(() => {
    if (!authenticated || !user || !visible) return undefined;
    if (stage) return undefined;              // already running
    if (promptsActive) return undefined;      // welcome / interests has the screen
    const askSettings = !wasSeen(SETTINGS_KEY, user);
    if (!askSettings) return undefined;

    let alive = true;
    // Later than the interests prompt's 1.2s so that one wins the slot on a fresh
    // account, rather than the two racing for it.
    const t = setTimeout(async () => {
      if (!alive) return;
      let next = null;

      if (askSettings) {
        const choice = await readCreatorAdChoice(user);
        if (!alive) return;
        // Neither store could be read — say nothing and try again next session.
        // Prompting here would put a dialog in front of someone who already chose.
        if (choice.chosen === null) return;
        if (choice.chosen) {
          markSeen(SETTINGS_KEY, user);       // already decided; don't ask again
        } else if (!choice.split) {
          // No split from the server means no pool size and no platform default to
          // put in front of anyone. Ask nothing this session rather than invent them.
          return;
        } else {
          setSplit(choice.split);
          setAdsEnabled(choice.adsEnabled);
          next = 'settings';
        }
      }

      if (!next || !alive) return;
      // Claim the slot in the same tick we decide to open.
      setPromptActive('ads', true);
      setStage(next);
    }, 2000);

    return () => { alive = false; clearTimeout(t); };
  }, [authenticated, user, visible, promptsActive, stage]);

  // Release the slot however this unmounts, so a prompt waiting on it is not left
  // waiting forever by a route change mid-decision.
  useEffect(() => () => setPromptActive('ads', false), []);

  const finish = () => {
    setStage(null);
    setPromptActive('ads', false);
  };

  // Saved or dismissed: asked at most once, like the interests prompt.
  const afterSettingsSaved = () => {
    if (user) markSeen(SETTINGS_KEY, user);
    finish();
  };
  const afterSettingsDismissed = afterSettingsSaved;

  if (!user || !visible) return null;

  if (stage === 'settings') {
    return (
      <AdSettingsDialog
        user={user}
        split={split}
        initialAdsEnabled={adsEnabled}
        onSaved={afterSettingsSaved}
        onDismiss={afterSettingsDismissed}
      />
    );
  }
  return null;
}
