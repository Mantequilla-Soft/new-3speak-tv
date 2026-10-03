import React from "react";
import "./NotFound.scss"
import image from "../assets/image/404.png";
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

function NotFound() {
  const { t } = useTranslation();
  return (
    <div className="not-found-container">
      <img src={image} alt={t('pages.notFound.imageAlt')} />
      <p>{t('pages.notFound.title')}</p>
      <h3>{t('pages.notFound.message')}</h3>
      <Link to="/">
        <button>{t('pages.notFound.goHome')}</button>
      </Link>
    </div>
  );
}

export default NotFound;
