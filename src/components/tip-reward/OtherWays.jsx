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

// The creator's pages on payment sites (lib/supportLinks.js); [] while loading
// and when they set none.
export function useSupportLinks(recipient) {
  const [links, setLinks] = useState([]);
  useEffect(() => {
    if (!recipient) return undefined;
    let alive = true;
    readSupportLinks(recipient)
      .then((l) => { if (alive) setLinks(l); })
      .catch(() => { /* no account or a node blip: just no links */ });
    return () => { alive = false; };
  }, [recipient]);
  return links;
}

// The "More ways" tab of the tip window: one big button per page.
export default function OtherWays({ recipient, links }) {
  const { t } = useTranslation();
  return (
    <div className="tip-modal-in">
      <div className="form">
        <p className="tip-method-note">{t('engagement.tip.otherWays', { recipient })}</p>
        <div className="tip-other-ways">
          {links.map(({ site, url }) => {
            const Icon = SUPPORT_SITE_ICONS[site.id];
            return (
              <a key={url} href={url} target="_blank" rel="noopener noreferrer nofollow ugc" title={url}>
                {Icon && <Icon size={18} />}
                <span>{site.label}</span>
              </a>
            );
          })}
        </div>
        <p className="tip-method-note">{t('engagement.tip.otherWaysNote')}</p>
      </div>
    </div>
  );
}
