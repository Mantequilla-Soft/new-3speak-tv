import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import { MdExplore, MdHelpOutline, MdLink } from 'react-icons/md';
import { useAppStore } from '../lib/store';
import { openpodsEnabledFor, VIDEO_IMPORT_ENABLED, SHORTS_MAX_DURATION_SEC } from '../utils/config';
import { toastIn } from '../utils/toast';
import { startWelcomeTour } from '../components/WelcomeTour/welcomeState';
import './Faq.scss';

const toast = toastIn('3Speak');

// Order on the page. Each id is also the item's key in locales/<lang>/faq.json
// and its #anchor, so a question can be linked to directly (/faq#ai).
const GROUPS = [
  { id: 'start', items: ['what', 'tour', 'watchFree', 'signup', 'hive', 'loginTypes', 'lostKeys'] },
  { id: 'earning', items: ['creatorsEarn', 'viewersEarn', 'tokens', 'vpRc'] },
  // 'import' (YouTube/TikTok) and 'live' are hidden for now; their strings stay in faq.json.
  { id: 'uploading', items: ['formats', 'edit', 'processing'] },
  { id: 'community', items: ['communities', 'report', 'nsfw', 'ai', 'deleteVideos', 'myData', 'deleteData'] },
  { id: 'more', items: ['advertise', 'install', 'languages', 'help'] },
];

const external = (href) => <a href={href} target="_blank" rel="noopener noreferrer" />;

// Every tag an answer may use. Translators can only use tag names the English
// text has (src/i18n/rules.js), so this list covers every language.
const TAGS = {
  b: <b />,
  discord: external('https://discord.com/invite/NSFS2VGj83'),
  telegram: external('https://t.me/threespeak'),
  x: external('https://x.com/3speaktv'),
  importLink: <Link to="/youtube-import" />,
  advertiseLink: <Link to="/advertise" />,
  aboutLink: <Link to="/about" />,
  // Starts the guided tour (it moves to the home page first).
  tourLink: <button type="button" className="faq-inline-link" onClick={startWelcomeTour} />,
};

export default function Faq() {
  const { t } = useTranslation();
  const { user } = useAppStore();
  const { hash } = useLocation();

  // Features that are not open everywhere answer "coming soon" instead of
  // pointing at a button the visitor cannot see.
  const answerKey = (id) => {
    if (id === 'import' && !VIDEO_IMPORT_ENABLED) return 'aSoon';
    if (id === 'live' && !openpodsEnabledFor(user)) return 'aSoon';
    return 'a';
  };

  // A link to one question opens it and scrolls there.
  useEffect(() => {
    const id = decodeURIComponent(hash.replace(/^#/, ''));
    if (!id) return;
    const el = document.getElementById(`faq-${id}`);
    if (!el) return;
    el.open = true;
    el.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [hash]);

  const copyLink = (id) => {
    const url = `${window.location.origin}/faq#${id}`;
    navigator.clipboard?.writeText(url)
      .then(() => toast.success(t('faq.linkCopied')))
      .catch(() => {});
  };

  return (
    <div className="faq-page">
      <header className="faq-header">
        <MdHelpOutline className="faq-header-icon" aria-hidden="true" />
        <div>
          <h1>{t('faq.title')}</h1>
          <p>{t('faq.subtitle')}</p>
        </div>
        <button type="button" className="faq-tour-btn" onClick={startWelcomeTour}>
          <MdExplore aria-hidden="true" /> {t('welcome.banner.tour')}
        </button>
      </header>

      {GROUPS.map((group) => (
        <section key={group.id} className="faq-group" aria-labelledby={`faq-group-${group.id}`}>
          <h2 id={`faq-group-${group.id}`}>{t(`faq.groups.${group.id}`)}</h2>
          {group.items.map((id) => (
            <details key={id} id={`faq-${id}`} className="faq-item">
              <summary>
                <span className="faq-q">{t(`faq.items.${id}.q`)}</span>
              </summary>
              <div className="faq-a">
                <p>
                  <Trans
                    i18nKey={`faq.items.${id}.${answerKey(id)}`}
                    values={{ shortMinutes: Math.round(SHORTS_MAX_DURATION_SEC / 60) }}
                    components={TAGS}
                  />
                </p>
                <button type="button" className="faq-copy" onClick={() => copyLink(id)} title={t('faq.copyLink')} aria-label={t('faq.copyLink')}>
                  <MdLink />
                </button>
              </div>
            </details>
          ))}
        </section>
      ))}

      <section className="faq-more">
        <h2>{t('faq.more.title')}</h2>
        <p><Trans i18nKey="faq.more.text" components={TAGS} /></p>
      </section>
    </div>
  );
}
