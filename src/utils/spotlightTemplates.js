// Spotlight design templates — one-click starting points that fill the whole theme
// AND drop in sample components. Applying a template is non-destructive in the editor
// (the previous layout is snapshotted so it can be undone). Backgrounds are either
// self-contained CSS gradients or Unsplash-licensed wallpapers (free to use).
//
// Each template: { id, nameKey, nicheKey, emoji, theme, sections }. The name/niche
// are picker UI (i18n keys, translated at render); the theme text and sample
// `sections` are starter CONTENT saved to the creator's page, so they stay English.
// `sections` use the same shapes as newSection() (no ids — the editor assigns them on apply). A `hive-recent`
// embed auto-fills with the creator's own latest posts, so most templates come alive
// with real content the moment they're applied.

const uns = (id) => `https://images.unsplash.com/${id}?w=1400&q=70&auto=format&fit=crop`;

// Shared "my latest posts" showcase block. `perRow` 1-3, `imgSize` 0-100.
const latest = (count = 3, imgSize = 55, perRow = 1) => ({ type: 'embed', source: 'hive-recent', account: '', count, perRow, imgSize });

export const TEMPLATES = [
  {
    id: 'minimal',
    nameKey: 'spotlight.templates.minimal.name',
    nicheKey: 'spotlight.templates.minimal.niche',
    emoji: '⚪',
    theme: {
      bg: { type: 'gradient', color: '#f7f8fc', color2: '#e9ebf3', angle: 160, overlayType: 'none' },
      text: '#191922', sectionBg: 'rgba(20,20,32,0.06)', sectionText: '#191922',
      radius: 14, buttonStyle: 'soft', font: 'system', fontScale: 100, fontStyle: 'normal',
      textShadow: 'none', avatarPct: 100, avatarShadow: 18, avatarGlow: null,
      footerText: 'Watch me on 3Speak',
    },
    sections: [
      { type: 'header', text: 'Everything in one place', size: 'md', align: 'center' },
      { type: 'link', title: 'My website', url: 'https://example.com', icon: 'globe' },
      { type: 'link', title: 'Email me', url: 'mailto:you@example.com', icon: 'email' },
      latest(3, 40, 1),
    ],
  },
  {
    id: 'neon',
    nameKey: 'spotlight.templates.neon.name',
    nicheKey: 'spotlight.templates.neon.niche',
    emoji: '🌃',
    theme: {
      bg: { type: 'gradient', color: '#0a0016', color2: '#20003a', angle: 165, overlayType: 'none' },
      text: '#f6e9ff', sectionBg: 'rgba(255,43,214,0.14)', sectionText: '#ffffff',
      radius: 18, buttonStyle: 'soft', font: 'wide', fontScale: 105, fontStyle: 'normal',
      textShadow: 'strong', avatarPct: 110, avatarShadow: 10, avatarGlow: '#ff2bd6', avatarGlowSize: 36,
      avatarAnimType: 'pulse', avatarAnimSpeed: 4, avatarAnimLoop: true,
      footerText: 'Catch my streams on 3Speak',
    },
    sections: [
      { type: 'header', text: 'NEON', size: 'lg', align: 'center' },
      { type: 'link', title: 'Twitch', url: 'https://twitch.tv', icon: 'twitch', width: 'half' },
      { type: 'link', title: 'Discord', url: 'https://discord.gg', icon: 'discord', width: 'half' },
      latest(4, 70, 2),
    ],
  },
  {
    id: 'crypto',
    nameKey: 'spotlight.templates.crypto.name',
    nicheKey: 'spotlight.templates.crypto.niche',
    emoji: '🪙',
    theme: {
      bg: { type: 'image', image: uns('photo-1451187580459-43490279c0fa'), overlayType: 'gradient', overlayColor: '#050b1f', overlayColor2: '#0b1e3a', overlayAngle: 160, overlayOpacity: 78 },
      text: '#e9f2ff', sectionBg: 'rgba(80,150,255,0.14)', sectionText: '#eaf3ff',
      radius: 10, buttonStyle: 'outline', font: 'mono', fontScale: 96, fontStyle: 'normal',
      textShadow: 'soft', avatarPct: 100, avatarShadow: 30, avatarGlow: '#3b82f6', avatarGlowSize: 22,
      footerText: 'My 3Speak channel',
    },
    sections: [
      { type: 'header', text: 'gm ☀️', size: 'md', align: 'center' },
      { type: 'link', title: 'Bitcoin', url: 'https://example.com', icon: 'bitcoin', width: 'half' },
      { type: 'link', title: 'Ethereum', url: 'https://example.com', icon: 'ethereum', width: 'half' },
      { type: 'link', title: 'My Hive wallet', url: 'https://peakd.com', icon: 'wallet' },
      latest(4, 30, 2),
    ],
  },
  {
    id: 'gamer',
    nameKey: 'spotlight.templates.gamer.name',
    nicheKey: 'spotlight.templates.gamer.niche',
    emoji: '🎮',
    theme: {
      bg: { type: 'gradient', color: '#120a24', color2: '#07231e', angle: 150, overlayType: 'none' },
      text: '#eafff4', sectionBg: 'rgba(0,255,150,0.12)', sectionText: '#ffffff',
      radius: 12, buttonStyle: 'soft', font: 'geometric', fontScale: 102, fontStyle: 'bold',
      textShadow: 'soft', avatarPct: 108, avatarShadow: 24, avatarGlow: '#22ff9c', avatarGlowSize: 26,
      avatarAnimType: 'float', avatarAnimSpeed: 4, avatarAnimLoop: true,
      footerText: 'Watch my gameplay on 3Speak',
    },
    sections: [
      { type: 'header', text: 'GG 🎮', size: 'lg', align: 'center' },
      { type: 'link', title: 'YouTube', url: 'https://youtube.com', icon: 'youtube', width: 'half' },
      { type: 'link', title: 'Twitch', url: 'https://twitch.tv', icon: 'twitch', width: 'half' },
      { type: 'link', title: 'Join the Discord', url: 'https://discord.gg', icon: 'discord' },
      latest(6, 85, 2),
    ],
  },
  {
    id: 'photographer',
    nameKey: 'spotlight.templates.photographer.name',
    nicheKey: 'spotlight.templates.photographer.niche',
    emoji: '📷',
    theme: {
      bg: { type: 'gradient', color: '#151515', color2: '#242424', angle: 170, overlayType: 'none' },
      text: '#f2f2f2', sectionBg: 'rgba(255,255,255,0.07)', sectionText: '#f2f2f2',
      radius: 4, buttonStyle: 'outline', font: 'elegant', fontScale: 104, fontStyle: 'normal',
      textShadow: 'none', avatarPct: 96, avatarShadow: 40, avatarGlow: null,
      footerText: 'My films on 3Speak',
    },
    sections: [
      { type: 'header', text: 'Portfolio', size: 'md', align: 'center' },
      { type: 'image', src: uns('photo-1470071459604-3b5ec3a7fe05'), alt: 'Featured work' },
      { type: 'link', title: 'Instagram', url: 'https://instagram.com', icon: 'instagram', width: 'half' },
      { type: 'link', title: 'Prints', url: 'https://example.com', icon: 'image', width: 'half' },
    ],
  },
  {
    id: 'podcaster',
    nameKey: 'spotlight.templates.podcaster.name',
    nicheKey: 'spotlight.templates.podcaster.niche',
    emoji: '🎙️',
    theme: {
      bg: { type: 'gradient', color: '#2a1b4a', color2: '#b8452e', angle: 155, overlayType: 'none' },
      text: '#fff4ea', sectionBg: 'rgba(255,255,255,0.12)', sectionText: '#fff4ea',
      radius: 22, buttonStyle: 'soft', font: 'rounded', fontScale: 102, fontStyle: 'normal',
      textShadow: 'soft', avatarPct: 104, avatarShadow: 26, avatarGlow: null,
      avatarAnimType: 'sway', avatarAnimSpeed: 3, avatarAnimLoop: true,
      footerText: 'Listen & watch on 3Speak',
    },
    sections: [
      { type: 'header', text: 'New episode every week 🎧', size: 'md', align: 'center' },
      { type: 'link', title: 'Spotify', url: 'https://open.spotify.com', icon: 'spotify', width: 'half' },
      { type: 'link', title: 'Apple Podcasts', url: 'https://podcasts.apple.com', icon: 'podcast', width: 'half' },
      latest(3, 55, 1),
    ],
  },
  {
    id: 'fitness',
    nameKey: 'spotlight.templates.fitness.name',
    nicheKey: 'spotlight.templates.fitness.niche',
    emoji: '💪',
    theme: {
      bg: { type: 'gradient', color: '#ff4d2e', color2: '#ffb300', angle: 145, overlayType: 'none' },
      text: '#1a0f00', sectionBg: 'rgba(0,0,0,0.16)', sectionText: '#fff8ef',
      radius: 14, buttonStyle: 'fill', font: 'condensed', fontScale: 108, fontStyle: 'bold',
      textShadow: 'none', avatarPct: 112, avatarShadow: 34, avatarGlow: null,
      footerText: 'Train with me on 3Speak',
    },
    sections: [
      { type: 'header', text: 'NO EXCUSES', size: 'lg', align: 'center' },
      { type: 'link', title: 'Book a session', url: 'https://example.com', icon: 'calendar' },
      { type: 'link', title: 'Free program', url: 'https://example.com', icon: 'download' },
      latest(3, 50, 1),
    ],
  },
  {
    id: 'writer',
    nameKey: 'spotlight.templates.writer.name',
    nicheKey: 'spotlight.templates.writer.niche',
    emoji: '✍️',
    theme: {
      bg: { type: 'gradient', color: '#f6f0e2', color2: '#e7dcc4', angle: 165, overlayType: 'none' },
      text: '#2a2216', sectionBg: 'rgba(42,34,22,0.07)', sectionText: '#2a2216',
      radius: 8, buttonStyle: 'soft', font: 'palatino', fontScale: 104, fontStyle: 'normal',
      textShadow: 'none', avatarPct: 96, avatarShadow: 16, avatarGlow: null,
      footerText: 'My video essays on 3Speak',
    },
    sections: [
      { type: 'header', text: 'Words & ideas', size: 'md', align: 'center' },
      latest(4, 28, 1),
      { type: 'link', title: 'Newsletter', url: 'https://example.com', icon: 'rss' },
    ],
  },
  {
    id: 'chef',
    nameKey: 'spotlight.templates.chef.name',
    nicheKey: 'spotlight.templates.chef.niche',
    emoji: '🍳',
    theme: {
      bg: { type: 'image', image: uns('photo-1504674900247-0877df9cc836'), overlayType: 'gradient', overlayColor: '#1a0e06', overlayColor2: '#3a1d0a', overlayAngle: 160, overlayOpacity: 62 },
      text: '#fff3e6', sectionBg: 'rgba(255,255,255,0.14)', sectionText: '#fff3e6',
      radius: 16, buttonStyle: 'soft', font: 'elegant', fontScale: 104, fontStyle: 'normal',
      textShadow: 'soft', avatarPct: 104, avatarShadow: 30, avatarGlow: null,
      footerText: 'Cook along on 3Speak',
    },
    sections: [
      { type: 'header', text: "Today's menu", size: 'md', align: 'center' },
      { type: 'link', title: 'Recipes', url: 'https://example.com', icon: 'book', width: 'half' },
      { type: 'link', title: 'Instagram', url: 'https://instagram.com', icon: 'instagram', width: 'half' },
      latest(4, 90, 2),
    ],
  },
  {
    id: 'travel',
    nameKey: 'spotlight.templates.travel.name',
    nicheKey: 'spotlight.templates.travel.niche',
    emoji: '🏔️',
    theme: {
      bg: { type: 'image', image: uns('photo-1506905925346-21bda4d32df4'), overlayType: 'gradient', overlayColor: '#06231f', overlayColor2: '#0a3348', overlayAngle: 170, overlayOpacity: 55 },
      text: '#eefbff', sectionBg: 'rgba(255,255,255,0.15)', sectionText: '#eefbff',
      radius: 18, buttonStyle: 'soft', font: 'humanist', fontScale: 102, fontStyle: 'normal',
      textShadow: 'soft', avatarPct: 104, avatarShadow: 28, avatarGlow: null,
      avatarAnimType: 'float', avatarAnimSpeed: 3, avatarAnimLoop: true,
      footerText: 'My travel films on 3Speak',
    },
    sections: [
      { type: 'header', text: 'Chasing horizons 🌍', size: 'md', align: 'center' },
      latest(6, 65, 2),
      { type: 'link', title: 'Instagram', url: 'https://instagram.com', icon: 'instagram' },
    ],
  },
  {
    id: 'business',
    nameKey: 'spotlight.templates.business.name',
    nicheKey: 'spotlight.templates.business.niche',
    emoji: '💼',
    theme: {
      bg: { type: 'gradient', color: '#0f172a', color2: '#1e293b', angle: 160, overlayType: 'none' },
      text: '#eef2f9', sectionBg: 'rgba(120,160,255,0.12)', sectionText: '#eef2f9',
      radius: 10, buttonStyle: 'soft', font: 'grotesk', fontScale: 100, fontStyle: 'normal',
      textShadow: 'none', avatarPct: 98, avatarShadow: 24, avatarGlow: null,
      footerText: 'My talks on 3Speak',
    },
    sections: [
      { type: 'header', text: 'Let’s connect', size: 'md', align: 'center' },
      { type: 'link', title: 'LinkedIn', url: 'https://linkedin.com', icon: 'linkedin', width: 'half' },
      { type: 'link', title: 'Email', url: 'mailto:you@example.com', icon: 'email', width: 'half' },
      { type: 'link', title: 'Book a call', url: 'https://example.com', icon: 'calendar' },
    ],
  },
  {
    id: 'artist',
    nameKey: 'spotlight.templates.artist.name',
    nicheKey: 'spotlight.templates.artist.niche',
    emoji: '🎨',
    theme: {
      bg: { type: 'gradient', color: '#ff6ec4', color2: '#7873f5', angle: 135, overlayType: 'none' },
      text: '#241033', sectionBg: 'rgba(255,255,255,0.22)', sectionText: '#241033',
      radius: 24, buttonStyle: 'soft', font: 'marker', fontScale: 110, fontStyle: 'normal',
      textShadow: 'none', avatarPct: 108, avatarShadow: 22, avatarGlow: '#ffffff', avatarGlowSize: 18,
      avatarAnimType: 'wobble', avatarAnimSpeed: 5, avatarAnimLoop: true,
      footerText: 'My art on 3Speak',
    },
    sections: [
      { type: 'header', text: 'Make something ✨', size: 'lg', align: 'center' },
      { type: 'link', title: 'Shop prints', url: 'https://example.com', icon: 'bag', width: 'half' },
      { type: 'link', title: 'Commissions', url: 'https://example.com', icon: 'palette', width: 'half' },
      latest(4, 80, 2),
    ],
  },
  {
    id: 'ocean',
    nameKey: 'spotlight.templates.ocean.name',
    nicheKey: 'spotlight.templates.ocean.niche',
    emoji: '🌊',
    theme: {
      bg: { type: 'image', image: uns('photo-1507525428034-b723cf961d3e'), overlayType: 'gradient', overlayColor: '#04263a', overlayColor2: '#0a4a5c', overlayAngle: 175, overlayOpacity: 50 },
      text: '#f0fbff', sectionBg: 'rgba(255,255,255,0.16)', sectionText: '#f0fbff',
      radius: 20, buttonStyle: 'soft', font: 'humanist', fontScale: 102, fontStyle: 'normal',
      textShadow: 'soft', avatarPct: 104, avatarShadow: 26, avatarGlow: null,
      avatarAnimType: 'breathe', avatarAnimSpeed: 3, avatarAnimLoop: true,
      footerText: 'Good vibes on 3Speak',
    },
    sections: [
      { type: 'header', text: 'Take it easy 🌴', size: 'md', align: 'center' },
      { type: 'link', title: 'Instagram', url: 'https://instagram.com', icon: 'instagram' },
      latest(3, 60, 1),
    ],
  },
  {
    id: 'musician',
    nameKey: 'spotlight.templates.musician.name',
    nicheKey: 'spotlight.templates.musician.niche',
    emoji: '🎵',
    theme: {
      bg: { type: 'gradient', color: '#1a0b2e', color2: '#4a1259', angle: 155, overlayType: 'none' },
      text: '#f7ecff', sectionBg: 'rgba(255,255,255,0.12)', sectionText: '#f7ecff',
      radius: 14, buttonStyle: 'fill', font: 'display', fontScale: 106, fontStyle: 'normal',
      textShadow: 'strong', avatarPct: 108, avatarShadow: 20, avatarGlow: '#c04bff', avatarGlowSize: 32,
      avatarAnimType: 'pulse', avatarAnimSpeed: 4, avatarAnimLoop: true,
      footerText: 'Watch my music videos on 3Speak',
    },
    sections: [
      { type: 'header', text: 'Now playing 🎧', size: 'lg', align: 'center' },
      { type: 'link', title: 'Spotify', url: 'https://open.spotify.com', icon: 'spotify', width: 'half' },
      { type: 'link', title: 'Apple Music', url: 'https://music.apple.com', icon: 'apple', width: 'half' },
      { type: 'link', title: 'SoundCloud', url: 'https://soundcloud.com', icon: 'soundcloud' },
      latest(4, 75, 2),
    ],
  },
  {
    id: 'developer',
    nameKey: 'spotlight.templates.developer.name',
    nicheKey: 'spotlight.templates.developer.niche',
    emoji: '💻',
    theme: {
      bg: { type: 'gradient', color: '#0d1117', color2: '#161b22', angle: 165, overlayType: 'none' },
      text: '#c9d1d9', sectionBg: 'rgba(63,185,80,0.14)', sectionText: '#e6edf3',
      radius: 8, buttonStyle: 'outline', font: 'mono', fontScale: 96, fontStyle: 'normal',
      textShadow: 'none', avatarPct: 100, avatarShadow: 24, avatarGlow: '#3fb950', avatarGlowSize: 20,
      footerText: 'My talks & demos on 3Speak',
    },
    sections: [
      { type: 'header', text: '$ whoami', size: 'md', align: 'center' },
      { type: 'link', title: 'GitHub', url: 'https://github.com', icon: 'github', width: 'half' },
      { type: 'link', title: 'X / Twitter', url: 'https://x.com', icon: 'x', width: 'half' },
      { type: 'link', title: 'My blog', url: 'https://example.com', icon: 'code' },
      latest(4, 35, 1),
    ],
  },
  {
    id: 'sports',
    nameKey: 'spotlight.templates.sports.name',
    nicheKey: 'spotlight.templates.sports.niche',
    emoji: '🏅',
    theme: {
      bg: { type: 'gradient', color: '#0b3d2e', color2: '#0a6e3f', angle: 150, overlayType: 'none' },
      text: '#eafff3', sectionBg: 'rgba(255,255,255,0.14)', sectionText: '#ffffff',
      radius: 12, buttonStyle: 'fill', font: 'condensed', fontScale: 108, fontStyle: 'bold',
      textShadow: 'soft', avatarPct: 110, avatarShadow: 30, avatarGlow: null,
      avatarAnimType: 'bounce', avatarAnimSpeed: 5, avatarAnimLoop: true,
      footerText: 'Watch my highlights on 3Speak',
    },
    sections: [
      { type: 'header', text: 'GAME DAY 🏆', size: 'lg', align: 'center' },
      { type: 'link', title: 'Schedule', url: 'https://example.com', icon: 'calendar', width: 'half' },
      { type: 'link', title: 'Instagram', url: 'https://instagram.com', icon: 'instagram', width: 'half' },
      latest(6, 60, 2),
    ],
  },
];
