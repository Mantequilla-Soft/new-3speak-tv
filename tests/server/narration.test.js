// Blog to podcast (server/narration-text.cjs, narration-render.cjs, narration.cjs):
// what of a post's markdown a voice reads, and the API around a render: own
// posts only, the free/Pro voices and music, the daily minutes, previews, jobs.
// Piper and ffmpeg are stand-ins here; nothing is rendered.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import express from 'express'

const require = createRequire(import.meta.url)
const text = require('../../server/narration-text.cjs')
const render = require('../../server/narration-render.cjs')
const { mountNarration, memoryUsage, withIntro, previewOf } = require('../../server/narration.cjs')

const script = (md) => text.narrationScript(md).paragraphs.map((p) => p.text)

describe('narrationScript: what a voice reads of a post', () => {
  it('drops pictures, links, emoji, emoticons and the frontend footer', () => {
    const md = [
      'https://play.3speak.tv/embed?v=badadib/23d7lptj',
      '',
      '![holiday](https://images.hive.blog/x.jpg)',
      '',
      'We drove to **Dresden** 🚗🇩🇪 and met [my parents](https://example.com) :)',
      '',
      'Here you can check out my channel: https://d.tube/c/badadib',
      '',
      'Thanks for reading!',
      '',
      '---',
      '▶ [Watch on 3speak.tv](https://3speak.tv/watch?v=badadib/x)',
      'Posted with Ecency',
    ].join('\n')
    expect(script(md)).toEqual(['We drove to Dresden and met my parents.', 'Thanks for reading!'])
  })

  it('reads headings and list items as sentences, joins wrapped lines', () => {
    const md = '# My week\n\nIt started\nwith rain.\n\n- coffee\n- a long walk\n\n```js\nconsole.log(1)\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |'
    const { paragraphs } = text.narrationScript(md)
    expect(paragraphs).toEqual([
      { text: 'My week.', heading: true },
      { text: 'It started with rain.' },
      { text: 'coffee. a long walk.' },
    ])
  })

  it('keeps a one-word paragraph, reads mentions and hashtags as words, decodes entities', () => {
    expect(script('Hello @badadib &amp; #hive friends\n\nPEACE!')).toEqual(['Hello badadib & hive friends.', 'PEACE!'])
  })

  it('reads nothing of a post that is only pictures and links', () => {
    expect(text.narrationScript('![a](https://x.y/a.png)\n\nhttps://3speak.tv/watch?v=a/b').paragraphs).toEqual([])
  })

  it('round-trips the editable script, a heading as "# "', () => {
    const paragraphs = [{ text: 'Intro.', heading: true }, { text: 'One two.' }]
    expect(text.parseScript(text.scriptText(paragraphs))).toEqual(paragraphs)
    expect(text.parseScript('  first\nline \n\n\n second ')).toEqual([{ text: 'first line' }, { text: 'second' }])
  })

  it('estimates about 155 words a minute', () => {
    expect(text.estimateSeconds(155)).toBe(60)
  })
})

describe('intro and preview', () => {
  it('says the title, the author and that a synthetic voice reads it', () => {
    expect(withIntro([{ text: 'Hi.' }], { title: 'My holidays!', author: 'badadib' })[0])
      .toEqual({ text: 'My holidays. By badadib. Read by a synthetic voice.', heading: true })
    expect(withIntro([{ text: 'Hi.' }], { title: 'x', author: 'badadib', intro: false })).toEqual([{ text: 'Hi.' }])
  })

  it('previews about the first 40 words in whole sentences', () => {
    const long = Array.from({ length: 20 }, (_, i) => `Sentence number ${i} is here.`).join(' ')
    const p = previewOf([{ text: long }, { text: 'Later.' }])
    expect(p).toHaveLength(1)
    expect(p[0].text.split(/\s+/).length).toBeLessThanOrEqual(40)
    expect(p[0].text.endsWith('.')).toBe(true)
  })
})

describe('voices and music', () => {
  let dir
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narr-'))
    for (const id of ['en_GB-alan-medium', 'en_US-ryan-high', 'en_US-amy-medium']) {
      fs.writeFileSync(path.join(dir, `${id}.onnx`), '')
      fs.writeFileSync(path.join(dir, `${id}.onnx.json`), '{}')
    }
    fs.writeFileSync(path.join(dir, 'rain.mp3'), '')
    fs.writeFileSync(path.join(dir, 'library.json'), JSON.stringify({ tracks: [{ id: 'carefree', title: 'Carefree', artist: 'Kevin MacLeod', file: 'carefree.mp3', credit: '"Carefree" Kevin MacLeod' }] }))
    fs.writeFileSync(path.join(dir, 'carefree.mp3'), '')
  })
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

  it('lists the voices on disk; two female and two male are free', () => {
    const v = render.listVoices(dir)
    expect(v.map((x) => [x.name, x.free])).toEqual([['Alan', true], ['Amy', false], ['Ryan', true]])
    expect(render.FREE_VOICES.map((id) => render.VOICE_INFO[id].gender).sort()).toEqual(['female', 'female', 'male', 'male'])
    expect(render.voiceAllowed(v, 'en_US-amy-medium', false)).toBe(false)
    expect(render.voiceAllowed(v, 'en_US-amy-medium', true)).toBe(true)
  })

  it('gives everyone the focus moods, the library and own uploads only to Pro', () => {
    const opts = (pro) => ({ user: 'badadib', pro, focusDir: dir, libraryDir: dir })
    expect(render.resolveMusic({ kind: 'off' }, opts(false))).toBeNull()
    expect(render.resolveMusic({ kind: 'focus', id: 'rain' }, opts(false))).toMatchObject({ file: path.join(dir, 'rain.mp3'), lufs: -20 })
    expect(() => render.resolveMusic({ kind: 'library', id: 'carefree' }, opts(false))).toThrow(expect.objectContaining({ code: 'pro_only' }))
    expect(render.resolveMusic({ kind: 'library', id: 'carefree' }, opts(true))).toMatchObject({ credit: { id: 'lib-carefree', title: 'Carefree', artist: 'Kevin MacLeod' } })
    expect(() => render.resolveMusic({ kind: 'upload', id: '../../etc/passwd' }, opts(true))).toThrow(expect.objectContaining({ code: 'music_missing' }))
    expect(() => render.resolveMusic({ kind: 'focus', id: 'disco' }, opts(false))).toThrow(expect.objectContaining({ code: 'music_missing' }))
  })
})

describe('the /api/narrate routes', () => {
  let server
  let base
  let api
  const st = { pro: {}, renders: [], now: Date.parse('2026-11-19T10:00:00Z'), fail: false }
  const voices = [
    { id: 'en_GB-alan-medium', name: 'Alan', gender: 'male', free: true },
    { id: 'en_US-amy-medium', name: 'Amy', gender: 'female', free: false },
  ]
  const posts = {
    'badadib/holidays': { author: 'badadib', permlink: 'holidays', title: 'My holidays', category: 'hive-181335', body: 'We went to Dresden.\n\nIt rained. 🌧️', json_metadata: { tags: ['travel'], image: ['https://x.y/a.jpg'] } },
  }

  beforeAll(async () => {
    const app = express()
    app.use(express.json())
    api = mountNarration(app, {
      enabled: true,
      timers: false,
      users: ['badadib', 'alice'],
      usage: memoryUsage(),
      now: () => st.now,
      cacheDir: fs.mkdtempSync(path.join(os.tmpdir(), 'narr-cache-')),
      resolveUser: async (req) => req.headers['x-test-user'] || null,
      isPro: async (u) => !!st.pro[u],
      hiveCall: async (method, params) => {
        if (method === 'bridge.get_post') return posts[`${params.author}/${params.permlink}`] || null
        return Object.values(posts).filter((p) => p.author === params.account)
      },
      listVoices: () => voices,
      library: () => ({ moods: [], tracks: [{ id: 'carefree', title: 'Carefree', artist: 'Kevin MacLeod', mood: 'upbeat', duration: 200 }] }),
      resolveMusic: (m, { pro }) => {
        if (!m || m.kind === 'off') return null
        if (m.kind !== 'focus' && !pro) throw Object.assign(new Error('This music is part of 3Speak Pro'), { code: 'pro_only', status: 400 })
        return { file: '/dev/null', lufs: -20, credit: m.kind === 'library' ? { id: 'lib-carefree', title: 'Carefree' } : undefined }
      },
      render: async ({ paragraphs, voice, music, outFile }) => {
        st.renders.push({ paragraphs, voice, music })
        if (st.fail) throw new Error('piper broke')
        fs.writeFileSync(outFile, 'ID3')
        return { seconds: 30 }
      },
    })
    await new Promise((resolve) => { server = app.listen(0, resolve) })
    base = `http://127.0.0.1:${server.address().port}`
  })
  afterAll(() => server?.close())
  beforeEach(() => { st.pro = {}; st.renders = []; st.fail = false; st.now += 24 * 3600 * 1000 })

  const call = async (user, method, p, body) => {
    const r = await fetch(`${base}/api/narrate${p}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(user ? { 'x-test-user': user } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
    const ct = r.headers.get('content-type') || ''
    return { status: r.status, body: ct.includes('json') ? await r.json() : await r.text() }
  }
  const settle = async (id, user = 'badadib') => {
    for (let i = 0; i < 50; i++) {
      const r = await call(user, 'GET', `/jobs/${id}`)
      if (r.body.status === 'done' || r.body.status === 'failed') return r.body
      await new Promise((res) => setTimeout(res, 10))
    }
    throw new Error('job did not finish')
  }

  it('needs a proven login of an account it is open for', async () => {
    expect((await call(null, 'GET', '/options')).status).toBe(401)
    expect((await call('carol', 'GET', '/options')).body.errorCode).toBe('not_open')
    const o = await call('badadib', 'GET', '/options')
    expect(o.status).toBe(200)
    expect(o.body).toMatchObject({ pro: false, allowance: { limit: 15 * 60, used: 0 }, library: { tracks: [] } })
    st.pro.badadib = true
    expect((await call('badadib', 'GET', '/options')).body).toMatchObject({ pro: true, allowance: { limit: 60 * 60 }, library: { tracks: [{ id: 'carefree' }] } })
  })

  it('turns only the creator\'s own post into a script', async () => {
    const own = await call('badadib', 'POST', '/script', { author: 'badadib', permlink: 'holidays' })
    expect(own.body).toMatchObject({ title: 'My holidays', script: 'We went to Dresden.\n\nIt rained.', image: 'https://x.y/a.jpg', community: 'hive-181335' })
    expect((await call('alice', 'POST', '/script', { author: 'badadib', permlink: 'holidays' })).body.errorCode).toBe('not_yours')
    expect((await call('badadib', 'POST', '/script', { author: 'badadib', permlink: 'nope' })).status).toBe(404)
  })

  it('lists the creator\'s posts with what kind they are', async () => {
    const r = await call('badadib', 'GET', '/posts')
    expect(r.body.posts).toEqual([expect.objectContaining({ permlink: 'holidays', kind: 'text', words: 6, narrated: false })])
  })

  it('renders with the intro, serves the MP3 to its creator only, and counts the minutes', async () => {
    const job = await call('badadib', 'POST', '/jobs', { script: 'We went to Dresden.', title: 'My holidays', voice: 'en_GB-alan-medium', music: { kind: 'focus', id: 'rain' } })
    expect(job.status).toBe(200)
    const done = await settle(job.body.id)
    expect(done).toMatchObject({ status: 'done', seconds: 30 })
    expect(st.renders[0].paragraphs[0].text).toBe('My holidays. By badadib. Read by a synthetic voice.')
    expect(st.renders[0].music).toMatchObject({ lufs: -20 })
    expect((await call('badadib', 'GET', `/jobs/${job.body.id}/audio`)).status).toBe(200)
    expect((await call('alice', 'GET', `/jobs/${job.body.id}/audio`)).status).toBe(404)
    expect((await call('badadib', 'GET', '/options')).body.allowance.used).toBe(30)
  })

  it('keeps the Pro voices and music for Pro', async () => {
    expect((await call('badadib', 'POST', '/jobs', { script: 'Hi there.', voice: 'en_US-amy-medium' })).body.errorCode).toBe('pro_only')
    expect((await call('badadib', 'POST', '/jobs', { script: 'Hi there.', music: { kind: 'library', id: 'carefree' } })).body.errorCode).toBe('pro_only')
    st.pro.badadib = true
    const job = await call('badadib', 'POST', '/jobs', { script: 'Hi there.', voice: 'en_US-amy-medium', music: { kind: 'library', id: 'carefree' } })
    expect(await settle(job.body.id)).toMatchObject({ status: 'done', credit: { id: 'lib-carefree' } })
  })

  it('refuses a recording longer than the minutes left today; previews are not counted', async () => {
    const long = Array.from({ length: 2400 }, () => 'word').join(' ') // ~15.5 minutes
    const r = await call('badadib', 'POST', '/jobs', { script: long, intro: false })
    expect(r.status).toBe(429)
    expect(r.body).toMatchObject({ errorCode: 'daily_limit', allowance: { left: 900 } })
    const pre = await call('badadib', 'POST', '/jobs', { script: long, preview: true })
    expect(await settle(pre.body.id)).toMatchObject({ status: 'done', preview: true })
    expect(st.renders[0].paragraphs[0].text.split(' ').length).toBeLessThanOrEqual(40)
    expect((await call('badadib', 'GET', '/options')).body.allowance.used).toBe(0)
  })

  it('gives the minutes back when a render fails', async () => {
    st.fail = true
    const job = await call('badadib', 'POST', '/jobs', { script: 'We went to Dresden.' })
    expect(await settle(job.body.id)).toMatchObject({ status: 'failed', error: 'The recording failed, try again' })
    expect((await call('badadib', 'GET', '/options')).body.allowance.used).toBe(0)
  })

  it('refuses an empty script and an unknown voice', async () => {
    expect((await call('badadib', 'POST', '/jobs', { script: '  ' })).body.errorCode).toBe('empty_script')
    expect((await call('badadib', 'POST', '/jobs', { script: 'Hi.', voice: 'en_XX-nope' })).body.errorCode).toBe('bad_voice')
  })
})

describe('automation task narrate_post', () => {
  const { HANDLERS } = require('../../server/automation-tasks.cjs')
  const step = { properties: { voice: 'en_GB-alan-medium', music: 'rain', title: '{title}', audioType: 'podcast', tags: ['story'] } }
  const event = { author: 'badadib', permlink: 'holidays', values: { title: 'My holidays', description: 'We went to Dresden.', community: 'hive-181335', image: 'https://x.y/a.jpg' } }

  function setup({ body = 'We went to Dresden.\n\nIt rained. 🌧️ https://x.y', left = 900 } = {}) {
    const st = { saved: {}, scheduled: null, uploads: [], rendered: null, usage: memoryUsage() }
    const deps = {
      hiveCall: async () => ({ title: 'My holidays', body }),
      isPro: async () => false,
      uploadAudio: async (u) => { st.uploads.push(u); return { permlink: 'aud1', playUrl: 'https://audio.3speak.tv/play?a=aud1' } },
      setAudioThumbnail: async () => true,
      buildAudioPost: require('../../server/import-batch.cjs').buildAudioPost,
      scheduleOnChecker: async (doc) => { st.scheduled = doc; return {} },
      narrationUsage: st.usage,
      narration: {
        text,
        usage: require('../../server/narration.cjs'),
        render: {
          ...render,
          resolveMusic: (m) => ({ file: `/beds/${m.id}.mp3`, lufs: -20 }),
          renderNarration: async (o) => { st.rendered = o; return { seconds: 20 } },
        },
      },
    }
    if (left < 900) st.usage.add('badadib', require('../../server/narration.cjs').day(Date.now()), 900 - left)
    const ctx = { user: 'badadib', marker: { workflow: 'w1' }, saved: null, save: async (d) => { Object.assign(st.saved, d) } }
    return { st, deps, ctx }
  }

  it('reads the cleaned post with the intro and posts it as audio linking back', async () => {
    const { st, deps, ctx } = setup()
    const out = await HANDLERS.narrate_post(step, event, ctx, deps)
    expect(st.rendered.paragraphs.map((p) => p.text)).toEqual(['My holidays. By badadib. Read by a synthetic voice.', 'We went to Dresden.', 'It rained.'])
    expect(st.rendered).toMatchObject({ voice: 'en_GB-alan-medium', music: { file: '/beds/rain.mp3' } })
    expect(st.uploads[0]).toMatchObject({ user: 'badadib', title: 'My holidays', duration: 20, category: 'podcast' })
    // An ordinary upload: counts against the free plan's audio limit (no RSS import marker)
    expect(st.uploads[0].uploadSource).toBeUndefined()
    expect(st.scheduled.body).toContain('https://3speak.tv/@badadib/holidays')
    expect(st.scheduled.body).toContain('Read by a synthetic voice (Alan).')
    expect(st.scheduled.jsonMetadata['3speak'].tts).toEqual({ engine: 'piper', voice: 'en_GB-alan-medium', source: 'badadib/holidays' })
    expect(out.permlink).toBeTruthy()
    expect(await st.usage.used('badadib', require('../../server/narration.cjs').day(Date.now()))).toBe(20)
  })

  it('waits for tomorrow when the minutes are used up, and refuses an empty post', async () => {
    const a = setup({ left: 0 })
    await expect(HANDLERS.narrate_post(step, event, a.ctx, a.deps)).rejects.toMatchObject({ code: 'daily_limit', retry: true })
    const b = setup({ body: '![x](https://x.y/a.png)' })
    await expect(HANDLERS.narrate_post(step, event, b.ctx, b.deps)).rejects.toMatchObject({ code: 'empty_text' })
  })
})
