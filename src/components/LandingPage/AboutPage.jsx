import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import speak from "../../assets/image/3speak.png";
import hive from "../../assets/image/hive-1.jpeg";
import { useAppStore } from '../../lib/store';
import { Button, Icon, IconButton } from '../v2/ui';
import { cx } from '../v2/helpers';
import './AboutPage.scss';
import hiveMark from "../../assets/image/hive-mark.png";

// The quotes are translated; the names stay as they are.
const QUOTES = [
  ['q1', 'George Orwell'],
  ['q2', 'Voltaire'],
  ['q3', 'Philip Sharp'],
  ['q4', 'Marshall Lumsden'],
  ['q5', 'Alan Dershowitz'],
  ['q6', 'Anna Quindlen'],
  ['q7', 'Brad Thor'],
  ['q8', 'Newton Lee'],
  ['q9', 'Hugo L. Black'],
];

// How 3Speak works: the three pillars in the hero (26d).
const PILLARS = [
  { id: 'create', icon: 'videocam', tone: 'accent' },
  { id: 'earn', icon: 'redeem', tone: 'cyan' },
  { id: 'community', icon: 'groups', tone: 'accent' },
];

const FEATURES = [
  { id: 'rewards', icon: 'bolt', tone: 'accent' },
  { id: 'p2p', icon: 'group', tone: 'cyan' },
  { id: 'tokenisation', icon: 'toll', tone: 'accent' },
  { id: 'freeSpeech', icon: 'shield', tone: 'cyan' },
  { id: 'journalism', icon: 'campaign', tone: 'accent' },
];

const HIVE_POINTS = [
  { id: 'decentralized', icon: 'hub' },
  { id: 'fast', icon: 'speed' },
  { id: 'community', icon: 'diversity_3' },
];

// Brand names stay in English. Material Symbols has no brand marks, so each
// link carries a plain icon and the network's name.
const SOCIALS = [
  { name: 'Telegram', href: 'https://t.me/threespeak?utm_source=3speak.tv', icon: 'send' },
  { name: 'Discord', href: 'https://discord.com/invite/NSFS2VGj83', icon: 'forum' },
  { name: 'X', href: 'https://x.com/3speaktv?utm_source=3speak.tv', icon: 'alternate_email' },
];

const SectionHead = ({ tone = 'cyan', title, sub, as: El = 'h2' }) => (
  <div className="about-head">
    <span className={cx('about-head__bar', `is-${tone}`)} aria-hidden="true" />
    <div className="about-head__text">
      <El>{title}</El>
      {sub && <p>{sub}</p>}
    </div>
  </div>
);

// Voices of freedom as a horizontal scroller: fixed-width quote cards in one
// row, round prev / next buttons where there is more to see (desktop; phones
// swipe), the same pattern as Who to follow on Home.
function QuotesRail({ children }) {
  const { t } = useTranslation();
  const ref = useRef(null);
  const [ends, setEnds] = useState({ left: false, right: false });
  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setEnds({ left: el.scrollLeft > 10, right: el.scrollLeft < el.scrollWidth - el.clientWidth - 10 });
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const frame = requestAnimationFrame(update);
    el.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => { cancelAnimationFrame(frame); el.removeEventListener('scroll', update); window.removeEventListener('resize', update); };
  }, [update]);
  const go = (dir) => {
    const el = ref.current;
    if (el) el.scrollBy({ left: dir * Math.max(300, el.clientWidth * 0.8), behavior: 'smooth' });
  };
  return (
    <div className="about-quotes-rail">
      {ends.left && <IconButton icon="chevron_left" label={t('profile.creators.scrollLeft')} size={36} round className="about-quotes-rail__btn is-left" onClick={() => go(-1)} />}
      <div className="about-quotes" ref={ref}>{children}</div>
      {ends.right && <IconButton icon="chevron_right" label={t('profile.creators.scrollRight')} size={36} round className="about-quotes-rail__btn is-right" onClick={() => go(1)} />}
    </div>
  );
}

const AboutPage = () => {
  const { t } = useTranslation();
  const { user } = useAppStore();
  const navigate = useNavigate();

  const iflogin = () => {
    if (user) navigate("/");
    else navigate("/login");
  };

  return (
    <div className="about">
      {/* Hero: who we are, the three pillars, the one action */}
      <section className="about-card about-hero" aria-labelledby="about-hero-title">
        <div className="about-hero__eyebrow">{t('nav.aboutLink')}</div>
        <h1 id="about-hero-title" className="about-hero__title">
          <span>{t('pages.about.hero.tagline1')}</span>
          <span>{t('pages.about.hero.tagline2')}</span>
        </h1>
        <p className="about-hero__desc">{t('pages.about.hero.description')}</p>

        <div className="about-hero__how">
          <div className="v2-eyebrow">{t('pages.about.how.title')}</div>
          <span className="about-hero__howsub">{t('pages.about.how.subtitle')}</span>
        </div>
        <div className="about-pillars">
          {PILLARS.map((p) => (
            <div key={p.id} className="about-tile">
              <span className={cx('about-tile__icon', `is-${p.tone}`)}><Icon name={p.icon} size={24} /></span>
              <b className="about-tile__title">{t(`pages.about.how.${p.id}.title`)}</b>
              <p>{t(`pages.about.how.${p.id}.text`)}</p>
            </div>
          ))}
        </div>

        <Button variant="primary" size={56} next className="about-hero__cta" onClick={iflogin}>
          {t('pages.about.hero.cta')}
        </Button>
      </section>

      {/* Powered by Hive */}
      <section className="about-card about-hive" aria-labelledby="about-hive-title">
        <div className="about-hive__logos">
          <img src={speak} alt={t('pages.about.logoAlt')} />
          <Icon name="close" size={18} className="about-hive__x" />
          <img src={hive} alt="Hive" className="is-round" />
        </div>
        <h2 id="about-hive-title" className="about-hive__title">{t('pages.about.hive.title')}</h2>
        <p className="about-hive__desc">{t('pages.about.hive.description')}</p>
        <ul className="about-hive__points">
          {HIVE_POINTS.map((p) => (
            <li key={p.id}>
              <span className="about-hive__picon"><Icon name={p.icon} size={18} /></span>
              <div>
                <b>{t(`pages.about.hive.${p.id}.title`)}</b>
                <span>{t(`pages.about.hive.${p.id}.text`)}</span>
              </div>
            </li>
          ))}
        </ul>
        {/* A plain, followed link to hive.io (issue #563). */}
        <Button as="a" href="https://hive.io" target="_blank" rel="noopener" variant="secondary" size={44} icon={<img src={hiveMark} alt="" width={18} height={16} />} trailing="open_in_new" className="about-hive__link">
          hive.io
        </Button>
      </section>

      {/* Features */}
      <section className="about-card about-wide" aria-labelledby="about-features-title">
        <SectionHead tone="accent" title={<span id="about-features-title">{t('pages.about.features.title')}</span>} />
        <div className="about-features">
          {FEATURES.map((f) => (
            <div key={f.id} className="about-tile">
              <span className={cx('about-tile__icon', `is-${f.tone}`)}><Icon name={f.icon} size={24} /></span>
              <b className={cx('about-tile__eyebrow', `is-${f.tone}`)}>{t(`pages.about.features.${f.id}.title`)}</b>
              <p>{t(`pages.about.features.${f.id}.text`)}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Guidelines and FAQ: both live on the FAQ page, so there is one
          version to keep current. The guidelines link opens that exact question. */}
      <section className="about-card about-link-card" aria-labelledby="about-guidelines-title">
        <SectionHead title={<span id="about-guidelines-title">{t('pages.about.guidelines.title')}</span>} sub={t('pages.about.guidelines.subtitle')} />
        <Button as={Link} to="/faq#talk" variant="secondary" size={44} next block>{t('pages.about.guidelines.cta')}</Button>
      </section>

      <section className="about-card about-link-card" aria-labelledby="about-faq-title">
        <SectionHead title={<span id="about-faq-title">{t('pages.about.faqSection.title')}</span>} sub={t('pages.about.faqSection.subtitle')} />
        <Button as={Link} to="/faq" variant="secondary" size={44} next block>{t('pages.about.faqSection.cta')}</Button>
      </section>

      {/* Voices of freedom */}
      <section className="about-card about-wide" aria-labelledby="about-quotes-title">
        <SectionHead tone="accent" title={<span id="about-quotes-title">{t('pages.about.quotesTitle')}</span>} />
        {/* A sideways scroller (owner 2026-11-12), arrows on desktop, swipe on phones. */}
        <QuotesRail>
          {QUOTES.map(([key, author]) => (
            <figure key={key} className="about-quote">
              <Icon name="format_quote" size={20} className="about-quote__mark" />
              <blockquote>{t(`pages.about.quotes.${key}`)}</blockquote>
              <figcaption>{author}</figcaption>
            </figure>
          ))}
        </QuotesRail>
      </section>

      {/* Ready to own your content, and where to find us */}
      <section className="about-cta about-wide" aria-labelledby="about-cta-title">
        <div className="about-cta__text">
          <h2 id="about-cta-title">{t('pages.about.cta.title')}</h2>
          <p>{t('pages.about.cta.subtitle')}</p>
        </div>
        <div className="about-cta__connect">
          <div className="v2-eyebrow">{t('pages.about.connect')}</div>
          <div className="about-socials">
            {SOCIALS.map((s) => (
              <Button key={s.name} as="a" href={s.href} target="_blank" rel="noopener noreferrer" variant="secondary" size={44} icon={s.icon}>
                {s.name}
              </Button>
            ))}
            <Button as="a" href="https://spk.network/" target="_blank" rel="noopener noreferrer" variant="secondary" size={44} icon="lan">
              SPK Network
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
};

export default AboutPage;
