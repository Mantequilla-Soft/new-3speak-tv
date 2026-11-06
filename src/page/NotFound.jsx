import React from "react";
import "./NotFound.scss"
import image from "../assets/image/404.png";
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Helmet } from 'react-helmet-async';

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
      <img src={image} alt={t('pages.notFound.imageAlt')} />
      <p>{t('pages.notFound.title')}</p>
      <h3>{t('pages.notFound.message')}</h3>
      {/* One control: a <button> inside a <Link> was two tab stops for one action. */}
      <button type="button" onClick={() => navigate('/')}>{t('pages.notFound.goHome')}</button>
    </div>
  );
}

export default NotFound;
