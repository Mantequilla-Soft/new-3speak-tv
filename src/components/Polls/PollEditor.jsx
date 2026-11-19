import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Segmented } from '../v2/ui';
import { Icon } from '../v2/Icon';
import { POLL_MIN_OPTIONS, POLL_MAX_OPTIONS, POLL_OPTION_MAX_LEN, POLL_DURATIONS } from '../../lib/polls';
import './PollCard.scss';

/**
 * The small poll button of a composer (a snap, a comment, a video's details):
 * shows or hides the poll editor under the text. Icon only, its name in the
 * tooltip; lit while a poll is on.
 */
export function PollToggle({ on, onToggle, className = '' }) {
  const { t } = useTranslation();
  const label = on ? t('social.polls.removePollTitle') : t('social.polls.addPollTitle');
  return (
    <button
      type="button"
      className={`poll-toggle${on ? ' is-on' : ''} ${className}`.trim()}
      aria-pressed={on}
      aria-label={label}
      title={label}
      onClick={onToggle}
    >
      <Icon name="poll" size={20} />
    </button>
  );
}

/**
 * A poll's options (2 to 4, each with a remove x), "Add option" and when it
 * ends, under a composer (lib/polls.js buildPollMeta makes the poll of them).
 * With `onQuestion` it asks the question too: a video has no text that is the
 * question, while a snap's or comment's text is.
 */
export default function PollEditor({ options, onOptions, days, onDays, question, onQuestion }) {
  const { t } = useTranslation();
  const qId = useId();
  const setOption = (i, v) => onOptions(options.map((o, j) => (j === i ? v : o)));
  return (
    <div className="snap-poll-editor" role="group" aria-label={t('social.polls.editorAria')}>
      {onQuestion && (
        <div className="poll-editor-field">
          <label className="poll-editor-label" htmlFor={qId}>{t('social.polls.question')}</label>
          <input
            id={qId}
            className="v2-input"
            value={question}
            maxLength={200}
            placeholder={t('social.polls.questionPlaceholderVideo')}
            onChange={(e) => onQuestion(e.target.value)}
          />
        </div>
      )}
      {options.map((o, i) => (
        <div key={i} className="snap-poll-option">
          <input
            className="v2-input"
            value={o}
            maxLength={POLL_OPTION_MAX_LEN}
            placeholder={t('social.polls.optionPlaceholder', { n: i + 1 })}
            aria-label={t('social.polls.optionPlaceholder', { n: i + 1 })}
            onChange={(e) => setOption(i, e.target.value)}
          />
          {options.length > POLL_MIN_OPTIONS && (
            <button type="button" className="snap-poll-remove" onClick={() => onOptions(options.filter((_, j) => j !== i))} aria-label={t('social.polls.removeOption', { n: i + 1 })}>
              <Icon name="close" size={16} />
            </button>
          )}
        </div>
      ))}
      {options.length < POLL_MAX_OPTIONS && (
        <Button variant="ghost" size={32} icon="add" onClick={() => onOptions([...options, ''])}>
          {t('social.polls.addOption')}
        </Button>
      )}
      <div className="poll-editor-field">
        <span className="poll-editor-label">{t('social.polls.duration')}</span>
        <Segmented
          label={t('social.polls.duration')}
          value={days}
          onChange={onDays}
          options={POLL_DURATIONS.map((d) => ({ value: d, label: t('social.polls.days', { count: d }) }))}
        />
      </div>
    </div>
  );
}
