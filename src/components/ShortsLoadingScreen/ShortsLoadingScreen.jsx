import mark from '../../assets/image/3S_mark.svg';
import './ShortsLoadingScreen.scss';
import { useTranslation } from 'react-i18next';

/**
 * The Shorts loading screen (29d): the player's black with a faint accent glow,
 * and flush left at the bottom the 3Speak mark, "Shorts", a three-step bar that
 * runs while it waits, and "Loading shorts...". White on black in both themes.
 *
 * Desktop: a 9:16 frame where the player will be. Phones: the whole screen.
 *
 * @param {boolean} overlay - render as an absolute overlay inside the player
 *   (.videoContainer) until the first short is ready
 */
const ShortsLoadingScreen = ({ overlay = false }) => {
  const { t } = useTranslation();
  return (
    <div className={`shorts-loading-screen${overlay ? ' shorts-loading-screen--overlay' : ''}`} role="status" aria-live="polite">
      <div className="shorts-loading-screen__frame">
        <img className="shorts-loading-screen__logo" src={mark} alt="" />
        <b className="shorts-loading-screen__title">{t('nav.search.types.shorts')}</b>
        <div className="shorts-loading-screen__bar" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <p className="shorts-loading-screen__text">{t('shorts.loading')}</p>
      </div>
    </div>
  );
};

export default ShortsLoadingScreen;
