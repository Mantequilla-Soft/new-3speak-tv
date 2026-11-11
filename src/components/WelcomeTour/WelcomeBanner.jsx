import { useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation, Trans } from 'react-i18next';
import { useAppStore } from '../../lib/store';
import { markWelcomeDone, resetWelcome, startWelcomeTour, useWelcomeDone } from './welcomeState';
import mark from '../../assets/image/3S_mark.svg';
import { Button, Icon, IconButton } from '../v2/ui';
import './WelcomeBanner.scss';

// What 3Speak is, one short line each (design 33d): why it exists, who runs it,
// who earns, and what we never do with your data. Icons alternate accent
// (money, the platform) and cyan (community, viewers).
const POINTS = [
  { key: 'alternative', icon: 'public', tone: 'accent' },
  { key: 'community', icon: 'groups', tone: 'cyan' },
  { key: 'creatorsEarn', icon: 'payments', tone: 'accent' },
  { key: 'viewersEarn', icon: 'visibility', tone: 'cyan' },
  { key: 'data', icon: 'lock', tone: 'accent' },
];

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
    // The §11 success card with its accent hero tint (design 33d).
    <section className="welcome-banner v2-success is-accent" aria-labelledby="welcome-banner-title">
      <div className="welcome-banner-head">
        <img className="welcome-banner-mark" src={mark} alt="" aria-hidden="true" />
        <div className="welcome-banner-titles">
          <h2 id="welcome-banner-title">{t('welcome.banner.title')}</h2>
          <p className="welcome-banner-lead">{t('welcome.banner.lead')}</p>
        </div>
        <IconButton
          icon="close"
          label={t('welcome.banner.close')}
          variant="ghost"
          size={36}
          round
          className="welcome-banner-close"
          onClick={markWelcomeDone}
        />
      </div>
      <ul className="welcome-banner-points">
        {POINTS.map(({ key, icon, tone }) => (
          <li key={key}>
            <Icon name={icon} size={18} className={`is-${tone}`} />
            <span><Trans i18nKey={`welcome.banner.points.${key}`} components={{ b: <strong /> }} /></span>
          </li>
        ))}
      </ul>
      <div className="welcome-banner-actions">
        <Button variant="primary" size={48} trailing="explore" className="welcome-banner-btn welcome-banner-btn--primary" onClick={startWelcomeTour}>
          <span className="welcome-banner-label--long">{t('welcome.banner.tour')}</span>
          <span className="welcome-banner-label--short">{t('welcome.banner.tourShort')}</span>
        </Button>
        <Button as={Link} to="/faq" variant="secondary" size={48} trailing="help" className="welcome-banner-btn">
          {t('welcome.banner.faq')}
        </Button>
      </div>
    </section>
  );
}
