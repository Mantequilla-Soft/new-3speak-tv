import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import BarLoader from '../components/Loader/BarLoader';
import { Button, EmptyState, StatTile, StatusPill } from '../components/v2/ui';
import { useAppStore } from '../lib/store';
import { useCuration, pickLink } from '../lib/curation';
import { fixVideoThumbnail, fallbackImg } from '../utils/fixThumbnails';
import { formatNumber, formatTimeAgo } from '../i18n';
import './WatchedView.scss';
import './Curation.scss';

const hp = (n) => formatNumber(Number(n) || 0, { minimumFractionDigits: 3, maximumFractionDigits: 3 });

/**
 * The curator page, /curation/:user: what someone voted for on 3Speak lately, the
 * curation rewards those votes paid, and "found it early" badges (rules from the
 * checker's GET /curation/:user, routes/curation.js). The rows reuse the watch
 * history's layout (WatchedView.scss).
 */
export default function Curation() {
  const { t } = useTranslation();
  const { user: param } = useParams();
  const user = String(param || '').replace(/^@/, '').toLowerCase();
  const navigate = useNavigate();
  const me = useAppStore((s) => s.user);
  const { data } = useCuration(user);
  const days = data?.days || 30;

  return (
    <div className="watched-view-container curation-page">
      <div className="watched-header">
        <div className="watched-info">
          <span className="watched-bar" aria-hidden="true" />
          <div className="watched-details">
            <h1>{t('curation.page.title')}</h1>
            <div className="watched-meta">
              <Link to={`/@${user}`} className="owner">@{user}</Link>
              <span className="separator" aria-hidden="true">·</span>
              <span>{me === user ? t('curation.page.sub', { days }) : t('curation.page.subOther', { days })}</span>
            </div>
          </div>
        </div>
        <div className="header-actions">
          <Button className="back-btn" icon="arrow_back" size={36} onClick={() => navigate(-1)}>{t('common.actions.back')}</Button>
        </div>
      </div>
      <CurationView user={user} />
    </div>
  );
}

/**
 * The curator's picks, totals and rules without the page around them: the
 * body of /curation/:user and of the profiles' Curation tab.
 */
export function CurationView({ user, withSub = false }) {
  const { t } = useTranslation();
  const me = useAppStore((s) => s.user);
  const { data, isLoading, isError } = useCuration(user);
  const days = data?.days || 30;
  const picks = data?.picks || [];

  return (
    <>
      {withSub && (
        <p className="curation-page__sub">{me === user ? t('curation.page.sub', { days }) : t('curation.page.subOther', { days })}</p>
      )}
      {isLoading ? (
        <div className="loading-more"><BarLoader /></div>
      ) : isError ? (
        <div className="empty-wrap"><div className="v2-failure" role="alert"><b>{t('curation.page.loadFailed')}</b></div></div>
      ) : (
        <>
          <section className="curation-page__stats">
            <StatTile label={t('curation.page.picks')} value={formatNumber(data?.totals?.picks || 0)} />
            <StatTile label={t('curation.page.earned')} value={t('curation.page.earnedValue', { hp: hp(data?.totals?.earnedHp) })} />
            <StatTile label={t('curation.page.early')} value={formatNumber(data?.totals?.early || 0)} />
          </section>

          {picks.length === 0 ? (
            <div className="empty-wrap"><EmptyState icon="how_to_vote" title={t('curation.page.empty')} /></div>
          ) : (
            <ul className="watched-list curation-page__list">
              {picks.map((p) => (
                <li key={`${p.author}/${p.permlink}`} className="watched-row">
                  <Link className="watched-row__main" to={pickLink(p)}>
                    <span className={`watched-row__thumb${p.kind === 'short' ? ' is-short' : ''}`}>
                      <img
                        src={p.thumbnail ? fixVideoThumbnail({ thumbnail_url: p.thumbnail }) : fallbackImg}
                        alt=""
                        loading="lazy"
                        onError={(e) => { e.currentTarget.src = fallbackImg; }}
                      />
                    </span>
                    <span className="watched-row__text">
                      <b>{p.title || p.permlink}</b>
                      <span>
                        @{p.author}
                        {p.votedAt && ` · ${t('curation.page.votedAt', { when: formatTimeAgo(p.votedAt) })}`}
                        {p.percent != null && ` · ${t('curation.page.weight', { weight: formatNumber(p.percent, { maximumFractionDigits: 0 }) })}`}
                        {p.rank && ` · ${t('curation.page.rank', { rank: p.rank, votes: p.votes })}`}
                      </span>
                    </span>
                  </Link>
                  <span className="curation-page__right">
                    {p.early && <StatusPill tone="cyan" icon="emoji_events" caps={false}>{t('curation.page.badge')}</StatusPill>}
                    <span className={p.curationHp > 0 ? 'curation-page__hp money' : 'curation-page__hp is-pending'}>
                      {p.curationHp > 0 ? t('curation.page.reward', { hp: hp(p.curationHp) }) : t('curation.page.pending')}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}

          <p className="curation-page__note">
            {t('curation.page.note')}{' '}
            {data?.rules && t('curation.page.rule', { share: Math.round(data.rules.earlyShare * 100), votes: data.rules.earlyMinVotes })}
          </p>
        </>
      )}
    </>
  );
}
