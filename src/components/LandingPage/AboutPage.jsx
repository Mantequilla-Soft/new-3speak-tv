import React, { useEffect, useState } from 'react';
import { Shield, Users, Zap, HelpCircle, Video, MessageCircle } from 'lucide-react';
import './AboutPage.scss';
import speak from "../../assets/image/3speak.png"
// lucide-react v1 dropped brand icons; the X mark comes from react-icons, like
// the sibling Discord/Telegram icons in the same row.
import { FaDiscord, FaXTwitter } from "react-icons/fa6";
import { FaTelegramPlane } from "react-icons/fa";
import spk_network from "../../assets/image/spk_network.png"
import { Link, useNavigate } from 'react-router-dom';
import { useAppStore } from '../../lib/store';
import { useTranslation } from 'react-i18next';
import hive from "../../assets/image/hive-1.jpeg"
const AboutPage = () => {
  const { t } = useTranslation();
  const [isVisible, setIsVisible] = useState(false);
  const {   user,  } = useAppStore();
  const navigate = useNavigate()

  useEffect(() => {
    setIsVisible(true);
  }, []);

  const iflogin = ()=>{
    
    if(user){
      navigate("/")
    }else{
      navigate("/login")
    }
  }

  const quotes = [
    {
      text: t('pages.about.quotes.q1'),
      author: "George Orwell"
    },
    {
      text: t('pages.about.quotes.q2'),
      author: "Voltaire"
    },
    {
      text: t('pages.about.quotes.q3'),
      author: "Philip Sharp"
    },
    {
      text: t('pages.about.quotes.q4'),
      author: "Marshall Lumsden"
    },
    {
      text: t('pages.about.quotes.q5'),
      author: "Alan Dershowitz"
    },
    {
      text: t('pages.about.quotes.q6'),
      author: "Anna Quindlen"
    },
    {
      text: t('pages.about.quotes.q7'),
      author: "Brad Thor"
    },
    {
      text: t('pages.about.quotes.q8'),
      author: "Newton Lee"
    },
    {
      text: t('pages.about.quotes.q9'),
      author: "Hugo L. Black"
    }
  ];

  return (
    <div className="landing-page">
      {/* Hero Section */}
      <section className="hero-section">
        <div className={`hero-content ${isVisible ? 'visible' : ''}`}>
          <h1 className="main-title">
            <span className="brand-name">3SPEAK</span>
            <span className="tagline">{t('pages.about.hero.tagline1')}</span>
            <span className="tagline">{t('pages.about.hero.tagline2')}</span>
          </h1>
          <p className="description">
            {/* 3Speak is a place where content creators directly own their onsite assets and their communities. 
            Using blockchain technology, the ownership of these assets and communities are intrinsic to the 
            creator and the user, not 3 Speak. */}

            {t('pages.about.hero.description')}
          </p>
          <button onClick={iflogin} className="cta-button">
            {t('pages.about.hero.cta')}
          </button>
        </div>
      </section>

      {/* How It Works Section */}
      <section className="section dark-bg">
        <div className="container-ab">
          <div className="section-header">
            <h2 className="section-title">{t('pages.about.how.title')}</h2>
            <p className="section-subtitle">
              {t('pages.about.how.subtitle')}
            </p>
          </div>
          <div className="grid grid-3">
            <div className="feature-card">
              <div className="feature-icon">
                <div className="icon-container-ab">
                  <Video className="text-red-400" />
                </div>
              </div>
              <h3 className="feature-title red-text">{t('pages.about.how.create.title')}</h3>
              <p className="feature-description">{t('pages.about.how.create.text')}</p>
            </div>
            <div className="feature-card blue-accent">
              <div className="feature-icon">
                <div className="icon-container-ab blue-border">
                  <img 
                    src={speak}
                    alt={t('pages.about.logoAlt')} 
                  />
                </div>
              </div>
              <h3 className="feature-title blue-text">{t('pages.about.how.earn.title')}</h3>
              <p className="feature-description">{t('pages.about.how.earn.text')}</p>
            </div>
            <div className="feature-card">
              <div className="feature-icon">
                <div className="icon-container-ab">
                  <Users className="text-red-400" />
                </div>
              </div>
              <h3 className="feature-title red-text">{t('pages.about.how.community.title')}</h3>
              <p className="feature-description">{t('pages.about.how.community.text')}</p>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="section dark-bg">
        <h1 className="feature-title-ns red-text">{t('pages.about.features.title')}</h1>
        <div className="container-ab">
          <div className="grid grid-3">
            <div className="feature-card">
              <div className="feature-icon">
                <div className="icon-container-ab">
                  <Zap className="text-red-400" />
                </div>
              </div>
              <h3 className="feature-title red-text">{t('pages.about.features.rewards.title')}</h3>
              <p className="feature-description">
                {t('pages.about.features.rewards.text')}
              </p>
            </div>

            <div className="feature-card blue-accent">
              <div className="feature-icon">
                <div className="icon-container-ab blue-border">
                  <Users className="text-blue-400" />
                </div>
              </div>
              <h3 className="feature-title blue-text">{t('pages.about.features.p2p.title')}</h3>
              <p className="feature-description">
                {t('pages.about.features.p2p.text')}
              </p>
            </div>

            <div className="feature-card">
              <div className="feature-icon">
                <div className="icon-container-ab">
                  <img 
                    src={speak}
                    alt={t('pages.about.logoAlt')} 
                  />
                </div>
              </div>
              <h3 className="feature-title red-text">{t('pages.about.features.tokenisation.title')}</h3>
              <p className="feature-description">
                {t('pages.about.features.tokenisation.text')}
              </p>
            </div>

            <div className="feature-card blue-accent">
              <div className="feature-icon">
                <div className="icon-container-ab blue-border">
                  <Shield className="text-blue-400" />
                </div>
              </div>
              <h3 className="feature-title blue-text">{t('pages.about.features.freeSpeech.title')}</h3>
              <p className="feature-description">
                {t('pages.about.features.freeSpeech.text')}
              </p>
            </div>

            <div className="feature-card">
              <div className="feature-icon">
                <div className="icon-container-ab">
                  <MessageCircle className="text-red-400" />
                </div>
              </div>
              <h3 className="feature-title red-text">{t('pages.about.features.journalism.title')}</h3>
              <p className="feature-description">
                {t('pages.about.features.journalism.text')}
              </p>
            </div>
          </div>
        </div>
      </section>

      

      {/* Powered by Hive Section */}
      <section className="section dark-bg hive-section">
        <div className="container-ab">
          <div className="section-header">
            <h2 className="section-title">{t('pages.about.hive.title')}</h2>
          </div>
          <div className="hive-logo-container-ab">
            <div className="logo-box">
              <div className="logo-content">
                <img 
                  src={speak}
                  alt={t('pages.about.logoAlt')} 
                />
                <div className="times-symbol">×</div>
                <div className="hive-logo">
                  {/* <span>H</span> */}
                  <img src={hive} alt="" />
                </div>
              </div>
            </div>
          </div>
          <p className="section-subtitle-ns">
            {t('pages.about.hive.description')}
          </p>
          <div className="grid grid-3">
            <div className="feature-card">
              <h3 className="feature-title red-text">{t('pages.about.hive.decentralized.title')}</h3>
              <p className="feature-description">{t('pages.about.hive.decentralized.text')}</p>
            </div>
            <div className="feature-card blue-accent">
              <h3 className="feature-title blue-text">{t('pages.about.hive.fast.title')}</h3>
              <p className="feature-description">{t('pages.about.hive.fast.text')}</p>
            </div>
            <div className="feature-card">
              <h3 className="feature-title red-text">{t('pages.about.hive.community.title')}</h3>
              <p className="feature-description">{t('pages.about.hive.community.text')}</p>
            </div>
          </div>
        </div>
      </section>

      {/* Guidelines Section */}
      <section className="section darker-bg">
        <div className="container-ab">
          <div className="section-header">
            <h2 className="section-title">{t('pages.about.guidelines.title')}</h2>
            <p className="section-subtitle">
              {t('pages.about.guidelines.subtitle')}
            </p>
          </div>
          <div className="guidelines-grid">
            <div className="guideline-card">
              <h3 className="guideline-title red-text">{t('pages.about.guidelines.support.title')}</h3>
              <ul className="guideline-list">
                <li>{t('pages.about.guidelines.support.religion')}</li>
                <li>{t('pages.about.guidelines.support.politics')}</li>
                <li>{t('pages.about.guidelines.support.governments')}</li>
                <li>{t('pages.about.guidelines.support.pseudonyms')}</li>
                <li>{t('pages.about.guidelines.support.jokes')}</li>
              </ul>
            </div>
            <div className="guideline-card blue-border">
              <h3 className="guideline-title blue-text">{t('pages.about.guidelines.restrict.title')}</h3>
              <ul className="guideline-list">
                <li className="blue-bullet">{t('pages.about.guidelines.restrict.violence')}</li>
                <li className="blue-bullet">{t('pages.about.guidelines.restrict.gore')}</li>
                <li className="blue-bullet">{t('pages.about.guidelines.restrict.slander')}</li>
                <li className="blue-bullet">{t('pages.about.guidelines.restrict.illegal')}</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section className="section dark-bg">
        <div className="faq-container-ab">
          <div className="section-header">
            <h2 className="section-title">{t('pages.about.faqSection.title')}</h2>
            <p className="section-subtitle">
              {t('pages.about.faqSection.subtitle')}
            </p>
          </div>
          {/* The full FAQ lives on its own page (/faq), so it can grow and be
              linked to question by question. */}
          <div className="faq-cta-wrap">
            <Link to="/faq" className="faq-cta">{t('pages.about.faqSection.cta')}</Link>
          </div>
        </div>
      </section>

      {/* Quotes Section */}
      <section className="section darker-bg">
        <div className="container-ab">
          <div className="section-header">
            <h2 className="section-title">{t('pages.about.quotesTitle')}</h2>
          </div>
          <div className="quotes-grid">
            {quotes.map((quote, index) => (
              <div key={index} className="quote-card">
                <blockquote className="quote-text">
                  "{quote.text}"
                </blockquote>
                <cite className="quote-author">
                  — {quote.author}
                </cite>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer CTA */}
      <section className="section gradient-bg">
        <div className="container-ab">
          <div className="section-header">
            <h2 className="section-title">{t('pages.about.cta.title')}</h2>
            <p className="section-subtitle">
              {t('pages.about.cta.subtitle')}
            </p>
            {/* <button className="cta-button">
              Get Started Today
            </button> */}
          </div>
          
          <div style={{ borderTop: '1px solid #374151', paddingTop: '2rem', marginTop: '3rem' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '1.5rem', textAlign: 'center' }}>
              {t('pages.about.connect')}
            </h3>
            <div className="social-icons">
              <a href="https://t.me/threespeak?utm_source=3speak.tv" className="social-link red-accent" target="_blank" rel="noopener noreferrer">
                <FaTelegramPlane />
              </a>
              <a href="https://discord.com/invite/NSFS2VGj83" className="social-link" target="_blank" rel="noopener noreferrer">
                <FaDiscord size={30} />
              </a>
              <a href="https://x.com/3speaktv?utm_source=3speak.tv" className="social-link" target="_blank" rel="noopener noreferrer">
                <FaXTwitter />
              </a>
              <a href="https://spk.network/" className="social-link red-accent spk" target="_blank" rel="noopener noreferrer" aria-label="SPK Network">
                {/* Flat PNG mask so the mark takes the foreground colour (like the
                    sibling SVG icons) instead of its baked-in colour. */}
                <span className="spk-mark" aria-hidden="true"
                  style={{ WebkitMaskImage: `url(${spk_network})`, maskImage: `url(${spk_network})` }} />
              </a>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

export default AboutPage;