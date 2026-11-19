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
// `media`: what the post carries, which decides the tasks that fit.
// Fields: text, tags (a list), number (seconds), choice (one of `options`).
const FIELD = {
  title: { type: 'text' },
  description: { type: 'text' },
  tags: { type: 'tags' },
  duration: { type: 'number' },
  community: { type: 'text' },
  url: { type: 'text' },
  platform: { type: 'choice', options: ['youtube', 'tiktok', 'instagram', 'rumble', 'bitchute', 'rss'] },
  kind: { type: 'choice', options: ['video', 'short'] },
  audioType: { type: 'choice', options: ['podcast', 'interview', 'audiobook', 'song', 'voice_message'] },
  imported: { type: 'choice', options: ['yes', 'no'] },
}

const EVENTS = {
  video_published: { media: 'video', fields: ['title', 'description', 'tags', 'duration', 'community', 'url'] },
  short_published: { media: 'video', fields: ['description', 'tags', 'duration', 'url'] },
  video_imported: { media: 'video', fields: ['title', 'description', 'tags', 'duration', 'platform', 'kind', 'url'] },
  podcast_published: { media: 'audio', fields: ['title', 'description', 'tags', 'duration', 'audioType', 'imported', 'url'] },
  audio_published: { media: 'audio', fields: ['title', 'description', 'tags', 'duration', 'audioType', 'imported', 'url'] },
  stream_started: { media: 'stream', fields: ['title', 'description', 'tags', 'url'] },
}

// ── Tasks ────────────────────────────────────────────────────────────────────
// Property types: template (text with {placeholders}), text, tags, number, boolean.
// `events`: the events a task fits (all when absent). `max`: how often it may
// appear in one workflow.
const PLACEHOLDERS = ['title', 'description', 'url', 'author', 'tags', 'platform']
const TEMPLATE_MAX = 1000

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
    events: ['video_published', 'video_imported'],
    max: 1,
    props: {
      start: { type: 'number', min: 0, max: 36000, default: 0 },
      length: { type: 'number', min: 5, max: 60, default: 30 },
      vertical: { type: 'boolean', default: true },
      caption: { type: 'template', required: true, max: 240, default: '{title} ▶ {url}' },
      tags: { type: 'tags', max: 8, default: [] },
    },
  },
  post_comment: {
    icon: 'chat_bubble',
    props: {
      text: { type: 'template', required: true, max: TEMPLATE_MAX, default: '' },
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

const LIMITS = { steps: 12, depth: 3, name: 80, value: 200 }
const DISCORD_WEBHOOK_RE = /^https:\/\/(?:canary\.|ptb\.)?(?:discord|discordapp)\.com\/api\/webhooks\/\d{5,25}\/[\w-]{20,100}$/
const TAG_RE = /^[a-z0-9][a-z0-9-]{1,23}$/

/** The catalog as the browser gets it. */
function publicCatalog() {
  return {
    events: Object.fromEntries(Object.entries(EVENTS).map(([id, e]) => [id, { media: e.media, fields: e.fields.map((f) => ({ id: f, ...FIELD[f] })) }])),
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
    if (!/^\d{1,6}$/.test(value)) return { error: 'bad_value' }
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

  const r = walk(def.sequence || [], 0)
  if (r.error) return r
  if (!r.sequence.length) return { error: 'empty' }
  return { definition: { properties: { event }, sequence: r.sequence } }
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
  const base = {
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
  publicCatalog, validateDefinition, testCondition, renderTemplate, classifyPost, taskFits, cleanTags,
}
