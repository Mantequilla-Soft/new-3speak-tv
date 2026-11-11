/**
 * Plain-language, INFORMATIONAL overview of how 3Speak handles user data, grounded
 * in what the code actually does (data flows current as of 2026-07-14).
 *
 * Deliberately NOT a formal/binding privacy policy or Impressum. 3Speak is framed as
 * a decentralised collective with no single operating company, so this page names no
 * operator/controller, no vendor, and no location. It's a good-faith transparency
 * note only. The banner at the top says so explicitly. Keep it that way: describe
 * data handling generically; don't add company names, addresses, or placeholders.
 */
import { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { cx } from '../components/v2/helpers';
import './Legal.scss';

// The table of contents. Titles are part of the English-only body.
const TOC = [
  ['legal-first', 'Read this first'],
  ['legal-contact', '1. Getting in touch'],
  ['legal-process', '2. What we process'],
  ['legal-browser', '3. Your browser'],
  ['legal-recipients', '4. Who else receives data'],
  ['legal-transfers', '5. International transfers'],
  ['legal-retention', '6. How long we keep it'],
  ['legal-rights', '7. Your rights'],
  ['legal-automated', '8. No automated decisions'],
];

const PROCESSING = [
  ['Your Hive account name and login tokens', 'Signing you in and keeping you signed in', 'Performance of a contract, Art. 6(1)(b)'],
  ['Video, playlist, reshare and subscription records', 'Running the features you use', 'Art. 6(1)(b)'],
  [
    <>Watch statistics: <strong>country only</strong> (derived from your IP the moment you press play, then the IP is discarded), device/browser type, seconds watched</>,
    'Aggregate audience analytics shown to the creator of the video',
    'Legitimate interest, Art. 6(1)(f)',
  ],
  [
    <>View counts: we store a <strong>one-way, per-video hash</strong> of your IP, never the IP itself, to count a view once</>,
    'Counting views without double-counting',
    'Legitimate interest, Art. 6(1)(f)',
  ],
  ['Watch history (only if you leave it enabled in Settings)', 'Hiding videos you already watched; “continue watching”', 'Art. 6(1)(b) / your settings'],
  ['Topic tags you add to videos when voting', 'Community topic labelling (also written to the blockchain by you)', 'Art. 6(1)(f)'],
];

const RETENTION = [
  ['Watch-statistics rows, then automatically deleted', '365 days'],
  ['Server access logs: IP addresses are truncated at the point of writing, and logs rotate', '~14 days'],
  ['Measurement sessions, which expire automatically', 'minutes'],
  ['Account-related records: for as long as you have an account, then removed on request', 'until you ask'],
];

const RIGHTS = ['Access · Art. 15', 'Correction · Art. 16', 'Erasure · Art. 17', 'Restrict or object · Art. 18, 21', 'Portability · Art. 20'];

// i18n: only the page chrome (tab title, back link, "On this page") is translated.
// The body is deliberately English-only: the English text is the binding version,
// and a machine-translated legal text would be a liability. Non-English readers
// get a short notice saying so.
export default function Legal() {
  const { t, i18n } = useTranslation();
  const [active, setActive] = useState(TOC[0][0]);

  // The table of contents follows the reader.
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return undefined;
    const inView = new Set();
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => (e.isIntersecting ? inView.add(e.target.id) : inView.delete(e.target.id)));
      const first = TOC.find(([id]) => inView.has(id));
      if (first) setActive(first[0]);
    }, { rootMargin: '-80px 0px -55% 0px' });
    TOC.forEach(([id]) => { const el = document.getElementById(id); if (el) io.observe(el); });
    return () => io.disconnect();
  }, []);

  const goTo = (id) => {
    setActive(id);
    document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };

  return (
    <div className="legal">
      <Helmet><title>{t('pages.legal.pageTitle')}</title></Helmet>

      <nav className="legal-toc" aria-label={t('pages.legal.onThisPage')}>
        <div className="v2-eyebrow legal-toc__label">{t('pages.legal.onThisPage')}</div>
        <div className="legal-toc__list">
          {TOC.map(([id, label]) => (
            <button key={id} type="button" lang="en" className={cx('legal-toc__row', active === id && 'is-on')}
              aria-current={active === id ? 'true' : undefined} onClick={() => goTo(id)}>
              {label}
            </button>
          ))}
        </div>
        <Link to="/" className="legal-toc__back">{t('pages.legal.back')}</Link>
      </nav>

      <article className="legal-body" lang="en">
        {i18n.resolvedLanguage !== 'en' && (
          <p className="legal-lang-note" role="note" lang={i18n.resolvedLanguage}>{t('pages.legal.englishOnly')}</p>
        )}

        <div className="legal-draft" role="note">
          3Speak is an open, decentralised project maintained by a collective of contributors,
          not a single operating company. This is a plain-language overview of how the software
          handles your data, provided in good faith for transparency. It is <strong>not</strong> a
          formal or binding privacy policy or legal notice.
        </div>

        <header className="legal-head">
          <h1>How 3Speak handles your data</h1>
          <p className="legal-updated">Last updated: 14 July 2026</p>
        </header>

        {/* The blockchain reality, up front. This is the single most important
            sentence for a Hive-based service and belongs before anything else. */}
        <section className="legal-highlight" id="legal-first">
          <h2>Read this first: 3Speak runs on a public blockchain</h2>
          <p>
            When you post a video, comment, vote or reshare on 3Speak, it is signed with your own
            Hive keys and broadcast to the <strong>Hive blockchain</strong>, a public, permanent,
            decentralised ledger. Anyone in the world can read it, and copies exist on servers we do
            not control.
          </p>
          <p>
            <strong>This content cannot be deleted, not by us, not by you, not by anyone.</strong>{' '}
            Deleting your 3Speak account removes our copies and stops us showing your content here,
            but the blockchain records remain public forever. Please do not publish anything you may
            later need removed.
          </p>
        </section>

        <section className="legal-section" id="legal-contact">
          <h2>1. Getting in touch</h2>
          <p>
            3Speak is maintained by a decentralised collective of contributors rather than a single
            operating company. For any question about your data, or to ask us to send or delete the
            data 3Speak holds, contact <a href="mailto:privacy@3speak.tv">privacy@3speak.tv</a> or
            use the request form under <em>Settings → About / Contact</em>.
          </p>
        </section>

        <section className="legal-section" id="legal-process">
          <h2>2. What we process, why, and our legal basis</h2>
          <div className="legal-table-wrap">
            <table className="legal-table">
              <thead>
                <tr><th>Data</th><th>Purpose</th><th>Legal basis (GDPR Art. 6)</th></tr>
              </thead>
              <tbody>
                {PROCESSING.map(([data, purpose, basis], i) => (
                  <tr key={i}>
                    <td data-label="Data">{data}</td>
                    <td data-label="Purpose" className="legal-table__muted">{purpose}</td>
                    <td data-label="Legal basis" className="legal-table__mono">{basis}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="legal-note">
            We do <strong>not</strong> store your IP address in our application database, we run{' '}
            <strong>no</strong> advertising, and we use <strong>no</strong> third-party analytics or
            tracking pixels.
          </p>
        </section>

        <div className="legal-cards">
          <section className="legal-card" id="legal-browser">
            <h2>3. What we store in your browser</h2>
            <p>
              We keep your login, the settings you choose (theme, volume, language, subtitles, feed
              preferences) and, if you allow it, where you left off in each video, all in your
              browser's local storage. None of this is advertising or tracking, and the video-resume
              data never leaves your device. You control the optional part through the cookie banner
              shown on your first visit. See the banner's “What exactly is stored?” for the full list.
            </p>
          </section>

          <section className="legal-card" id="legal-recipients">
            <h2>4. Who else receives data</h2>
            <p>
              To run the service we rely on a small number of third-party providers, for hosting,
              content delivery and email, who process data on our behalf and only as needed to
              provide 3Speak.
            </p>
            <p>
              Anything you publish also goes to the <strong>Hive blockchain and IPFS</strong>:
              public, decentralised networks that are outside our control.
            </p>
          </section>

          <section className="legal-card" id="legal-transfers">
            <h2>5. International transfers</h2>
            <p>
              Where one of these providers is outside the EU/EEA, such transfers are made under
              appropriate safeguards, for example the European Commission's Standard Contractual
              Clauses or an adequacy decision.
            </p>
          </section>

          <section className="legal-card" id="legal-automated">
            <h2>8. No automated decisions with legal effect</h2>
            <p>
              Our feeds rank videos by popularity and your chosen interests, but this does not produce
              any decision with a legal or similarly significant effect on you (Art. 22).
            </p>
          </section>
        </div>

        <section className="legal-section" id="legal-retention">
          <h2>6. How long we keep it</h2>
          <ul className="legal-retention">
            {RETENTION.map(([what, how]) => (
              <li key={what}><span>{what}</span><b>{how}</b></li>
            ))}
          </ul>
        </section>

        <section className="legal-section" id="legal-rights">
          <h2>7. Your rights</h2>
          <p>Under the GDPR you have the right to:</p>
          <ul className="legal-rights">
            {RIGHTS.map((r) => <li key={r}>{r}</li>)}
          </ul>
          <p>
            Use the form under <em>Settings → About / Contact</em> or email{' '}
            <a href="mailto:privacy@3speak.tv">privacy@3speak.tv</a>. We respond within one month. Note
            the blockchain limit explained at the top: we can remove our own copies, but not the
            public ledger.
          </p>
          <p>
            You also have the right to lodge a complaint with a data protection supervisory
            authority, in particular in the EU member state where you live or work, or where you
            believe the issue occurred.
          </p>
        </section>

        <p className="legal-back"><Link to="/">{t('pages.legal.back')}</Link></p>
      </article>
    </div>
  );
}
