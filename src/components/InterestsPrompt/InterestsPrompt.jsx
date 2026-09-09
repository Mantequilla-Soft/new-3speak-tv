import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toastIn } from '../../utils/toast';
import { useAppStore } from '../../lib/store';
import { fetchUserInterests, saveInterestsToHive } from '../../utils/interests';
import { fetchMyIncubationProfile, saveIncubationProfile } from '../../lib/incubation';
import { usePromptsActive, setPromptActive } from '../../utils/welcomeGate';
import { refreshHomeFeeds } from '../../utils/feedSeed';
import TagsV2Picker from '../tooltip/TagsV2Picker';
import './InterestsPrompt.scss';

// Every toast from this module is headed "Settings"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Settings');

// Per-user "already asked" flag (browser storage) so a given account is prompted
// at most once — set when they save a selection or explicitly decline with
// "Not now". Clicking the backdrop away does NOT set it; see close/decline.
const PROMPTED_KEY = '3speak_interests_prompted';
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
 * One-time, kind nudge for logged-in users who haven't set any interests yet.
 * Mounted once at the app root. Shows at most once per account per browser.
 */
export default function InterestsPrompt() {
  const user = useAppStore((s) => s.user);
  const incubationHandle = useAppStore((s) => s.incubationHandle);
  const authenticated = useAppStore((s) => s.authenticated);
  const setInterests = useAppStore((s) => s.setInterests);
  // Whose interests these are. A handle is not a Hive account, but it is a
  // stable identity for the "already asked" memo and for reading them back.
  const who = user || incubationHandle;
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState([]);
  const [saving, setSaving] = useState(false);
  // Whichever app-root prompt is on screen gets it to itself; we re-run once it
  // is done. Was welcome-only, which was enough until the ads prompts existed.
  const promptsActive = usePromptsActive('interests');

  useEffect(() => {
    // Incubating users get asked too. They were skipped entirely, because this
    // reads interests off a Hive account they do not have -- so the people who
    // most need a feed worth scrolling were the only ones never offered one.
    if (!authenticated || !who || wasPrompted(who)) return;
    if (promptsActive) return;
    let alive = true;
    // Small delay so we don't collide with the login flow / other modals.
    const t = setTimeout(async () => {
      const server = incubationHandle
        ? await fetchMyIncubationProfile().then((d) => d.interests || []).catch(() => null)
        : await fetchUserInterests(user);
      if (!alive) return;
      if (server == null) return;      // couldn't read Hive — try again next session
      if (server.length > 0) {         // already has interests — remember + don't ask
        // Loading them into the store is the point even when we do not ask: it
        // is what biases the feed, and for an incubating user nothing else
        // would ever put them there.
        setInterests(server);
        markPrompted(who);
        return;
      }
      setSelected([]);
      // Claim the slot in the same tick we decide to open, so a prompt still
      // making up its mind cannot open underneath this one.
      setPromptActive('interests', true);
      setOpen(true);
    }, 1200);
    return () => { alive = false; clearTimeout(t); };
  }, [authenticated, user, incubationHandle, promptsActive]);

  // Release the slot however this unmounts, so a prompt waiting on it is not
  // left waiting forever by a route change mid-decision.
  useEffect(() => () => setPromptActive('interests', false), []);

  if (!open) return null;

  // Two ways out, and they mean different things.
  //
  // "Not now" is an answer: they were asked and declined, so we stop asking.
  // Clicking the backdrop is not -- it is how people close a thing that
  // appeared over what they were doing, and treating it as a refusal meant one
  // stray click cost them a personalised feed permanently, with no way back
  // except finding Settings.
  const close = () => {
    setOpen(false);
    setPromptActive('interests', false);
  };

  const decline = () => {
    if (who) markPrompted(who);
    close();
  };

  const save = async () => {
    setSaving(true);
    try {
      // Off-chain for someone with no account to write metadata onto. They
      // travel to the chain at graduation, into the same 3speak namespace this
      // reads from (see the incubation service's profile op).
      let list;
      if (incubationHandle) {
        const mine = await fetchMyIncubationProfile();
        await saveIncubationProfile(mine.profile || {}, selected);
        list = selected;
      } else {
        list = await saveInterestsToHive(user, selected);
      }
      setInterests(list);
      if (who) markPrompted(who);
      toast.success('Interests saved — change them anytime in Settings');
      setOpen(false);
      setPromptActive('interests', false);
      // Refetch the home feeds in place (no page reload) so they immediately
      // reflect the new interests. Runs after setInterests so the feed params
      // read the fresh list from the store.
      refreshHomeFeeds(queryClient, { authenticated, user });
    } catch (e) {
      toast.error(e?.message || 'Could not save interests');
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="interests-prompt-overlay" onClick={close}>
      <div className="interests-prompt" onClick={(e) => e.stopPropagation()}>
        <h3 className="interests-prompt-title">What are you into?</h3>
        <p className="interests-prompt-text">
          Pick a few topics you enjoy and we’ll show you more of the content you like.
          You can change these anytime in <strong>Settings</strong>.
        </p>
        {/* Same picker (and search box) as Settings → Interests, so the two
            screens look and behave identically. Values are topic slugs. */}
        <TagsV2Picker
          multi
          searchable
          value={selected}
          onChange={setSelected}
          disabled={saving}
        />
        <div className="interests-prompt-actions">
          <button type="button" className="interests-prompt-cancel" onClick={decline} disabled={saving}>
            Not now
          </button>
          <button
            type="button"
            className="interests-prompt-save"
            onClick={save}
            disabled={saving || selected.length === 0}
          >
            {saving ? 'Saving…' : 'Save interests'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
