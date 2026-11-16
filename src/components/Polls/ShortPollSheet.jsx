import { useTranslation } from 'react-i18next';
import DialogShell from '../modal/DialogShell';
import PollCard from './PollCard';

/** A Short's poll in a sheet (ShortPollPill): the question as its title. */
export default function ShortPollSheet({ author, permlink, poll, question, onClose }) {
  const { t } = useTranslation();
  return (
    <DialogShell open onClose={onClose} title={question || t('social.polls.aria')} width={440} isolate className="short-poll-sheet">
      <PollCard snap={{ owner: author, permlink, poll }} />
    </DialogShell>
  );
}
