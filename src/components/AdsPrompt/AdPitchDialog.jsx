import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { MdCampaign } from 'react-icons/md';
import { fetchPricing } from '../../lib/advertiseData';

/**
 * The other half of the ad conversation: you can buy one too.
 *
 * The formats are fetched from the rate card rather than listed here, for the same
 * reason /advertise reads them from the server: a format added on the backend
 * should appear without a frontend change. The list below is only what to show
 * when the rate card cannot be reached, and it is deliberately not priced, because
 * a stale price shown as a real one is worse than no price.
 */
const FALLBACK_FORMATS = [
  { key: 'video_roll', label: 'Video spot', blurb: 'A short spot inside the video, at the point of the video you choose.' },
  { key: 'video_banner', label: 'Player banner', blurb: 'A banner across the bottom of the video. It is part of the picture, not a layer over it.' },
  { key: 'shorts_roll', label: 'Shorts spot', blurb: 'A full screen vertical spot in the Shorts feed, between one short and the next.' },
  { key: 'upload_gate', label: 'Pre-upload spot', blurb: 'A spot creators watch before they can upload. Small, high intent audience.' },
];

export default function AdPitchDialog({ onDone }) {
  const [formats, setFormats] = useState(null);

  useEffect(() => {
    let alive = true;
    fetchPricing()
      .then((r) => {
        if (!alive) return;
        const list = Array.isArray(r && r.formats) ? r.formats : [];
        setFormats(list.length ? list : FALLBACK_FORMATS);
      })
      .catch(() => { if (alive) setFormats(FALLBACK_FORMATS); });
    return () => { alive = false; };
  }, []);

  const shown = formats || FALLBACK_FORMATS;

  return createPortal(
    // Closed with the buttons, not by clicking beside the card, matching the
    // settings dialog so the pair behaves consistently.
    <div className="ads-prompt-overlay">
      <div className="ads-prompt">
        {/* The /advertise header, verbatim: icon, title and lede. This dialog is the
            front door to that page for anyone who never went looking for it, and
            arriving on a page you have already seen the top of reads as one thing
            rather than two pitches that happen to be about the same product. */}
        <header className="ads-prompt-head">
          <MdCampaign className="ads-prompt-head-icon" aria-hidden="true" />
          <div>
            <h3 className="ads-prompt-title">Advertise on 3Speak videos</h3>
            <p className="ads-prompt-lede">
              Your ad plays <strong>inside</strong> the video rather than in a box beside
              it, so it reaches people whether or not they run an ad blocker.
            </p>
          </div>
        </header>

        <p className="ads-prompt-text">
          Want a spot of your own? 3Speak sells its own ad slots, paid in HIVE or HBD,
          with no third party tracking anyone. If you have a project, a channel or an
          event to put in front of this audience, these are the formats you can book.
        </p>

        <ul className="ads-prompt-formats">
          {shown.map((f) => (
            <li key={f.key}>
              <span className="ads-prompt-format-name">{f.label}</span>
              <span className="ads-prompt-format-blurb">{f.blurb}</span>
            </li>
          ))}
        </ul>

        {/* The reach point, which is the part people do not expect: a 3Speak player
            embedded on someone else's site is still a 3Speak player. */}
        <p className="ads-prompt-reach">
          Your spot runs on 3Speak, and in every 3Speak player embedded on other sites.
          It travels with the video wherever it is watched, not only here.
        </p>

        <div className="ads-prompt-actions">
          <button type="button" className="ads-prompt-ghost" onClick={onDone}>
            Not now
          </button>
          <Link to="/advertise" className="ads-prompt-primary" onClick={onDone}>
            See ad options
          </Link>
        </div>
      </div>
    </div>,
    document.body,
  );
}
