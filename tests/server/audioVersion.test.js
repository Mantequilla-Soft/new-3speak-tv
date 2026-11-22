// A creator's own video as an MP3 (server/audio-version.cjs), for "Publish as
// audio": owner only, one job each, the file served to its creator only.
// ffmpeg and the video lookup are stand-ins; nothing is encoded.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import express from 'express'

const require = createRequire(import.meta.url)
const { mountAudioVersion, audioArgs } = require('../../server/audio-version.cjs')

let server
let base
let tmp
let viewer
let ffmpegCalls
let source

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'av-test-'))
  viewer = 'badadib'
  ffmpegCalls = []
  source = async () => ({ variantUrl: 'https://ipfs.example/ipfs/Qm/720p/index.m3u8' })
  const app = express()
  app.use(express.json())
  mountAudioVersion(app, {
    enabled: true,
    timers: false,
    tmpDir: tmp,
    resolveUser: async () => viewer,
    videoSource: (...a) => source(...a),
    runFfmpeg: async (args) => { ffmpegCalls.push(args); fs.writeFileSync(args[args.length - 1], 'ID3mp3') },
  })
  await new Promise((resolve) => { server = app.listen(0, resolve) })
  base = `http://127.0.0.1:${server.address().port}/api/audio-version`
})
afterEach(async () => {
  await new Promise((resolve) => server.close(resolve))
  fs.rmSync(tmp, { recursive: true, force: true })
})

const start = (body) => fetch(`${base}/jobs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
async function waitDone(id) {
  for (let i = 0; i < 50; i++) {
    const s = await (await fetch(`${base}/jobs/${id}`)).json()
    if (s.status === 'done' || s.status === 'failed') return s
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error('never finished')
}

describe('audio version of a video', () => {
  it('ffmpeg arguments: the sound only, 128 kb/s stereo MP3', () => {
    expect(audioArgs('in.m3u8', 'out.mp3')).toEqual(['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', 'in.m3u8', '-vn', '-c:a', 'libmp3lame', '-b:a', '128k', '-ac', '2', 'out.mp3'])
  })

  it('makes the MP3 of the creator\'s own video and serves it to them only', async () => {
    const r = await start({ author: 'badadib', permlink: 'my-video' })
    expect(r.status).toBe(200)
    const { id } = await r.json()
    expect(await waitDone(id)).toEqual({ status: 'done', size: 6 })
    expect(ffmpegCalls[0]).toContain('https://ipfs.example/ipfs/Qm/720p/index.m3u8')
    const audio = await fetch(`${base}/jobs/${id}/audio`)
    expect(audio.headers.get('content-type')).toMatch(/audio\/mpeg/)
    expect(await audio.text()).toBe('ID3mp3')
    viewer = 'someone'
    expect((await fetch(`${base}/jobs/${id}/audio`)).status).toBe(404)
  })

  it('refuses someone else\'s video, bad input, and a signed-out caller', async () => {
    expect((await start({ author: 'meno', permlink: 'theirs' })).status).toBe(403)
    expect((await start({ author: 'badadib', permlink: 'Bad Permlink' })).status).toBe(400)
    viewer = null
    expect((await start({ author: 'badadib', permlink: 'my-video' })).status).toBe(401)
  })

  it('a video without playable sound fails the job with a reason', async () => {
    source = async () => null
    const { id } = await (await start({ author: 'badadib', permlink: 'my-video' })).json()
    expect(await waitDone(id)).toMatchObject({ status: 'failed', errorCode: 'not_ready' })
    expect(ffmpegCalls).toEqual([])
  })

  it('one job at a time per creator', async () => {
    let release
    source = () => new Promise((r) => { release = () => r({ variantUrl: 'u' }) })
    const first = await (await start({ author: 'badadib', permlink: 'a' })).json()
    const second = await start({ author: 'badadib', permlink: 'b' })
    expect(second.status).toBe(409)
    expect((await second.json()).id).toBe(first.id)
    await new Promise((r) => setTimeout(r, 5))
    release()
    expect((await waitDone(first.id)).status).toBe('done')
  })
})
