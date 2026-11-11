// The icon chip on a notification's avatar (designs 26a, 41d): which Material
// Symbol stands for each Hive notification type, and its tone. Accent = money
// and votes, cyan = people and conversation, muted = everything else.
const TYPE_ICONS = {
  reply: ['chat_bubble', 'cyan'],
  reply_comment: ['chat_bubble', 'cyan'],
  mention: ['alternate_email', 'cyan'],
  vote: ['arrow_upward', 'accent'],
  follow: ['person_add', 'cyan'],
  reblog: ['repeat', 'cyan'],
  transfer: ['payments', 'accent'],
  delegate_vests: ['bolt', 'accent'],
  receive_vesting: ['bolt', 'accent'],
  powerdown: ['trending_down', 'muted'],
  subscribe: ['group_add', 'cyan'],
  pin_post: ['push_pin', 'cyan'],
  unpin_post: ['push_pin', 'muted'],
  story: ['auto_stories', 'accent'],
  podcast: ['podcasts', 'cyan'],
};

/** { icon, tone } for a notification type; a plain bell for anything unknown. */
export function notifTypeIcon(type) {
  const [icon, tone] = TYPE_ICONS[type] || ['notifications', 'muted'];
  return { icon, tone };
}
