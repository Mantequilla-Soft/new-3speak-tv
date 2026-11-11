import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SiKofi, SiPatreon, SiBuymeacoffee, SiPaypal, SiGithubsponsors, SiLiberapay, SiOpencollective } from 'react-icons/si';
import { readSupportLinks } from '../../lib/supportLinks';
import { Icon } from '../v2/Icon';

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

const NO_LINKS = [];

// The creator's pages on payment sites (lib/supportLinks.js); [] while loading
// and when they set none. Kept with the recipient they belong to, so a tip window
// that switches creator never shows the previous one's links.
export function useSupportLinks(recipient) {
  const [state, setState] = useState({ recipient: null, links: [] });
  useEffect(() => {
    if (!recipient) return undefined;
    let alive = true;
    readSupportLinks(recipient)
      .then((links) => { if (alive) setState({ recipient, links }); })
      .catch(() => { /* no account or a node blip: just no links */ });
    return () => { alive = false; };
  }, [recipient]);
  return state.recipient === recipient ? state.links : NO_LINKS;
}

// The "More ways" tab of the tip window: one big row per page. The site's own
// logo marks the row (brand marks, not UI icons); the arrow is Material.
export default function OtherWays({ recipient, links }) {
  const { t } = useTranslation();
  return (
    <div className="tip-v2__form">
      <p className="v2-meta">{t('engagement.tip.otherWays', { recipient })}</p>
      <div className="tip-v2__ways">
        {links.map(({ site, url }) => {
          const Logo = SUPPORT_SITE_ICONS[site.id];
          return (
            <a key={url} className="tip-v2__way" href={url} target="_blank" rel="noopener noreferrer nofollow ugc" title={url}>
              {Logo ? <Logo size={18} aria-hidden /> : <Icon name="link" size={18} />}
              <span>{site.label}</span>
              <Icon name="open_in_new" size={18} />
            </a>
          );
        })}
      </div>
      <p className="v2-meta-sm">{t('engagement.tip.otherWaysNote')}</p>
    </div>
  );
}
