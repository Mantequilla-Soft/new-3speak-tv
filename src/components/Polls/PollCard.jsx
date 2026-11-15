import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../lib/store';
import { usePoll, isPollClosed, percents } from '../../lib/polls';
import { Icon } from '../v2/Icon';
import { toastIn } from '../../utils/toast';
import './PollCard.scss';

const toast = toastIn('Post');

// "Ends in 3 days" / "Ends in 5 hours" / "No end date".
function endsLabel(endsAt, t) {
  if (!endsAt) return t('social.polls.noEnd');
  const ms = new Date(endsAt).getTime() - Date.now();
  if (ms > 36 * 3600000) return t('social.polls.endsInDays', { count: Math.round(ms / 86400000) });
  return t('social.polls.endsInHours', { count: Math.max(1, Math.ceil(ms / 3600000)) });
}

/**
 * The options of a poll snap (lib/polls.js), under the snap's question, on the
 * channel's Community tab and in the feeds. Before voting: one button per
 * option. After voting, after the end, or for the poll's author: the results as
 * bars, the viewer's own choice marked; tapping another option moves the vote
 * until the poll ends. Signed out: the results, and a hint to sign in.
 */
export default function PollCard({ snap }) {
  const { t } = useTranslation();
  const user = useAppStore((s) => s.user);
  const authenticated = useAppStore((s) => s.authenticated);
  const me = authenticated ? user : null;
  const { result, vote } = usePoll(snap, me);
  const [busy, setBusy] = useState(false);
  const poll = snap.poll;
  if (!poll?.options?.length) return null;

  const closed = result?.closed ?? isPollClosed(poll);
  const mine = result?.mine ?? null;
  const counts = result?.counts || poll.options.map(() => 0);
  const total = result?.total ?? 0;
  const pct = percents(counts);
  const isAuthor = me && me === snap.owner;
  const showResults = closed || mine !== null || isAuthor || !me;

  const choose = async (i) => {
    if (!me) { toast.error(t('social.polls.signIn')); return; }
    if (closed || busy || i === mine) return;
    setBusy(true);
    try {
      await vote(i);
    } catch (err) {
      toast.error(err?.code === 'closed' ? t('social.polls.closedToast') : t('social.polls.voteFailed'));
    } finally {
      setBusy(false);
    }
  };

  const status = closed ? t('social.polls.closed') : endsLabel(poll.ends_at, t);

  return (
    <div className={`poll-card${showResults ? ' poll-card--results' : ''}`} role="group" aria-label={t('social.polls.aria')}>
      <ul className="poll-options">
        {poll.options.map((label, i) => (
          <li key={i}>
            <button
              type="button"
              className={`poll-option${i === mine ? ' is-mine' : ''}`}
              onClick={() => choose(i)}
              disabled={busy || closed}
              aria-pressed={i === mine}
            >
              {showResults && <span className="poll-option-bar" style={{ width: `${pct[i]}%` }} aria-hidden="true" />}
              <span className="poll-option-label">
                {i === mine && <Icon name="check_circle" size={16} fill />}
                {label}
              </span>
              {showResults && <span className="poll-option-pct num">{pct[i]}%</span>}
            </button>
          </li>
        ))}
      </ul>
      <div className="poll-meta">
        <Icon name="how_to_vote" size={14} />
        <span>{t('social.polls.votes', { count: total })}</span>
        <span aria-hidden="true">·</span>
        <span>{status}</span>
        {mine !== null && !closed && <span className="poll-meta-hint">{t('social.polls.changeHint')}</span>}
      </div>
    </div>
  );
}
