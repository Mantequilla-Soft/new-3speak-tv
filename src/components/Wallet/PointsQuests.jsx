import { useTranslation } from 'react-i18next';
import { Icon, Progress } from '../v2/ui';
import { cx } from '../v2/helpers';
import { formatNumber } from '../../i18n';
import { usePointsQuests } from './channelPoints';
import { questTitle } from './pointsEarn';
import './PointsCard.scss';

/**
 * The signed-in account's weekly quests in the wallet (hangouts GET
 * /points/quests?user=): a progress bar each, a check and the points once done.
 * The live server names each quest's title as an i18n key (`title_key`); a key
 * the app does not have reads as a generic "Weekly quest". Nothing shows
 * without quests (an older server, a failure, an empty week).
 */
export default function PointsQuests({ user }) {
  const { t, i18n } = useTranslation();
  const data = usePointsQuests(user);
  if (!data || !data.quests.length) return null;

  return (
    <div className="wallet-v2__card points-quests">
      <div className="wallet-v2__card-head">
        <b>{t('wallet.points.questsPanel.title')}</b>
      </div>
      <div className="wallet-v2__card-sub">{t('wallet.points.questsPanel.sub')}</div>
      <ul className="points-quests__list">
        {data.quests.map((q) => {
          const title = questTitle(t, i18n, q);
          const shown = Math.min(q.progress, q.target);
          return (
            <li key={q.id} className={cx('points-quests__row', q.done && 'is-done')}>
              <div className="points-quests__line">
                {q.done && <Icon name="check_circle" size={18} fill className="points-quests__check" />}
                <span className="points-quests__title">{title}</span>
                {q.points > 0 && <span className="points-quests__pts num">+{formatNumber(q.points)}</span>}
              </div>
              <Progress value={q.done ? 100 : (shown / q.target) * 100} tone="cyan" thin label={title} />
              <span className="points-quests__count num">
                {q.done
                  ? t('wallet.points.questsPanel.done')
                  : t('wallet.points.questsPanel.progress', { n: formatNumber(shown), target: formatNumber(q.target) })}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
