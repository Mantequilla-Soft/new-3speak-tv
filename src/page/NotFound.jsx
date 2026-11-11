import "./NotFound.scss"
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Helmet } from 'react-helmet-async';
import { Icon } from '../components/v2/Icon';

// 404 (design 26d): one card, the big accent "404", what happened, and the one
// way forward.
function NotFound() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <div className="not-found-container">
      {/* Unknown URLs answer 200: the server cannot tell them from real routes, since
          the catch-all also turns Hive-style links (/@author/permlink, /hive-123/...)
          into 3Speak pages. So the page itself tells search engines not to index it
          (Google renders the page and honours this). Issue #505. */}
      <Helmet>
        <meta name="robots" content="noindex" />
      </Helmet>
      <div className="not-found-card">
        <div className="not-found-code" role="img" aria-label={t('pages.notFound.imageAlt')}>404</div>
        <p className="not-found-eyebrow">{t('pages.notFound.title')}</p>
        <h3>{t('pages.notFound.message')}</h3>
        {/* One control: a <button> inside a <Link> was two tab stops for one action. */}
        <div className="not-found-actions">
          <button type="button" className="v2-btn v2-btn--inverse h48 is-block is-next" onClick={() => navigate('/')}>
            <span className="v2-btn__label">{t('pages.notFound.goHome')}</span>
            <Icon name="home" size={20} />
          </button>
          <button type="button" className="v2-btn v2-btn--secondary h48 is-block is-next" onClick={() => navigate('/discover')}>
            <span className="v2-btn__label">{t('common.actions.search')}</span>
            <Icon name="search" size={20} />
          </button>
        </div>
      </div>
    </div>
  );
}

export default NotFound;
