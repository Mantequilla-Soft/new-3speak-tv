// Automations: the editor's helpers (components/Automations/designer.js), checked
// against the server's own catalog (server/automation-catalog.cjs), so a step the
// editor shows as fine is one the server stores, and the other way round.
import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import {
  toolboxGroups, newStep, stepProblem, propertyProblem, conditionProblem, countSteps, templates, stepIconUrl, defaultCondition, placeholdersFor,
} from '../../../src/components/Automations/designer.js'

const require = createRequire(import.meta.url)
const server = require('../../../server/automation-catalog.cjs')
const catalog = JSON.parse(JSON.stringify(server.publicCatalog()))
const t = (k) => k

const withId = (step, id) => ({ ...step, id })
const definition = (event, sequence) => ({ properties: { event }, sequence })
const serverError = (event, sequence) => server.validateDefinition(definition(event, sequence)).error || null

describe('toolbox', () => {
  it('offers only the tasks that fit the event, then the if-step', () => {
    const video = toolboxGroups(catalog, 'video_published', t)
    expect(video[0].steps.map((s) => s.type)).toEqual(['post_snap', 'post_short', 'post_audio', 'post_comment', 'send_discord'])
    expect(toolboxGroups(catalog, 'someone_posted', t)[0].steps.map((s) => s.type)).toEqual(['post_snap', 'post_comment', 'upvote_post', 'reblog', 'send_discord'])
    expect(video[1].steps.map((s) => s.type)).toEqual(['if'])
    // No video to cut from an episode.
    expect(toolboxGroups(catalog, 'podcast_published', t)[0].steps.map((s) => s.type)).not.toContain('post_short')
  })

  it('starts new steps with the catalog defaults and a condition the event has', () => {
    expect(newStep(catalog, 'post_short', 'video_published', 'Short').properties).toEqual({ start: 0, length: 30, vertical: true, caption: '{title} ▶ {url}', tags: [] })
    expect(defaultCondition(catalog, 'video_published')).toEqual({ field: 'title', op: 'contains', value: '' })
    expect(newStep(catalog, 'if', 'video_published', 'If')).toMatchObject({ componentType: 'switch', branches: { yes: [], no: [] } })
  })

  it('has a glyph for every task (none falls back to the bolt)', () => {
    const icon = stepIconUrl(catalog)
    const bolt = icon('task', 'post_snap')
    for (const [type, task] of Object.entries(catalog.tasks)) {
      if (task.icon !== 'bolt') expect([type, icon('task', type) === bolt]).toEqual([type, false])
    }
  })

  it('draws a red tile for tasks and a cyan one for ifs', () => {
    const icon = stepIconUrl(catalog)
    expect(decodeURIComponent(icon('task', 'post_snap'))).toContain('#e53935')
    expect(decodeURIComponent(icon('switch', 'if'))).toContain('#0891b2')
  })

  it('has templates the server takes as they are, but for what only the creator can fill in', () => {
    const list = templates(catalog, t)
    expect(list.length).toBeGreaterThanOrEqual(15)
    for (const tpl of list) {
      const r = server.validateDefinition(definition(tpl.event, tpl.sequence))
      if (tpl.id === 'discord_live' || tpl.id === 'imported_discord') expect(r).toMatchObject({ error: 'required', property: 'webhook' })
      else if (tpl.event === 'someone_posted') expect(r.error).toBe('no_accounts')
      else expect([tpl.id, r.error]).toEqual([tpl.id, undefined])
    }
  })

  it('has "Snap when I go live": a snap with the stream title and link when a stream starts', async () => {
    const tpl = templates(catalog, t).find((x) => x.id === 'live_snap')
    expect(tpl).toMatchObject({ group: 'live', event: 'stream_started' })
    expect(tpl.sequence).toHaveLength(1)
    expect(tpl.sequence[0]).toMatchObject({ type: 'post_snap', properties: { text: 'automations.templates.texts.liveSnap' } })
    // The English text only uses what a started stream offers.
    const en = (await import('../../../src/locales/en/automations.json')).default
    const text = (en.automations || en).templates.texts.liveSnap
    for (const [, name] of text.matchAll(/\{(\w+)\}/g)) expect(placeholdersFor(catalog, 'stream_started')).toContain(name)
  })

  it('offers each event its own placeholders', () => {
    expect(placeholdersFor(catalog, 'tip_received')).toContain('from')
    expect(placeholdersFor(catalog, 'poll_ended')).toEqual(expect.arrayContaining(['question', 'results', 'winner']))
    expect(placeholdersFor(catalog, 'video_published')).not.toContain('results')
  })
})

describe('the same checks as the server', () => {
  const snap = (props) => withId({ ...newStep(catalog, 'post_snap', 'video_published', 'Snap'), properties: { text: 'x', tags: [], ...props } }, 'a')
  const cases = [
    ['a fine snap', 'video_published', [snap({})]],
    ['an empty snap text', 'video_published', [snap({ text: '' })]],
    ['too many tags', 'video_published', [snap({ tags: ['a1', 'b2', 'c3', 'd4', 'e5', 'f6', 'g7', 'h8', 'i9'] })]],
    ['a Short of a podcast', 'podcast_published', [withId(newStep(catalog, 'post_short', 'video_published', 'S'), 'a')]],
    ['two Shorts', 'video_published', [withId(newStep(catalog, 'post_short', 'video_published', 'S'), 'a'), withId(newStep(catalog, 'post_short', 'video_published', 'S'), 'b')]],
    ['a Short of 90 s', 'video_published', [withId({ ...newStep(catalog, 'post_short', 'video_published', 'S'), properties: { ...newStep(catalog, 'post_short', 'video_published', 'S').properties, length: 90 } }, 'a')]],
    ['a webhook elsewhere', 'video_published', [withId({ componentType: 'task', type: 'send_discord', name: 'D', properties: { webhook: 'https://example.com/api/webhooks/1/x', text: 'x' } }, 'a')]],
    ['an if on a field streams lack', 'stream_started', [withId({ componentType: 'switch', type: 'if', name: 'If', properties: { field: 'duration', op: 'gt', value: '60' }, branches: { yes: [], no: [] } }, 'a')]],
    ['an if with a word for seconds', 'video_published', [withId({ componentType: 'switch', type: 'if', name: 'If', properties: { field: 'duration', op: 'gt', value: 'long' }, branches: { yes: [], no: [] } }, 'a')]],
    ['a fine if', 'video_published', [withId({ componentType: 'switch', type: 'if', name: 'If', properties: { field: 'tags', op: 'has_tag', value: 'cats' }, branches: { yes: [snap({})], no: [] } }, 'i')]],
  ]
  for (const [name, event, sequence] of cases) {
    it(name, () => {
      const def = definition(event, sequence)
      const walk = (seq) => seq.flatMap((s) => [s, ...(s.branches ? Object.values(s.branches).flatMap(walk) : [])])
      const clientOk = walk(sequence).every((s) => !stepProblem(catalog, event, s, def))
      expect(clientOk).toBe(serverError(event, sequence) === null)
    })
  }

  it('names the problem like the server does', () => {
    expect(propertyProblem(catalog.tasks.post_snap.props.text, ' ')).toBe('required')
    expect(propertyProblem(catalog.tasks.send_discord.props.webhook, 'https://evil.example/x')).toBe('bad_webhook')
    expect(conditionProblem(catalog, 'video_published', { field: 'title', op: 'gt', value: '1' })).toBe('bad_operator')
    expect(countSteps([{ branches: { yes: [{}, {}], no: [{}] } }, {}])).toBe(5)
  })
})
