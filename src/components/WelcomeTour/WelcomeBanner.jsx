import { useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation, Trans } from 'react-i18next';
import { MdClose, MdExplore, MdGroups, MdLock, MdDiversity3, MdPayments, MdPlayCircle } from 'react-icons/md';
import { useAppStore } from '../../lib/store';
import { markWelcomeDone, resetWelcome, startWelcomeTour, useWelcomeDone } from './welcomeState';
import mark from '../../assets/image/3S_mark.svg';
import './WelcomeBanner.scss';

// Top of the home page, for logged-out visitors. Stays until they close it with
// the X (a reload keeps it); logged-in users never see it. /?welcome=1 brings it
// back after closing, for testing.
export default function WelcomeBanner() {
  const { t } = useTranslation();
  const { authenticated, authChecked } = useAppStore();
  const done = useWelcomeDone();
  const [params, setParams] = useSearchParams();
  const replay = params.get('welcome') === '1';

  // Clear the flag once, then drop the parameter so the X works again.
  useEffect(() => {
    if (!replay) return;
    resetWelcome();
    setParams((p) => { p.delete('welcome'); return p; }, { replace: true });
  }, [replay, setParams]);

  // Wait for the stored session: a logged-in reload would flash it otherwise.
  if (!authChecked || authenticated || done) return null;

  return (
    <section className="welcome-banner" aria-labelledby="welcome-banner-title">
      <img className="welcome-banner-mark" src={mark} alt="" aria-hidden="true" />
      <div className="welcome-banner-body">
        <h2 id="welcome-banner-title">{t('welcome.banner.title')}</h2>
        {/* What 3Speak is, one short line each: why it exists, who runs it, who
            earns, and what we never do with your data. Phones too, smaller. */}
        <ul className="welcome-banner-points">
          <li><MdDiversity3 aria-hidden="true" /><span><Trans i18nKey="welcome.banner.points.alternative" components={{ b: <strong /> }} /></span></li>
          <li><MdGroups aria-hidden="true" /><span><Trans i18nKey="welcome.banner.points.community" components={{ b: <strong /> }} /></span></li>
          <li><MdPayments aria-hidden="true" /><span><Trans i18nKey="welcome.banner.points.creatorsEarn" components={{ b: <strong /> }} /></span></li>
          <li><MdPlayCircle aria-hidden="true" /><span><Trans i18nKey="welcome.banner.points.viewersEarn" components={{ b: <strong /> }} /></span></li>
          <li><MdLock aria-hidden="true" /><span><Trans i18nKey="welcome.banner.points.data" components={{ b: <strong /> }} /></span></li>
        </ul>
        {/* The sign-off, under everything else. */}
        <p className="welcome-banner-lead">{t('welcome.banner.lead')}</p>
      </div>
      <div className="welcome-banner-actions">
        <button type="button" className="welcome-banner-btn welcome-banner-btn--primary" onClick={startWelcomeTour}>
          <MdExplore aria-hidden="true" />
          <span className="welcome-banner-label--long">{t('welcome.banner.tour')}</span>
          <span className="welcome-banner-label--short">{t('welcome.banner.tourShort')}</span>
        </button>
        <Link to="/faq" className="welcome-banner-btn">{t('welcome.banner.faq')}</Link>
      </div>
      <button
        type="button"
        className="welcome-banner-close"
        onClick={markWelcomeDone}
        aria-label={t('welcome.banner.close')}
        title={t('welcome.banner.close')}
      >
        <MdClose />
      </button>
    </section>
  );
}
