import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useCreatorPolls, percents } from '../../lib/polls';
import './CreatorPollsCard.scss';

/**
 * Creator stats: the creator's polls (lib/polls.js) with their results, newest
 * first, drawn with the stats page's own bars (`cs-bar*`, CreatorStats.scss).
 * Nothing when the creator has never run a poll.
 */
export default function CreatorPollsCard({ username }) {
  const { t } = useTranslation();
  const { data: polls = [] } = useCreatorPolls(username);
  if (!polls.length) return null;

  return (
    <section className="cs-card cs-polls">
      <h3 className="cs-card-title is-sm">{t('social.polls.statsTitle')}</h3>
      <div className="cs-polls-list">
        {polls.map((p) => {
          const pct = percents(p.counts);
          const lead = p.total ? p.counts.indexOf(Math.max(...p.counts)) : -1;
          return (
            <div key={p.key} className="cs-poll">
              <Link className="cs-poll-q" to={`/@${username}?tab=community`}>{p.question || p.permlink}</Link>
              <span className="cs-poll-sub">
                {t('social.polls.votes', { count: p.total })} · {p.closed ? t('social.polls.closed') : t('social.polls.open')}
              </span>
              <div className="cs-bars">
                {p.options.map((o, i) => (
                  <div className="cs-bar" key={i}>
                    <div className="cs-bar-row">
                      <span className="cs-bar-label">{o}</span>
                      <b className="cs-bar-val" title={String(p.counts[i])}>{pct[i]}%</b>
                    </div>
                    <span className="cs-bar-track"><span className={`cs-bar-fill${i === lead ? ' is-cyan' : ''}`} style={{ width: `${pct[i]}%` }} /></span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
