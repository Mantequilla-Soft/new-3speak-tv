/**
 * Plain-language, INFORMATIONAL overview of how 3Speak handles user data — grounded
 * in what the code actually does (data flows current as of 2026-07-14).
 *
 * Deliberately NOT a formal/binding privacy policy or Impressum. 3Speak is framed as
 * a decentralised collective with no single operating company, so this page names no
 * operator/controller, no vendor, and no location — it's a good-faith transparency
 * note only. The banner at the top says so explicitly. Keep it that way: describe
 * data handling generically; don't add company names, addresses, or placeholders.
 */
import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import './Legal.scss';

// i18n: only the page chrome (tab title, back link) is translated. The body is
// deliberately English-only: the English text is the binding version, and a
// machine-translated legal text would be a liability. Non-English readers get a
// short notice saying so.
export default function Legal() {
  const { t, i18n } = useTranslation();
  return (
    <div className="legal">
      <Helmet><title>{t('pages.legal.pageTitle')}</title></Helmet>

      {i18n.resolvedLanguage !== 'en' && (
        <p className="legal-draft" role="note" lang={i18n.resolvedLanguage}>{t('pages.legal.englishOnly')}</p>
      )}

      <div className="legal-draft" role="note">
        3Speak is an open, decentralised project maintained by a collective of contributors,
        not a single operating company. This is a plain-language overview of how the software
        handles your data, provided in good faith for transparency. It is <strong>not</strong> a
        formal or binding privacy policy or legal notice.
      </div>

      <h1>How 3Speak handles your data</h1>
      <p className="legal-updated">Last updated: 14 July 2026</p>

      {/* ── The blockchain reality, up front. This is the single most important
          sentence for a Hive-based service and belongs before anything else. ── */}
      <section className="legal-highlight">
        <h2>Read this first: 3Speak runs on a public blockchain</h2>
        <p>
          When you post a video, comment, vote or reshare on 3Speak, it is signed with your own
          Hive keys and broadcast to the <strong>Hive blockchain</strong> — a public, permanent,
          decentralised ledger. Anyone in the world can read it, and copies exist on servers we do
          not control.
        </p>
        <p>
          <strong>This content cannot be deleted — not by us, not by you, not by anyone.</strong>{' '}
          Deleting your 3Speak account removes our copies and stops us showing your content here,
          but the blockchain records remain public forever. Please do not publish anything you may
          later need removed.
        </p>
      </section>

      <section>
        <h2>1. Getting in touch</h2>
        <p>
          3Speak is maintained by a decentralised collective of contributors rather than a single
          operating company. For any question about your data, or to ask us to send or delete the
          data 3Speak holds, contact <a href="mailto:privacy@3speak.tv">privacy@3speak.tv</a> or
          use the request form under <em>Settings → About / Contact</em>.
        </p>
      </section>

      <section>
        <h2>2. What we process, why, and our legal basis</h2>
        <table className="legal-table">
          <thead>
            <tr><th>Data</th><th>Purpose</th><th>Legal basis (GDPR Art. 6)</th></tr>
          </thead>
          <tbody>
            <tr>
              <td>Your Hive account name and login tokens</td>
              <td>Signing you in and keeping you signed in</td>
              <td>Performance of a contract, Art. 6(1)(b)</td>
            </tr>
            <tr>
              <td>Video, playlist, reshare and subscription records</td>
              <td>Running the features you use</td>
              <td>Art. 6(1)(b)</td>
            </tr>
            <tr>
              <td>
                Watch statistics — <strong>country only</strong> (derived from your IP the moment
                you press play, then the IP is discarded), device/browser type, seconds watched
              </td>
              <td>Aggregate audience analytics shown to the creator of the video</td>
              <td>Legitimate interest, Art. 6(1)(f)</td>
            </tr>
            <tr>
              <td>
                View counts — we store a <strong>one-way, per-video hash</strong> of your IP, never
                the IP itself, to count a view once
              </td>
              <td>Counting views without double-counting</td>
              <td>Legitimate interest, Art. 6(1)(f)</td>
            </tr>
            <tr>
              <td>Watch history (only if you leave it enabled in Settings)</td>
              <td>Hiding videos you already watched; “continue watching”</td>
              <td>Art. 6(1)(b) / your settings</td>
            </tr>
            <tr>
              <td>Topic tags you add to videos when voting</td>
              <td>Community topic labelling (also written to the blockchain by you)</td>
              <td>Art. 6(1)(f)</td>
            </tr>
          </tbody>
        </table>
        <p className="legal-note">
          We do <strong>not</strong> store your IP address in our application database, we run{' '}
          <strong>no</strong> advertising, and we use <strong>no</strong> third-party analytics or
          tracking pixels.
        </p>
      </section>

      <section>
        <h2>3. What we store in your browser</h2>
        <p>
          We keep your login, the settings you choose (theme, volume, language, subtitles, feed
          preferences) and — if you allow it — where you left off in each video, all in your
          browser's local storage. None of this is advertising or tracking, and the video-resume
          data never leaves your device. You control the optional part through the cookie banner
          shown on your first visit. See the banner's “What exactly is stored?” for the full list.
        </p>
      </section>

      <section>
        <h2>4. Who else receives data</h2>
        <p>
          To run the service we rely on a small number of third-party providers — for hosting,
          content delivery and email — who process data on our behalf and only as needed to
          provide 3Speak.
        </p>
        <p>
          Anything you publish also goes to the <strong>Hive blockchain and IPFS</strong> —
          public, decentralised networks that are outside our control.
        </p>
      </section>

      <section>
        <h2>5. International transfers</h2>
        <p>
          Where one of these providers is outside the EU/EEA, such transfers are made under
          appropriate safeguards — for example the European Commission's Standard Contractual
          Clauses or an adequacy decision.
        </p>
      </section>

      <section>
        <h2>6. How long we keep it</h2>
        <ul>
          <li>Watch-statistics rows: 365 days, then automatically deleted.</li>
          <li>Server access logs: IP addresses are truncated at the point of writing; logs rotate within ~14 days.</li>
          <li>Measurement sessions: minutes (they expire automatically).</li>
          <li>Account-related records: for as long as you have an account, then removed on request.</li>
        </ul>
      </section>

      <section>
        <h2>7. Your rights</h2>
        <p>Under the GDPR you have the right to:</p>
        <ul>
          <li>access the data we hold about you (Art. 15);</li>
          <li>have it corrected (Art. 16) or erased (Art. 17);</li>
          <li>restrict or object to processing (Art. 18, 21);</li>
          <li>receive your data in a portable format (Art. 20).</li>
        </ul>
        <p>
          Use the form under <em>Settings → About / Contact</em> or email{' '}
          <a href="mailto:privacy@3speak.tv">privacy@3speak.tv</a>. We respond within one month. Note
          the blockchain limit explained at the top: we can remove our own copies, but not the
          public ledger.
        </p>
        <p>
          You also have the right to lodge a complaint with a data protection supervisory
          authority — in particular in the EU member state where you live or work, or where you
          believe the issue occurred.
        </p>
      </section>

      <section>
        <h2>8. No automated decisions with legal effect</h2>
        <p>
          Our feeds rank videos by popularity and your chosen interests, but this does not produce
          any decision with a legal or similarly significant effect on you (Art. 22).
        </p>
      </section>

      <p className="legal-back"><Link to="/">{t('pages.legal.back')}</Link></p>
    </div>
  );
}
