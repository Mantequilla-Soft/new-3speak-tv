// OBS stream templates (src/utils/streamTemplates.js): the hangouts API client,
// the name -> address slug, and the form <-> API body mapping.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@snapie/hangouts-react', () => ({
  writePostDraft: vi.fn(),
  writePref: vi.fn(),
  AUTO_VOD_KEY: 'autoVod',
  ALLOW_CLIPS_KEY: 'allowClips',
}))
vi.mock('../../../src/utils/openpodAnnounce', () => ({ setAnnounceConfig: vi.fn() }))

import { writePostDraft, writePref } from '@snapie/hangouts-react'
import { setAnnounceConfig } from '../../../src/utils/openpodAnnounce'

const load = async (env = {}) => {
  vi.resetModules()
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v)
  return import('../../../src/utils/streamTemplates.js')
}

const jsonRes = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => { if (body === undefined) throw new Error('no json'); return body },
})

describe('templates API client', () => {
  let fetchMock
  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  it('refuses to call anything when no hangouts URL is configured', async () => {
    const m = await load()
    const err = await m.listTemplates('tok').catch((e) => e)
    expect(err).toBeInstanceOf(m.TemplateApiError)
    expect(err.status).toBe(0)
    expect(err.code).toBe('not_configured')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('prefers the templates URL over the general hangouts URL and drops a trailing slash', async () => {
    const m = await load({ VITE_HANGOUTS_TEMPLATES_API_URL: 'https://tpl.example/', VITE_HANGOUTS_API_URL: 'https://h.example' })
    fetchMock.mockResolvedValue(jsonRes(200, { templates: [] }))
    expect(await m.listTemplates('tok')).toEqual({ templates: [] })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://tpl.example/templates')
    expect(init.method).toBe('GET')
    expect(init.headers).toEqual({ Authorization: 'Bearer tok' })
    expect(init.body).toBeUndefined()
  })

  it('sends JSON bodies and URL-encodes template ids', async () => {
    const m = await load({ VITE_HANGOUTS_API_URL: 'https://h.example' })
    fetchMock.mockResolvedValue(jsonRes(200, {}))
    await m.createTemplate('tok', { name: 'x' })
    await m.updateTemplate('tok', 'a/b c', { name: 'y' })
    await m.deleteTemplate('tok', 'a/b')
    await m.resetStreamSecret('tok')
    const [c1, c2, c3, c4] = fetchMock.mock.calls
    expect(c1[1]).toMatchObject({ method: 'POST', body: '{"name":"x"}' })
    expect(c1[1].headers['Content-Type']).toBe('application/json')
    expect(c2[0]).toBe('https://h.example/templates/a%2Fb%20c')
    expect(c2[1].method).toBe('PATCH')
    expect(c3[0]).toBe('https://h.example/templates/a%2Fb')
    expect(c3[1].method).toBe('DELETE')
    expect(c4[0]).toBe('https://h.example/stream-secret/reset')
    expect(c4[1].body).toBe('{}')
  })

  it('an error answer keeps the HTTP status, the error code and the message', async () => {
    const m = await load({ VITE_HANGOUTS_API_URL: 'https://h.example' })
    fetchMock.mockResolvedValue(jsonRes(409, { error: 'limit_reached', message: 'Too many templates' }))
    const err = await m.createTemplate('tok', {}).catch((e) => e)
    expect(err).toMatchObject({ status: 409, code: 'limit_reached', message: 'Too many templates' })
  })

  it('an error answer without a JSON body still reads as an HTTP error', async () => {
    const m = await load({ VITE_HANGOUTS_API_URL: 'https://h.example' })
    fetchMock.mockResolvedValue(jsonRes(502))
    const err = await m.getStreamSecret('tok').catch((e) => e)
    expect(err).toMatchObject({ status: 502, code: null, message: 'HTTP 502' })
  })
})

describe('slugifyTemplateName', () => {
  it('lowercases and turns runs of other characters into single dashes', async () => {
    const { slugifyTemplateName } = await load()
    expect(slugifyTemplateName('My Gaming Stream!')).toBe('my-gaming-stream')
    expect(slugifyTemplateName('  --Hello__World--  ')).toBe('hello-world')
  })

  it('strips accents rather than dropping the letter', async () => {
    const { slugifyTemplateName } = await load()
    expect(slugifyTemplateName('Café Über Ñandú')).toBe('cafe-uber-nandu')
  })

  it('caps at 40 characters without leaving a trailing dash', async () => {
    const { slugifyTemplateName } = await load()
    const slug = slugifyTemplateName(`${'a'.repeat(39)} bcd`)
    expect(slug).toBe('a'.repeat(39))
    expect(slugifyTemplateName('x'.repeat(100))).toHaveLength(40)
  })

  it('is empty for nothing, emoji or other scripts', async () => {
    const { slugifyTemplateName } = await load()
    expect(slugifyTemplateName(null)).toBe('')
    expect(slugifyTemplateName('🎮🔥')).toBe('')
    expect(slugifyTemplateName('日本語')).toBe('')
  })
})

describe('form mapping', () => {
  it('templateToForm fills every gap from the empty template', async () => {
    const { templateToForm, emptyTemplate } = await load()
    expect(templateToForm(null)).toEqual(emptyTemplate())
    const f = templateToForm({ name: 'n', tags: 'notarray', boost: { enabled: false }, announce: { community: 'hive-1' } })
    expect(f.tags).toEqual([])
    expect(f.boost).toEqual({ enabled: false, minBoostUsd: 0.1, creatorPayoutAccount: '' })
    expect(f.announce.community).toBe('hive-1')
    expect(f.announce.beneficiaries).toEqual([])
    expect(f.recording).toEqual({ publishVod: false, allowClips: true })
  })

  it('formToInput trims, cleans the payout account and clamps the minimum boost', async () => {
    const { formToInput, emptyTemplate } = await load()
    const form = { ...emptyTemplate(), name: '  Name ', title: ' Title ', boost: { enabled: 1, minBoostUsd: '-3', creatorPayoutAccount: ' @Bob ' } }
    const out = formToInput(form, { isPremium: false })
    expect(out.name).toBe('Name')
    expect(out.title).toBe('Title')
    expect(out.boost).toEqual({ enabled: true, minBoostUsd: 0, creatorPayoutAccount: 'bob' })
    expect(formToInput({ ...form, boost: { ...form.boost, minBoostUsd: 'abc' } }, {}).boost.minBoostUsd).toBe(0)
    expect(formToInput({ ...form, boost: { ...form.boost, minBoostUsd: '2.5' } }, {}).boost.minBoostUsd).toBe(2.5)
  })

  it('every host can publish the recording; clips stay Pro-only', async () => {
    const { formToInput, emptyTemplate } = await load()
    const form = { ...emptyTemplate(), recording: { publishVod: true, allowClips: true } }
    expect(formToInput(form, { isPremium: false }).recording).toEqual({ publishVod: true, allowClips: false })
    expect(formToInput(form, { isPremium: true }).recording).toEqual({ publishVod: true, allowClips: true })
  })

  it('drops empty beneficiaries and keeps at most the limit', async () => {
    const { formToInput, emptyTemplate, TEMPLATE_LIMITS } = await load()
    const benes = [null, { account: '', weight: 100 }, { account: 'a', weight: 0 },
      ...Array.from({ length: 12 }, (_, i) => ({ account: `u${i}`, weight: 100 }))]
    const form = { ...emptyTemplate(), announce: { ...emptyTemplate().announce, community: '', beneficiaries: benes } }
    const out = formToInput(form, {})
    expect(out.announce.beneficiaries).toHaveLength(TEMPLATE_LIMITS.beneficiaries)
    expect(out.announce.beneficiaries[0].account).toBe('u0')
    expect(out.announce.community).toBe('hive-181335')
  })

  it('applyTemplateToSetup writes the draft, announcement and recording prefs', async () => {
    const { applyTemplateToSetup } = await load()
    applyTemplateToSetup({
      title: 'T', tags: ['a'], boost: { minBoostUsd: 0.5 },
      announce: { enabled: false, beneficiaries: [{ account: 'x', weight: 500, extra: 1 }, { account: 'y', weight: 0 }] },
      recording: { publishVod: true, allowClips: false },
    })
    const [draft, mode] = vi.mocked(writePostDraft).mock.calls.at(-1)
    expect(mode).toBe('standalone')
    expect(draft).toMatchObject({ title: 'T', tags: ['a'], minBoostUsd: '0.5', notifyOnHive: false, mode: 'standalone' })
    expect(vi.mocked(setAnnounceConfig).mock.calls.at(-1)[0]).toMatchObject({
      announceEnabled: false, community: 'hive-181335', beneList: [{ account: 'x', weight: 500 }],
    })
    expect(writePref).toHaveBeenCalledWith('autoVod', true)
    expect(writePref).toHaveBeenCalledWith('allowClips', false)
  })
})
