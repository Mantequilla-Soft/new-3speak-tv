import HiveAvatar from '../HiveAvatar/HiveAvatar';
import { iconForSlug } from '../../utils/spotlight';
import { useTranslation } from 'react-i18next';

// Passive, faithful render of the public page — avatar/name/headline + the blocks
// exactly as they'll appear (header size/align, link styling, image/video). NOT
// interactive; arrangement happens in the editor's ArrangeGrid.
function Block({ s, theme }) {
  const { t } = useTranslation();
  const radius = s.radius ?? theme.radius;
  if (s.type === 'header') {
    return <div className={`sp-e-pv-header sp-e-pv-header-${s.size || 'md'}`} style={{ textAlign: s.align || 'center', color: theme.text }}>{s.text}</div>;
  }
  if (s.type === 'link') {
    const Icon = iconForSlug(s.icon);
    const outline = theme.buttonStyle === 'outline';
    return (
      <div className="sp-e-pv-link" style={{
        background: outline ? 'transparent' : (s.bg || theme.sectionBg),
        color: s.text || theme.sectionText,
        borderRadius: radius,
        border: outline ? '1px solid currentColor' : 'none',
      }}>
        <span className="sp-e-pv-ic" style={{ background: s.iconBg || 'transparent', color: s.iconColor || 'inherit' }}><Icon size={15} /></span>
        <span>{s.title || s.url || t('spotlight.sectionTypes.link')}</span>
      </div>
    );
  }
  if (s.type === 'image') {
    return s.src ? <img className="sp-e-pv-img" src={s.src} alt="" style={{ borderRadius: radius }} /> : null;
  }
  if (s.type === 'video' && s.permlink) {
    const cardStyle = {
      background: s.bg || theme.sectionBg || 'rgba(255,255,255,0.08)',
      color: s.text || theme.sectionText || undefined,
      borderRadius: radius,
      fontSize: `calc(13px * ${s.fontScale ? s.fontScale / 100 : 1})`,
      padding: 8,
      border: s.borderWidth ? `${s.borderWidth}px solid ${s.borderColor || '#000'}` : undefined,
    };
    return (
      <div className={`sp-e-pv-vcard${s.isShort ? ' short' : ''}`} style={cardStyle}>
        {s.title ? <div className="sp-e-pv-vtitle">{s.title}</div> : null}
        <div className={`sp-e-pv-video${s.isShort ? ' short' : ''}`} style={{ borderRadius: radius }}>
          <img src={s.thumbnail || `https://img.3speak.tv/${s.permlink}/thumbnail.png`} alt="" /><span>▶</span>
        </div>
      </div>
    );
  }
  return null;
}

export default function SpotlightPreview({ sections, theme, username, displayName, headline, bg }) {
  return (
    <div className="sp-e-preview" style={{ background: bg, color: theme.text }}>
      <div className="sp-e-pv-profile">
        <span className="sp-e-pv-avatar"><HiveAvatar username={username} size={null} alt="" badgeSize={12} /></span>
        <div className="sp-e-pv-name">{displayName || `@${username}`}</div>
        {displayName ? <div className="sp-e-pv-handle">@{username}</div> : null}
        {headline ? <p className="sp-e-preview-headline">{headline}</p> : null}
      </div>
      <div className="sp-e-pv-grid">
        {sections.map((s) => {
          const wcls = `sp-e-pv-cell${s.width === 'half' ? ' w-half' : s.width === 'third' ? ' w-third' : ''}`;
          return <div key={s.id} className={wcls}><Block s={s} theme={theme} /></div>;
        })}
      </div>
    </div>
  );
}
