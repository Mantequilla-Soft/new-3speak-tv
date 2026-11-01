import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SiKofi, SiPatreon, SiBuymeacoffee, SiPaypal, SiGithubsponsors, SiLiberapay, SiOpencollective } from 'react-icons/si';
import { readSupportLinks } from '../../lib/supportLinks';

// Shared with Settings > Connections (SupportLinksSection).
export const SUPPORT_SITE_ICONS = {
  kofi: SiKofi,
  patreon: SiPatreon,
  buymeacoffee: SiBuymeacoffee,
  paypal: SiPaypal,
  github: SiGithubsponsors,
  liberapay: SiLiberapay,
  opencollective: SiOpencollective,
};

// "More ways to support @x": the creator's pages on payment sites
// (lib/supportLinks.js), under the tip form. Nothing when they set none.
// `hidden` keeps the fetched list while the invoice screen is up.
export default function OtherWays({ recipient, hidden = false }) {
  const { t } = useTranslation();
  const [links, setLinks] = useState([]);
  useEffect(() => {
    if (!recipient) return undefined;
    let alive = true;
    readSupportLinks(recipient)
      .then((l) => { if (alive) setLinks(l); })
      .catch(() => { /* no account or a node blip: just no links */ });
    return () => { alive = false; };
  }, [recipient]);

  if (hidden || !links.length) return null;
  return (
    <div className="tip-other-ways">
      <span className="tip-other-ways-title">{t('engagement.tip.otherWays', { recipient })}</span>
      <div className="tip-other-ways-links">
        {links.map(({ site, url }) => {
          const Icon = SUPPORT_SITE_ICONS[site.id];
          return (
            <a key={url} href={url} target="_blank" rel="noopener noreferrer nofollow ugc" title={url}>
              {Icon && <Icon />} {site.label}
            </a>
          );
        })}
      </div>
    </div>
  );
}
