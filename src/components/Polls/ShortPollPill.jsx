import { lazy, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../v2/Icon';
import MountWhenOpened from '../common/LazyMount';
import './PollCard.scss';

const ShortPollSheet = lazy(() => import('./ShortPollSheet'));

/**
 * On a Short with a poll (lib/polls.js useShortPolls): a small "Poll" pill over
 * the video that opens the poll in a sheet, so the poll never covers the Short.
 */
export default function ShortPollPill({ author, permlink, poll, question }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const stop = (e) => e.stopPropagation();
  return (
    <div className="short-poll" onClick={stop}>
      <button type="button" className="btn-reset short-poll__pill" aria-haspopup="dialog" onClick={(e) => { stop(e); setOpen(true); }}>
        <Icon name="poll" size={16} />
        <span className="short-poll__text">{question || t('social.polls.aria')}</span>
      </button>
      <MountWhenOpened when={open} name="short-poll">
        {open && <ShortPollSheet author={author} permlink={permlink} poll={poll} question={question} onClose={() => setOpen(false)} />}
      </MountWhenOpened>
    </div>
  );
}
