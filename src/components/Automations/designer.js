// 🤖 Automations: what the workflow editor (Sequential Workflow Designer) needs
// from 3Speak, built from the catalog the server sends (server/automation-catalog.cjs):
// the toolbox, new steps, step icons, and the same checks the server makes, so a
// step that would be refused shows its warning badge before anyone saves.

export const IF_TYPE = 'if';
export const DEFAULT_EVENT = 'video_published';

// Material Symbols glyphs (24px grid), white on a rounded tile: red for tasks,
// cyan for if-steps, as in the rest of 3Speak (tasks are actions, ifs are choices).
const GLYPHS = {
  bolt: 'M11 21h-1l1-7H7.5c-.58 0-.57-.32-.38-.66.19-.34.05-.08.07-.12C8.48 10.94 10.42 7.54 13 3h1l-1 7h3.5c.49 0 .56.33.47.51l-.07.15C12.96 17.55 11 21 11 21z',
  smart_display: 'M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zM9.5 16.5v-9l7 4.5-7 4.5z',
  chat_bubble: 'M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z',
  forum: 'M21 6h-2v9H6v2c0 .55.45 1 1 1h11l4 4V7c0-.55-.45-1-1-1zm-4 6V3c0-.55-.45-1-1-1H3c-.55 0-1 .45-1 1v14l4-4h10c.55 0 1-.45 1-1z',
  record_voice_over: 'M9 13c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4zm6.08-7.95c.84 1.18.84 2.71 0 3.89l1.68 1.69c2.02-2.02 2.02-5.07 0-7.27l-1.68 1.69zM20.07 2l-1.63 1.63c2.77 3.02 2.77 7.56 0 10.74L20.07 16c3.9-3.89 3.91-9.95 0-14z',
  headphones: 'M12 3a9 9 0 0 0-9 9v7c0 1.1.9 2 2 2h4v-8H5v-1a7 7 0 0 1 14 0v1h-4v8h4c1.1 0 2-.9 2-2v-7a9 9 0 0 0-9-9z',
  movie: 'M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4h-4z',
  thumb_up: 'M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z',
  repeat: 'M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z',
  call_split: 'M14 4l2.29 2.29-2.88 2.88 1.42 1.42 2.88-2.88L20 10V4zm-4 0H4v6l2.29-2.29 4.71 4.7V20h2v-8.41l-5.29-5.3z',
};
const TILE = { task: '#e53935', switch: '#0891b2' };

function iconUrl(glyph, color) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="${color}"/>`
    + `<path transform="translate(4.2 4.2) scale(.65)" fill="#fff" d="${GLYPHS[glyph] || GLYPHS.bolt}"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** StepsConfiguration.iconUrlProvider */
export function stepIconUrl(catalog) {
  return (componentType, type) => (componentType === 'switch'
    ? iconUrl('call_split', TILE.switch)
    : iconUrl(catalog?.tasks?.[type]?.icon, TILE.task));
}

export const taskFits = (catalog, type, event) => {
  const task = catalog?.tasks?.[type];
  return !!task && (!task.events || task.events.includes(event));
};

const defaults = (props) => Object.fromEntries(Object.entries(props).map(([k, spec]) => [k, Array.isArray(spec.default) ? [...spec.default] : spec.default]));

/** The first condition an if-step offers for this event: its first text field. */
export function defaultCondition(catalog, event) {
  const fields = catalog?.events?.[event]?.fields || [];
  const field = fields.find((f) => f.type === 'text') || fields[0];
  if (!field) return { field: '', op: '', value: '' };
  return { field: field.id, op: catalog.operators[field.type][0], value: field.type === 'choice' ? field.options[0] : '' };
}

/** A toolbox entry (no id: the designer gives one when it is dropped). */
export function newStep(catalog, type, event, name) {
  if (type === IF_TYPE) {
    return { componentType: 'switch', type: IF_TYPE, name, properties: defaultCondition(catalog, event), branches: { yes: [], no: [] } };
  }
  return { componentType: 'task', type, name, properties: defaults(catalog.tasks[type].props) };
}

/** Tasks that fit the workflow's event, then the if-step. */
export function toolboxGroups(catalog, event, t) {
  const tasks = Object.keys(catalog?.tasks || {})
    .filter((type) => taskFits(catalog, type, event))
    .map((type) => newStep(catalog, type, event, t(`automations.tasks.${type}.label`)));
  return [
    { name: t('automations.editor.toolboxTasks'), steps: tasks },
    { name: t('automations.editor.toolboxLogic'), steps: [newStep(catalog, IF_TYPE, event, t('automations.if.label'))] },
  ];
}

export const emptyDefinition = (event = DEFAULT_EVENT) => ({ properties: { event }, sequence: [] });

const TAG_RE = /^[a-z0-9][a-z0-9-]{1,23}$/;
const DISCORD_WEBHOOK_RE = /^https:\/\/(?:canary\.|ptb\.)?(?:discord|discordapp)\.com\/api\/webhooks\/\d{5,25}\/[\w-]{20,100}$/;

/** What is wrong with one property value (the server's cleanProp), or null. */
export function propertyProblem(spec, value) {
  switch (spec.type) {
    case 'template':
    case 'text': {
      const v = String(value ?? '').trim();
      if (spec.required && !v) return 'required';
      if (spec.max && v.length > spec.max) return 'too_long';
      if (spec.pattern === 'discord_webhook' && v && !DISCORD_WEBHOOK_RE.test(v)) return 'bad_webhook';
      return null;
    }
    case 'tags': {
      const list = Array.isArray(value) ? value : [];
      if (list.length > spec.max) return 'over_limit';
      return list.every((x) => TAG_RE.test(x)) ? null : 'bad_tag';
    }
    case 'number': {
      const n = Number(value);
      return Number.isFinite(n) && n >= spec.min && n <= spec.max ? null : 'out_of_range';
    }
    case 'choice':
      return spec.options.includes(value) ? null : 'bad_value';
    default:
      return null;
  }
}

/** What is wrong with an if-step's condition for this event, or null. */
export function conditionProblem(catalog, event, props) {
  const field = (catalog?.events?.[event]?.fields || []).find((f) => f.id === props?.field);
  if (!field) return 'bad_field';
  if (!catalog.operators[field.type].includes(props.op)) return 'bad_operator';
  const value = String(props.value ?? '').trim();
  if (field.type === 'number') return /^\d{1,6}(\.\d{1,3})?$/.test(value) ? null : 'bad_value';
  if (field.type === 'choice') return field.options.includes(value) ? null : 'bad_value';
  if (field.type === 'tags') return TAG_RE.test(value.toLowerCase().replace(/^#/, '')) ? null : 'bad_value';
  return value ? null : 'bad_value';
}

/** The first problem of a step in this workflow, or null (the designer's step validator). */
export function stepProblem(catalog, event, step, definition) {
  if (step.componentType === 'switch') return conditionProblem(catalog, event, step.properties);
  const task = catalog?.tasks?.[step.type];
  if (!task) return 'unknown_step';
  if (!taskFits(catalog, step.type, event)) return 'task_not_for_event';
  if (task.max && countType(definition.sequence, step.type) > task.max) return 'too_many_of_type';
  for (const [key, spec] of Object.entries(task.props)) {
    const p = propertyProblem(spec, step.properties?.[key]);
    if (p) return p;
  }
  return null;
}

function countType(sequence, type) {
  let n = 0;
  for (const s of sequence || []) {
    if (s.type === type) n += 1;
    if (s.branches) for (const b of Object.values(s.branches)) n += countType(b, type);
  }
  return n;
}

export function countSteps(sequence) {
  let n = 0;
  for (const s of sequence || []) {
    n += 1;
    if (s.branches) for (const b of Object.values(s.branches)) n += countSteps(b);
  }
  return n;
}

/**
 * Ready-made workflows, offered when starting a new one and from the editor's
 * Templates button. Labels and the texts they post are in
 * automations.templates.* (so a German creator gets German snaps). Templates
 * whose steps the catalog does not have (an older server) are left out.
 */
export const TEMPLATE_GROUPS = ['videos', 'audio', 'live', 'polls', 'thanks', 'others'];

export function templates(catalog, t) {
  let n = 0;
  const text = (key) => t(`automations.templates.texts.${key}`);
  const step = (type, event, properties = {}) => {
    const s = newStep(catalog, type, event, t(`automations.tasks.${type}.label`));
    n += 1;
    return { ...s, id: `${type}-${n}`, properties: { ...s.properties, ...properties } };
  };
  const ifStep = (event, cond, yes, no, name) => {
    n += 1;
    return { componentType: 'switch', type: IF_TYPE, id: `if-${n}`, name, properties: cond, branches: { yes, no } };
  };
  const list = [
    { id: 'snap_video', group: 'videos', event: 'video_published', sequence: [step('post_snap', 'video_published')] },
    { id: 'short_video', group: 'videos', event: 'video_published', sequence: [step('post_short', 'video_published')] },
    {
      id: 'long_video_short', group: 'videos', event: 'video_published',
      sequence: [ifStep('video_published', { field: 'duration', op: 'gt', value: '300' },
        [step('post_short', 'video_published', { start: 30 })],
        [step('post_snap', 'video_published')],
        text('longerThan5'))],
    },
    { id: 'audio_from_video', group: 'videos', event: 'video_published', sequence: [step('post_audio', 'video_published')] },
    { id: 'imported_discord', group: 'videos', event: 'video_imported', sequence: [step('send_discord', 'video_imported', { text: text('importedDiscord') })] },
    { id: 'narrate_posts', group: 'audio', event: 'text_post_published', sequence: [step('narrate_post', 'text_post_published')] },
    { id: 'video_from_podcast', group: 'audio', event: 'podcast_published', sequence: [step('post_video', 'podcast_published')] },
    { id: 'podcast_snap', group: 'audio', event: 'podcast_published', sequence: [step('post_snap', 'podcast_published', { text: text('podcastSnap') })] },
    { id: 'discord_live', group: 'live', event: 'stream_started', sequence: [step('send_discord', 'stream_started', { text: text('discordLive') })] },
    { id: 'stream_poll_snap', group: 'live', event: 'stream_poll_ended', sequence: [step('post_snap', 'stream_poll_ended', { text: text('streamPollSnap') })] },
    { id: 'poll_results', group: 'polls', event: 'poll_ended', sequence: [step('post_comment', 'poll_ended', { text: text('pollResults') })] },
    {
      id: 'thank_tips', group: 'thanks', event: 'tip_received',
      sequence: [ifStep('tip_received', { field: 'via', op: 'is', value: 'lightning' },
        [step('post_comment', 'tip_received', { text: text('thanksLightning') })],
        [step('post_comment', 'tip_received', { text: text('thanksTip') }), step('upvote_sender', 'tip_received')],
        text('viaLightning'))],
    },
    {
      id: 'thank_boosts', group: 'thanks', event: 'boost_received',
      sequence: [ifStep('boost_received', { field: 'boostKind', op: 'is', value: 'post' },
        [step('post_snap', 'boost_received', { text: text('thanksBoost') }), step('upvote_sender', 'boost_received')],
        [step('post_snap', 'boost_received', { text: text('thanksStreamBoost') })],
        text('boostOnPost'))],
    },
    {
      id: 'power_up_snap', group: 'thanks', event: 'power_up',
      sequence: [ifStep('power_up', { field: 'self', op: 'is', value: 'yes' },
        [step('post_snap', 'power_up', { text: text('poweredUp'), tags: ['hivepower'] })],
        [step('upvote_sender', 'power_up')],
        text('byMe'))],
    },
    // Accounts to list in the event: the creator fills them in.
    {
      id: 'vote_friends', group: 'others', event: 'someone_posted',
      sequence: [ifStep('someone_posted', { field: 'postKind', op: 'is', value: 'video' }, [step('upvote_post', 'someone_posted')], [], text('isVideo'))],
    },
    {
      id: 'reblog_friends', group: 'others', event: 'someone_posted',
      sequence: [ifStep('someone_posted', { field: 'postKind', op: 'is', value: 'video' }, [step('reblog', 'someone_posted')], [], text('isVideo'))],
    },
  ];
  const known = (seq) => seq.every((x) => (x.componentType === 'switch' ? Object.values(x.branches).every(known) : !!catalog?.tasks?.[x.type]));
  return list.filter((tpl) => catalog?.events?.[tpl.event] && known(tpl.sequence));
}

/** The placeholders a template can use for this event. */
export const placeholdersFor = (catalog, event) => catalog?.events?.[event]?.placeholders || catalog?.placeholders || [];
