import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import { useAppStore } from '../lib/store';
import { openpodsEnabledFor, VIDEO_IMPORT_ENABLED, SHORTS_MAX_DURATION_SEC } from '../utils/config';
import { toastIn } from '../utils/toast';
import { startWelcomeTour } from '../components/WelcomeTour/welcomeState';
import { Button, Icon, IconButton } from '../components/v2/ui';
import { cx } from '../components/v2/helpers';
import './Faq.scss';

const toast = toastIn('3Speak');

// Order on the page. Each id is also the item's key in locales/<lang>/faq.json
// and its #anchor, so a question can be linked to directly (/faq#ai).
const GROUPS = [
  { id: 'start', items: ['what', 'watchFree', 'signup', 'hive', 'loginTypes', 'lostKeys'] },
  { id: 'earning', items: ['creatorsEarn', 'viewersEarn', 'tokens', 'vpRc'] },
  // 'import' (YouTube/TikTok) and 'live' are hidden for now; their strings stay in faq.json.
  { id: 'uploading', items: ['formats', 'edit', 'processing'] },
  { id: 'community', items: ['talk', 'notAllowed', 'communities', 'report', 'nsfw', 'ai', 'deleteVideos', 'myData', 'deleteData'] },
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
};

export default function Faq() {
  const { t } = useTranslation();
  const { user } = useAppStore();
  const { hash } = useLocation();
  const [activeGroup, setActiveGroup] = useState(GROUPS[0].id);

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

  // The group list follows the reader: the group nearest the top is marked.
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return undefined;
    const inView = new Set();
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => (e.isIntersecting ? inView.add(e.target.dataset.group) : inView.delete(e.target.dataset.group)));
      const first = GROUPS.find((g) => inView.has(g.id));
      if (first) setActiveGroup(first.id);
    }, { rootMargin: '-80px 0px -60% 0px' });
    document.querySelectorAll('.faq-group[data-group]').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  const goToGroup = (id) => {
    setActiveGroup(id);
    document.getElementById(`faq-group-${id}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };

  const copyLink = (id) => {
    const url = `${window.location.origin}/faq#${id}`;
    navigator.clipboard?.writeText(url)
      .then(() => toast.success(t('faq.linkCopied')))
      .catch(() => {});
  };

  return (
    <div className="faq-page">
      <aside className="faq-side">
        <header className="faq-header">
          <h1>{t('faq.title')}</h1>
          <p>{t('faq.subtitle')}</p>
        </header>
        <Button variant="secondary" size={36} icon="explore" className="faq-tour-btn" onClick={startWelcomeTour}>
          {t('welcome.banner.tour')}
        </Button>
        <nav className="faq-groups" aria-label={t('faq.title')}>
          {GROUPS.map((g) => (
            <button
              key={g.id}
              type="button"
              className={cx('faq-groups__row', activeGroup === g.id && 'is-on')}
              aria-current={activeGroup === g.id ? 'true' : undefined}
              onClick={() => goToGroup(g.id)}
            >
              <span>{t(`faq.groups.${g.id}`)}</span>
              <span className="faq-groups__n">{g.items.length}</span>
            </button>
          ))}
        </nav>
      </aside>

      <div className="faq-main">
        {GROUPS.map((group) => (
          <section key={group.id} className="faq-group" data-group={group.id} aria-labelledby={`faq-group-${group.id}`}>
            <h2 id={`faq-group-${group.id}`} className="v2-eyebrow">{t(`faq.groups.${group.id}`)}</h2>
            {group.items.map((id) => (
              <div key={id} className="faq-item">
                <details id={`faq-${id}`}>
                  <summary>
                    <span className="faq-q">{t(`faq.items.${id}.q`)}</span>
                    <Icon name="expand_more" size={20} className="faq-chev" />
                  </summary>
                  <div className="faq-a">
                    <p>
                      <Trans
                        i18nKey={`faq.items.${id}.${answerKey(id)}`}
                        values={{ shortMinutes: Math.round(SHORTS_MAX_DURATION_SEC / 60) }}
                        components={TAGS}
                      />
                    </p>
                  </div>
                </details>
                <IconButton
                  icon="link"
                  size={32}
                  variant="ghost"
                  round
                  className="faq-copy"
                  label={t('faq.copyLink')}
                  onClick={() => copyLink(id)}
                />
              </div>
            ))}
          </section>
        ))}

        <section className="faq-more">
          <p>
            <b>{t('faq.more.title')}</b>{' '}
            <span><Trans i18nKey="faq.more.text" components={TAGS} /></span>
          </p>
        </section>
      </div>
    </div>
  );
}
