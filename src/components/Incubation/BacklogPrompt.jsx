import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { MdUploadFile } from 'react-icons/md';
import { useAppStore } from '../../lib/store';
import { usePromptsActive, setPromptActive } from '../../utils/welcomeGate';
import { fetchBackfillSummary } from '../../lib/incubation';
import '../AdsPrompt/AdsPrompt.scss';

const SNOOZE_KEY = 'backlog_prompt_snoozed_until';
const SNOOZE_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Tells a newly graduated user that the things they made earlier are still
 * sitting on 3Speak, and where to publish them.
 *
 * Without this the backlog is invisible: it lives on a page nothing links to,
 * and the user has no reason to suspect their old posts are anywhere at all.
 * It offers the page and never publishes anything itself, because what goes on
 * someone's permanent public record is their choice item by item.
 */
export default function BacklogPrompt() {
  const user = useAppStore((s) => s.user);
  const authenticated = useAppStore((s) => s.authenticated);
  const navigate = useNavigate();
  const { pathname } = useLocation();

  // Never on the page it points at, and not while they are mid-upload.
  const onBusyPage = /^\/(publish-backlog|upload|studio)/i.test(String(pathname || ''));
  const promptsActive = usePromptsActive('backlog');

  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    if (!authenticated || !user || onBusyPage || promptsActive) return undefined;
    let snoozed = 0;
    try { snoozed = Number(localStorage.getItem(SNOOZE_KEY)) || 0; } catch { /* ignore */ }
    if (Date.now() < snoozed) return undefined;

    let alive = true;
    fetchBackfillSummary()
      .then(s => {
        if (!alive) return;
        if (s?.pending > 0) {
          setSummary(s);
          setOpen(true);
          setPromptActive('backlog', true);
        }
      })
      // A 409 here is the ordinary case, not an error: it means this user never
      // incubated, which is true of almost everyone.
      .catch(() => { /* nothing to offer */ });
    return () => { alive = false; };
  }, [authenticated, user, onBusyPage, promptsActive]);

  function close() {
    try { localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS)); } catch { /* ignore */ }
    setOpen(false);
    setPromptActive('backlog', false);
  }

  if (!open || !summary) return null;
  const n = summary.pending;

  return (
    <div className="ads-prompt-overlay">
      <div className="ads-prompt" role="dialog" aria-modal="true" aria-labelledby="backlog-title">
        <header className="ads-prompt-head">
          <MdUploadFile className="ads-prompt-head-icon" aria-hidden="true" />
          <div>
            <h3 className="ads-prompt-title" id="backlog-title">
              Your earlier posts are still here
            </h3>
            <p className="ads-prompt-lede">
              You made <strong>{n} {n === 1 ? 'thing' : 'things'}</strong> before you had a
              Hive account. They live on 3Speak only. You can put them on Hive as
              <strong> @{user}</strong> whenever you like.
            </p>
          </div>
        </header>

        <p className="ads-prompt-text">
          You pick what goes across, one by one. Anything you leave stays on 3Speak
          exactly as it is, and you can come back to the rest any time.
        </p>

        <div className="ads-prompt-actions">
          <button type="button" className="ads-prompt-ghost" onClick={close}>Later</button>
          <button
            type="button"
            className="ads-prompt-primary"
            onClick={() => { close(); navigate('/publish-backlog'); }}
          >
            Take a look
          </button>
        </div>
      </div>
    </div>
  );
}
