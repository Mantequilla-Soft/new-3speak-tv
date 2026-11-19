// 🤖 Automations (beta, Pro): the catalog of what a workflow can be built from.
//
// A workflow is a Sequential Workflow Designer definition
// (https://github.com/nocode-js/sequential-workflow-designer): the editor in the
// browser draws it, sequential-workflow-machine runs it here (automations.cjs).
// Neither knows anything about 3Speak. What 3Speak adds is this file:
//
//   EVENTS  what starts a workflow (the definition's `properties.event`), and the
//           fields each one hands to templates and if-steps
//   TASKS   the steps that do something, with their properties
//   IF      the one branching step: a field, an operator and a value
//
// The browser gets the catalog from GET /api/automations and builds the toolbox
// and the property forms from it; labels come from its own locales
// (src/locales/<lang>/automations.json, keyed by these ids). validateDefinition()
// is the gate every saved workflow passes, so the editor can never store
// something the runner would not understand.

// ── Events ───────────────────────────────────────────────────────────────────
// Each event has:
//   source        where the watcher finds it (automations.cjs): the creator's
//                 posts, their wallet history, their snap polls (the Hive Open
//                 Polls API), or the polls of their streams (the live server)
//   media         what it carries: a video, an audio, a stream, or nothing
//   post          whether there is a post to answer under: always, maybe (a tip
//                 names the video it was for only when the memo links it), none
//   fields        what if-steps can check
//   placeholders  what templates can use
// Field types: text, tags (a list), number (seconds, or an amount), choice.
const FIELD = {
  title: { type: 'text' },
  description: { type: 'text' },
  tags: { type: 'tags' },
  duration: { type: 'number', unit: 'seconds' },
  community: { type: 'text' },
  url: { type: 'text' },
  platform: { type: 'choice', options: ['youtube', 'tiktok', 'instagram', 'rumble', 'bitchute', 'rss'] },
  kind: { type: 'choice', options: ['video', 'short'] },
  audioType: { type: 'choice', options: ['podcast', 'interview', 'audiobook', 'song', 'voice_message'] },
  imported: { type: 'choice', options: ['yes', 'no'] },
  from: { type: 'text' },
  amount: { type: 'number', unit: 'amount' },
  asset: { type: 'choice', options: ['HIVE', 'HBD'] },
  message: { type: 'text' },
  via: { type: 'choice', options: ['hive', 'lightning'] },
  boostKind: { type: 'choice', options: ['post', 'stream'] },
  self: { type: 'choice', options: ['yes', 'no'] },
  question: { type: 'text' },
  winner: { type: 'text' },
  votes: { type: 'number', unit: 'count' },
  author: { type: 'text' },
  postKind: { type: 'choice', options: ['video', 'short', 'audio', 'podcast', 'snap', 'stream', 'post'] },
}

const POST_PLACEHOLDERS = ['title', 'description', 'url', 'author', 'tags', 'platform']
const MONEY_PLACEHOLDERS = ['from', 'amount', 'message', 'url', 'author']
const POLL_PLACEHOLDERS = ['question', 'results', 'winner', 'votes', 'url', 'author']

const EVENTS = {
  video_published: { source: 'posts', media: 'video', post: 'always', fields: ['title', 'description', 'tags', 'duration', 'community', 'url'], placeholders: POST_PLACEHOLDERS },
  short_published: { source: 'posts', media: 'video', post: 'always', fields: ['description', 'tags', 'duration', 'url'], placeholders: POST_PLACEHOLDERS },
  video_imported: { source: 'posts', media: 'video', post: 'always', fields: ['title', 'description', 'tags', 'duration', 'platform', 'kind', 'url'], placeholders: POST_PLACEHOLDERS },
  podcast_published: { source: 'posts', media: 'audio', post: 'always', fields: ['title', 'description', 'tags', 'duration', 'audioType', 'imported', 'url'], placeholders: POST_PLACEHOLDERS },
  audio_published: { source: 'posts', media: 'audio', post: 'always', fields: ['title', 'description', 'tags', 'duration', 'audioType', 'imported', 'url'], placeholders: POST_PLACEHOLDERS },
  stream_started: { source: 'posts', media: 'stream', post: 'always', fields: ['title', 'description', 'tags', 'url'], placeholders: POST_PLACEHOLDERS },
  tip_received: { source: 'history', media: 'none', post: 'maybe', fields: ['from', 'amount', 'asset', 'message', 'via', 'url'], placeholders: MONEY_PLACEHOLDERS },
  boost_received: { source: 'history', media: 'none', post: 'maybe', fields: ['from', 'amount', 'asset', 'message', 'boostKind', 'url'], placeholders: MONEY_PLACEHOLDERS },
  power_up: { source: 'history', media: 'none', post: 'none', fields: ['from', 'amount', 'self'], placeholders: ['from', 'amount', 'author'] },
  poll_ended: { source: 'polls', media: 'none', post: 'always', fields: ['question', 'winner', 'votes'], placeholders: POLL_PLACEHOLDERS },
  stream_poll_ended: { source: 'stream_polls', media: 'stream', post: 'always', fields: ['question', 'winner', 'votes'], placeholders: POLL_PLACEHOLDERS },
  // Posts of other accounts the creator lists in the workflow (properties.accounts):
  // for voting, reblogging or sharing them.
  someone_posted: { source: 'watched', media: 'none', post: 'always', accounts: true, fields: ['author', 'postKind', 'title', 'description', 'tags', 'url'], placeholders: POST_PLACEHOLDERS },
}
const eventsWhere = (test) => Object.keys(EVENTS).filter((id) => test(EVENTS[id], id))

// ── Tasks ────────────────────────────────────────────────────────────────────
// Property types: template (text with {placeholders}), text, tags, number,
// boolean, choice (one of `options`). `events`: the events a task fits (all
// when absent). `max`: how often it may appear in one workflow.
const PLACEHOLDERS = [...new Set([...POST_PLACEHOLDERS, ...MONEY_PLACEHOLDERS, ...POLL_PLACEHOLDERS])]
const TEMPLATE_MAX = 1000
const VIDEO_EVENTS = ['video_published', 'video_imported']

const TASKS = {
  post_snap: {
    icon: 'bolt',
    props: {
      text: { type: 'template', required: true, max: TEMPLATE_MAX, default: '{title}\n\n{url}' },
      tags: { type: 'tags', max: 8, default: [] },
    },
  },
  post_short: {
    icon: 'smart_display',
    events: VIDEO_EVENTS,
    max: 1,
    props: {
      start: { type: 'number', min: 0, max: 36000, default: 0 },
      length: { type: 'number', min: 5, max: 60, default: 30 },
      vertical: { type: 'boolean', default: true },
      caption: { type: 'template', required: true, max: 240, default: '{title} ▶ {url}' },
      tags: { type: 'tags', max: 8, default: [] },
    },
  },
  post_audio: {
    icon: 'headphones',
    events: VIDEO_EVENTS,
    max: 1,
    props: {
      title: { type: 'template', required: true, max: 250, default: '{title}' },
      audioType: { type: 'choice', options: FIELD.audioType.options, default: 'podcast' },
      tags: { type: 'tags', max: 8, default: [] },
    },
  },
  post_video: {
    icon: 'movie',
    events: ['podcast_published', 'audio_published'],
    max: 1,
    props: {
      title: { type: 'template', required: true, max: 250, default: '{title}' },
      tags: { type: 'tags', max: 8, default: [] },
    },
  },
  post_comment: {
    icon: 'chat_bubble',
    events: eventsWhere((e) => e.post !== 'none'),
    props: {
      text: { type: 'template', required: true, max: TEMPLATE_MAX, default: '' },
    },
  },
  upvote_post: {
    icon: 'thumb_up',
    events: ['someone_posted'],
    max: 1,
    props: {
      weight: { type: 'number', min: 1, max: 100, default: 50 },
    },
  },
  reblog: {
    icon: 'repeat',
    events: ['someone_posted'],
    max: 1,
    props: {},
  },
  upvote_sender: {
    icon: 'thumb_up',
    events: eventsWhere((e) => e.fields.includes('from')),
    max: 1,
    props: {
      weight: { type: 'number', min: 1, max: 100, default: 50 },
    },
  },
  send_discord: {
    icon: 'forum',
    max: 3,
    props: {
      webhook: { type: 'text', required: true, pattern: 'discord_webhook', default: '' },
      text: { type: 'template', required: true, max: 2000, default: '{title}\n{url}' },
    },
  },
}

// ── If ───────────────────────────────────────────────────────────────────────
const IF_TYPE = 'if'
const OPERATORS = {
  text: ['contains', 'not_contains', 'equals', 'starts_with'],
  tags: ['has_tag', 'not_has_tag'],
  number: ['gt', 'lt'],
  choice: ['is', 'is_not'],
}
const BRANCHES = ['yes', 'no']

const LIMITS = { steps: 12, depth: 3, name: 80, value: 200, accounts: 20 }
const ACCOUNT_RE = /^[a-z][a-z0-9.-]{2,15}$/
const DISCORD_WEBHOOK_RE = /^https:\/\/(?:canary\.|ptb\.)?(?:discord|discordapp)\.com\/api\/webhooks\/\d{5,25}\/[\w-]{20,100}$/
const TAG_RE = /^[a-z0-9][a-z0-9-]{1,23}$/

/** The catalog as the browser gets it. */
function publicCatalog() {
  return {
    events: Object.fromEntries(Object.entries(EVENTS).map(([id, e]) => [id, {
      media: e.media, post: e.post, accounts: !!e.accounts, placeholders: e.placeholders, fields: e.fields.map((f) => ({ id: f, ...FIELD[f] })),
    }])),
    tasks: TASKS,
    operators: OPERATORS,
    branches: BRANCHES,
    placeholders: PLACEHOLDERS,
    limits: LIMITS,
  }
}

const taskFits = (type, event) => !TASKS[type]?.events || TASKS[type].events.includes(event)

function cleanTags(list) {
  return [...new Set((Array.isArray(list) ? list : [])
    .map((t) => String(t).toLowerCase().replace(/^#/, '').trim())
    .filter((t) => TAG_RE.test(t)))]
}

/** One property's value, checked and normalised; { error } when it cannot be used. */
function cleanProp(spec, value) {
  switch (spec.type) {
    case 'template':
    case 'text': {
      const v = String(value ?? '').trim()
      if (spec.required && !v) return { error: 'required' }
      if (v.length > (spec.max || LIMITS.value * 5)) return { error: 'too_long' }
      if (spec.pattern === 'discord_webhook' && v && !DISCORD_WEBHOOK_RE.test(v)) return { error: 'bad_webhook' }
      return { value: v }
    }
    case 'tags': {
      const v = cleanTags(value)
      if (v.length > spec.max) return { error: 'over_limit' }
      return { value: v }
    }
    case 'number': {
      const v = Number(value ?? spec.default)
      if (!Number.isFinite(v) || v < spec.min || v > spec.max) return { error: 'out_of_range' }
      return { value: Math.round(v) }
    }
    case 'boolean':
      return { value: value === undefined ? !!spec.default : value === true }
    case 'choice': {
      const v = value === undefined ? spec.default : String(value)
      return spec.options.includes(v) ? { value: v } : { error: 'bad_value' }
    }
    default:
      return { error: 'unknown' }
  }
}

/** An if-step's condition, checked against the workflow's event. */
function cleanCondition(props, event) {
  const fieldId = String(props?.field || '')
  if (!EVENTS[event].fields.includes(fieldId)) return { error: 'bad_field' }
  const field = FIELD[fieldId]
  const op = String(props?.op || '')
  if (!OPERATORS[field.type].includes(op)) return { error: 'bad_operator' }
  let value = String(props?.value ?? '').trim()
  if (value.length > LIMITS.value) return { error: 'too_long' }
  if (field.type === 'number') {
    // Seconds and counts are whole; amounts may have up to 3 decimals.
    if (!/^\d{1,6}(\.\d{1,3})?$/.test(value)) return { error: 'bad_value' }
    value = String(Number(value))
  } else if (field.type === 'choice') {
    if (!field.options.includes(value)) return { error: 'bad_value' }
  } else if (field.type === 'tags') {
    value = value.toLowerCase().replace(/^#/, '')
    if (!TAG_RE.test(value)) return { error: 'bad_value' }
  } else if (!value) {
    return { error: 'bad_value' }
  }
  return { value: { field: fieldId, op, value } }
}

/**
 * A definition from the browser → the one that is stored, or { error, stepId? }.
 * Only what the catalog knows survives: ids, types, names and properties are
 * rebuilt, nothing else from the request is kept.
 */
function validateDefinition(def) {
  const event = String(def?.properties?.event || '')
  if (!EVENTS[event]) return { error: 'no_event' }
  let count = 0
  const perType = {}
  const ids = new Set()

  function walk(sequence, depth) {
    if (!Array.isArray(sequence)) return { error: 'bad_sequence' }
    const out = []
    for (const step of sequence) {
      count += 1
      if (count > LIMITS.steps) return { error: 'too_many_steps' }
      const id = String(step?.id || '')
      if (!/^[\w-]{1,40}$/.test(id) || ids.has(id)) return { error: 'bad_id' }
      ids.add(id)
      const name = String(step?.name || '').trim().slice(0, LIMITS.name)
      if (step.type === IF_TYPE && step.componentType === 'switch') {
        if (depth >= LIMITS.depth) return { error: 'too_deep', stepId: id }
        const cond = cleanCondition(step.properties, event)
        if (cond.error) return { error: cond.error, stepId: id }
        const branches = {}
        for (const b of BRANCHES) {
          const inner = walk(step.branches?.[b] || [], depth + 1)
          if (inner.error) return inner
          branches[b] = inner.sequence
        }
        out.push({ id, componentType: 'switch', type: IF_TYPE, name, properties: cond.value, branches })
        continue
      }
      const task = TASKS[step?.type]
      if (!task || step.componentType !== 'task') return { error: 'unknown_step', stepId: id }
      if (!taskFits(step.type, event)) return { error: 'task_not_for_event', stepId: id }
      perType[step.type] = (perType[step.type] || 0) + 1
      if (task.max && perType[step.type] > task.max) return { error: 'too_many_of_type', stepId: id }
      const properties = {}
      for (const [key, spec] of Object.entries(task.props)) {
        const r = cleanProp(spec, step.properties?.[key])
        if (r.error) return { error: r.error, stepId: id, property: key }
        properties[key] = r.value
      }
      out.push({ id, componentType: 'task', type: step.type, name, properties })
    }
    return { sequence: out }
  }

  // An event about other accounts needs them listed (1 to LIMITS.accounts).
  let accounts
  if (EVENTS[event].accounts) {
    accounts = [...new Set((Array.isArray(def.properties.accounts) ? def.properties.accounts : [])
      .map((a) => String(a).trim().toLowerCase().replace(/^@/, '')).filter(Boolean))]
    if (!accounts.length) return { error: 'no_accounts' }
    if (accounts.length > LIMITS.accounts) return { error: 'too_many_accounts' }
    if (!accounts.every((a) => ACCOUNT_RE.test(a))) return { error: 'bad_account' }
  }
  const r = walk(def.sequence || [], 0)
  if (r.error) return r
  if (!r.sequence.length) return { error: 'empty' }
  return { definition: { properties: { event, ...(accounts ? { accounts } : {}) }, sequence: r.sequence } }
}

/** Does the condition hold for this event's values? */
function testCondition({ field, op, value }, values) {
  const got = values[field]
  switch (op) {
    case 'contains': return String(got || '').toLowerCase().includes(value.toLowerCase())
    case 'not_contains': return !String(got || '').toLowerCase().includes(value.toLowerCase())
    case 'equals': return String(got || '').trim().toLowerCase() === value.toLowerCase()
    case 'starts_with': return String(got || '').trim().toLowerCase().startsWith(value.toLowerCase())
    case 'has_tag': return (got || []).includes(value)
    case 'not_has_tag': return !(got || []).includes(value)
    case 'gt': return Number(got || 0) > Number(value)
    case 'lt': return Number(got || 0) < Number(value)
    case 'is': return String(got || '') === value
    case 'is_not': return String(got || '') !== value
    default: return false
  }
}

/** "{title} ▶ {url}" with the event's values; unknown placeholders stay as typed. */
function renderTemplate(tpl, values) {
  return String(tpl || '').replace(/\{(\w+)\}/g, (all, key) => {
    if (!PLACEHOLDERS.includes(key)) return all
    const v = values[key]
    if (Array.isArray(v)) return v.map((t) => `#${t}`).join(' ')
    return v == null ? '' : String(v)
  }).trim()
}

// ── Reading posts ────────────────────────────────────────────────────────────
// A post (bridge.get_account_posts) → { events, values } or null. Runs on every
// new post of a creator with an automation, so it must never throw.
const MARKER = 'threespeak.automation'
const SNAPS_CONTAINERS = new Set(['peak.snaps'])

function parseMeta(post) {
  if (post.json_metadata && typeof post.json_metadata === 'object') return post.json_metadata
  try { return JSON.parse(post.json_metadata || '{}') || {} } catch { return {} }
}

function classifyPost(post, site = 'https://3speak.tv') {
  if (!post?.author || !post?.permlink) return null
  const meta = parseMeta(post)
  // A post an automation made never starts another one (no loops).
  if (meta[MARKER]) return null
  const isReply = !!post.parent_author
  const underSnaps = isReply && SNAPS_CONTAINERS.has(post.parent_author)
  if (isReply && !underSnaps) return null
  const tags = cleanTags(meta.tags || [])
  const image = Array.isArray(meta.image) && typeof meta.image[0] === 'string' ? meta.image[0] : ''
  const base = {
    image,
    title: String(post.title || '').trim(),
    description: '',
    tags,
    author: post.author,
    community: post.category && /^hive-\d+$/.test(post.category) ? post.category : '',
    duration: 0,
    platform: '',
  }
  const imported = meta.imported_from && meta.imported_from.platform ? String(meta.imported_from.platform) : ''
  const ref = `${post.author}/${post.permlink}`

  const audio = meta['threespeak.audio'] || meta.audio
  if (audio && typeof audio === 'object') {
    const audioType = String(audio.type || 'podcast')
    const values = {
      ...base,
      description: firstText(post.body),
      duration: Math.round(Number(meta['threespeak.audio']?.duration) || 0),
      audioType,
      imported: imported ? 'yes' : 'no',
      platform: imported,
      url: `${site}/audio/${ref}`,
      // The audio service's id of the file (the play link in the body), for post_video.
      audioPermlink: (String(post.body || '').match(/audio\.3speak\.tv\/play\?a=([\w-]+)/) || [])[1] || '',
    }
    // A podcast episode is audio too: both kinds of workflow run.
    return { events: ['podcast', 'interview'].includes(audioType) ? ['podcast_published', 'audio_published'] : ['audio_published'], values }
  }

  if (meta.openpodRoom && !isReply) {
    return { events: ['stream_started'], values: { ...base, description: firstText(post.body), url: `${site}/watch?v=${ref}` } }
  }

  const video = meta.video && typeof meta.video === 'object' ? meta.video : null
  if (!video) return null
  const surface = meta['threespeak.video']?.surface
  const isShort = underSnaps || surface === 'shorts'
  const values = {
    ...base,
    description: isShort ? String(post.body || '').split('\n\n---')[0].replace(/^https?:\/\/\S+\s*/, '').trim() : firstText(post.body),
    duration: Math.round(Number(video.info?.duration || meta['threespeak.video']?.duration) || 0),
    url: isShort ? `${site}/shorts?v=${ref}` : `${site}/watch?v=${ref}`,
    kind: isShort ? 'short' : 'video',
  }
  if (imported) return { events: ['video_imported'], values: { ...values, platform: imported } }
  return { events: [isShort ? 'short_published' : 'video_published'], values }
}

// ── Reading other accounts' posts ────────────────────────────────────────────
// A post of a watched account → someone_posted with what kind it is: the 3Speak
// kinds as classifyPost tells them, a text snap (a reply under @peak.snaps), or
// any other top-level post. Replies to anything else are not posts.
const KIND_OF_EVENT = {
  video_published: 'video', video_imported: 'video', short_published: 'short',
  podcast_published: 'podcast', audio_published: 'audio', stream_started: 'stream',
}
function classifyWatched(post, site = 'https://3speak.tv') {
  if (!post?.author || !post?.permlink) return null
  const own = classifyPost(post, site)
  let postKind
  let values
  if (own) {
    postKind = own.values.kind === 'short' && own.events.includes('video_imported') ? 'short' : KIND_OF_EVENT[own.events[0]]
    values = own.values
  } else {
    if (parseMeta(post)[MARKER]) return null
    const underSnaps = !!post.parent_author && SNAPS_CONTAINERS.has(post.parent_author)
    if (post.parent_author && !underSnaps) return null
    postKind = underSnaps ? 'snap' : 'post'
    values = {
      title: String(post.title || '').trim(), description: firstText(post.body), tags: cleanTags(parseMeta(post).tags || []),
      author: post.author, url: `${site}/@${post.author}/${post.permlink}`, platform: '', image: '',
    }
  }
  return { events: ['someone_posted'], values: { ...values, author: post.author, postKind }, post: { author: post.author, permlink: post.permlink } }
}

// ── Reading the wallet history ───────────────────────────────────────────────
// One operation of condenser_api.get_account_history → { events, values, post? }
// or null. Only what came IN counts:
//   a transfer whose memo links a 3Speak video   tip_received (HIVE or HBD,
//     or Lightning: v4v.app converts the sats and keeps the comment and link)
//   the same with #boost                          boost_received on that post
//   "boost payout:<stream>:<tx>" from the live server's escrow
//                                                 boost_received on the stream
//   transfer_to_vesting to the creator            power_up (self: by them)
const LINK_RE = /https:\/\/3speak\.tv\/(?:watch|shorts)\?v=([a-z0-9.-]{3,16})\/([\w-]{1,255})/
const PAYOUT_RE = /^boost payout:([\w-]{1,128}):/

function parseAmount(str) {
  const m = String(str || '').match(/^(\d+(?:\.\d+)?) (HIVE|HBD)$/)
  return m ? { amount: Number(m[1]), asset: m[2] } : null
}

function classifyHistory(op, user, site = 'https://3speak.tv') {
  if (!Array.isArray(op) || !op[1]) return null
  const [type, data] = op
  if (type === 'transfer_to_vesting') {
    if (data.to !== user && !(data.to === '' && data.from === user)) return null
    const a = parseAmount(data.amount)
    if (!a) return null
    return { events: ['power_up'], values: { from: data.from, amount: a.amount, author: user, self: data.from === user ? 'yes' : 'no' } }
  }
  if (type !== 'transfer' || data.to !== user || data.from === user) return null
  const a = parseAmount(data.amount)
  const memo = String(data.memo || '')
  if (!a || memo.startsWith('#')) return null
  const base = { amount: a.amount, asset: a.asset, author: user, title: '' }

  const payout = memo.match(PAYOUT_RE)
  if (payout) {
    return {
      events: ['boost_received'],
      values: { ...base, from: '', message: '', boostKind: 'stream', url: `${site}/watch?v=${user}/${payout[1]}` },
      post: { author: user, permlink: payout[1] },
    }
  }
  const link = memo.match(LINK_RE)
  if (!link) return null
  const lightning = data.from === 'v4vapp'
  // v4v.app: "Converted … for <user> | <comment> <link> #lightningaddress | § … | Thank you…"
  const text = (lightning ? memo.split('|')[1] || '' : memo)
    .replace(LINK_RE, '').replace(/#(boost|stream|lightningaddress)\b/g, '').replace(/\s+/g, ' ').trim().slice(0, 250)
  const values = {
    ...base,
    from: lightning ? '' : data.from,
    message: text,
    via: lightning ? 'lightning' : 'hive',
    url: link[0],
  }
  // A tip for someone else's video (the link names another channel) is still a
  // tip to this creator, but there is no post of theirs to answer under.
  const post = link[1] === user ? { author: link[1], permlink: link[2] } : undefined
  if (/#boost\b/.test(memo)) return { events: ['boost_received'], values: { ...values, boostKind: 'post' }, post }
  if (/#stream\b/.test(memo)) return null
  return { events: ['tip_received'], values, post }
}

// ── Reading polls ────────────────────────────────────────────────────────────
// "Yes: 12 votes (60%)", one line each, most votes first.
function resultLines(options) {
  const total = options.reduce((n, o) => n + o.votes, 0)
  return [...options].sort((a, b) => b.votes - a.votes)
    .map((o) => `${o.label}: ${o.votes} (${total ? Math.round((o.votes / total) * 100) : 0}%)`)
    .join('\n')
}
const winnerOf = (options) => {
  const top = Math.max(0, ...options.map((o) => o.votes))
  return top ? options.filter((o) => o.votes === top).map((o) => o.label).join(' / ') : ''
}

/** A row of the Hive Open Polls API (polls.hivehub.dev /rpc/poll) → poll_ended, once it has ended. */
function classifyPoll(row, site = 'https://3speak.tv') {
  if (!row || row.status !== 'Ended' || !row.author || !row.permlink) return null
  const options = [...(row.poll_choices || [])].sort((a, b) => a.choice_num - b.choice_num)
    .map((c) => ({ label: String(c.choice_text || ''), votes: Number(c.votes?.total_votes) || 0 }))
  return {
    events: ['poll_ended'],
    values: {
      question: String(row.question || '').trim(), results: resultLines(options), winner: winnerOf(options),
      votes: Number(row.poll_stats?.total_voting_accounts_num) || options.reduce((n, o) => n + o.votes, 0),
      author: row.author, url: `${site}/@${row.author}/${row.permlink}`, title: '',
    },
    post: { author: row.author, permlink: row.permlink },
  }
}

/** A poll of the live server (GET /rooms/:room/polls) → stream_poll_ended, once closed or resolved. */
function classifyStreamPoll(view, user, site = 'https://3speak.tv') {
  if (!view || !['closed', 'resolved'].includes(view.status) || !view.room) return null
  const options = (view.options || []).map((o) => ({ label: String(o.label || ''), votes: Number(o.votes) || 0 }))
  // A prediction is decided by the host: its winner is the option they picked.
  const winner = view.kind === 'prediction' && Number.isInteger(view.winner) && options[view.winner]
    ? options[view.winner].label
    : winnerOf(options)
  return {
    events: ['stream_poll_ended'],
    values: {
      question: String(view.question || '').trim(), results: resultLines(options), winner,
      votes: Number(view.total) || 0, author: user, url: `${site}/watch?v=${user}/${view.room}`, title: '',
    },
    post: { author: user, permlink: view.room },
  }
}

// The post's own words: the body without links, embeds, images and the
// "Watch on 3speak.tv" footer, cut to a few hundred characters.
function firstText(body) {
  return String(body || '')
    .split('\n\n---')[0]
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/(^|\s)#{1,6}\s/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500)
}

module.exports = {
  EVENTS, TASKS, FIELD, OPERATORS, BRANCHES, IF_TYPE, LIMITS, PLACEHOLDERS, MARKER, DISCORD_WEBHOOK_RE,
  publicCatalog, validateDefinition, testCondition, renderTemplate, classifyPost, classifyHistory, classifyPoll, classifyStreamPoll,
  classifyWatched, taskFits, cleanTags, parseAmount,
}
