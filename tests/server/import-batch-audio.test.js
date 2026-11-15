// The podcast path of the batch import (server/import-batch.cjs): the audio post
// as the audio uploader writes it, and the server-side upload to the audio
// service (a stub on loopback; nothing reaches the real one).
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
let stub
let received = null
let thumbCall = null
let work
let batch

beforeAll(async () => {
  stub = http.createServer((req, res) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json')
      if (req.url === '/video/thumbnail') {
        thumbCall = { method: req.method, auth: req.headers.authorization, body: JSON.parse(Buffer.concat(chunks).toString()) }
        return res.end('{"success":true}')
      }
      received = { url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString('latin1') }
      if (req.headers['x-api-key'] !== 'audio-test-key') { res.statusCode = 401; return res.end('{"error":"bad key"}') }
      res.end(JSON.stringify({ success: true, permlink: 'aud123', playUrl: 'http://audio.example/play?a=aud123' }))
    })
  })
  await new Promise((r) => stub.listen(0, '127.0.0.1', r))
  process.env.AUDIO_API_URL = `http://127.0.0.1:${stub.address().port}`
  process.env.AUDIO_API_KEY = 'audio-test-key'
  process.env.CHECKER_URL = process.env.AUDIO_API_URL
  process.env.CHECKER_API_KEY = 'checker-test-key'
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-audio-'))
  batch = require('../../server/import-batch.cjs')
})

afterAll(() => {
  stub?.close()
  if (work) fs.rmSync(work, { recursive: true, force: true })
})

const source = {
  sourceId: 'rss:AAAAAAAAAAAAAAAA', platform: 'rss', title: 'Episode [1]: Hello',
  description: 'Full notes #hive #Podcasting', tags: [], sourceUrl: 'https://example.com/ep1',
}
const options = { community: 'hive-181335', payout: 'default', beneficiaries: [{ account: 'friend', weight: 500 }], nsfw: false, ads: true }

describe('buildAudioPost', () => {
  it('writes the post like the audio uploader: cover, play URL, notes, podcast metadata', () => {
    const post = batch.buildAudioPost({
      user: 'alice', source, playUrl: 'https://audio.3speak.tv/play?a=aud123', thumbnailUrl: 'https://images.hive.blog/x.jpg',
      options, premium: false, duration: 1800.4,
    })
    expect(post.title).toBe('Episode [1]: Hello')
    expect(post.body).toBe('![Episode 1: Hello](https://images.hive.blog/x.jpg)\n\nhttps://audio.3speak.tv/play?a=aud123\n\nFull notes #hive #Podcasting')
    expect(post.tags).toEqual(['hive-181335', 'hive', 'podcasting'])
    expect(post.jsonMetadata).toMatchObject({
      app: 'new-3speak-tv',
      audio: { type: 'podcast' },
      oa: { v: 1, object: 'Article' },
      'threespeak.audio': { type: 'podcast', duration: 1800 },
      image: ['https://images.hive.blog/x.jpg'],
      imported_from: { platform: 'rss', id: 'AAAAAAAAAAAAAAAA', url: 'https://example.com/ep1' },
    })
    expect(post.jsonMetadata['3speak']).toBeUndefined()
    expect(post.jsonMetadata.video).toBeUndefined()
  })

  it('audio pays the fund, never the encoder', () => {
    const post = batch.buildAudioPost({ user: 'alice', source, playUrl: 'https://p', options, premium: false, duration: 60 })
    expect(post.beneficiaries).toEqual([{ account: 'friend', weight: 500 }, { account: 'threespeakfund', weight: 1000 }])
    const pro = batch.buildAudioPost({ user: 'meno', source, playUrl: 'https://p', options, premium: true, duration: 60 })
    expect(pro.beneficiaries).toEqual([{ account: 'friend', weight: 500 }])
  })

  it('ads switched off in the form become audioAds: false; no notes falls back to the title', () => {
    const post = batch.buildAudioPost({ user: 'alice', source: { ...source, description: '' }, playUrl: 'https://p', options: { ...options, ads: false }, premium: false, duration: 0 })
    expect(post.jsonMetadata['3speak']).toEqual({ audioAds: false })
    expect(post.body).toBe('https://p\n\nEpisode [1]: Hello')
    expect(post.jsonMetadata['threespeak.audio']).toEqual({ type: 'podcast' })
  })
})

describe('uploadAudio', () => {
  it('streams the file as multipart with the service key and the owner', async () => {
    const file = path.join(work, 'ep.mp3')
    fs.writeFileSync(file, Buffer.from('ID3 fake mp3 bytes'))
    const seen = []
    const out = await batch.uploadAudio({ file, user: 'alice', title: 'Ep\n1', duration: 61.6, format: 'mp3', mime: 'audio/mpeg', onProgress: (f) => seen.push(f) })
    expect(out).toEqual({ permlink: 'aud123', playUrl: 'https://audio.example/play?a=aud123' })
    expect(received.url).toBe('/api/audio/upload')
    expect(received.headers['x-user']).toBe('alice')
    expect(received.headers['content-type']).toMatch(/^multipart\/form-data; boundary=/)
    expect(received.body).toContain('name="duration"\r\n\r\n62\r\n')
    expect(received.body).toContain('name="format"\r\n\r\nmp3\r\n')
    expect(received.body).toContain('name="title"\r\n\r\nEp 1\r\n')
    expect(received.body).toContain('name="category"\r\n\r\npodcast\r\n')
    expect(received.body).toContain('filename="recording.mp3"\r\nContent-Type: audio/mpeg\r\n\r\nID3 fake mp3 bytes\r\n')
    expect(seen.at(-1)).toBe(1)
  })
})

describe('setAudioThumbnail', () => {
  it('gives the audio row its cover through the checker, like the audio uploader', async () => {
    expect(await batch.setAudioThumbnail('alice', 'aud123', 'https://images.3speak.tv/x.webp')).toBe(true)
    expect(thumbCall).toEqual({ method: 'PUT', auth: 'Bearer checker-test-key', body: { owner: 'alice', permlink: 'aud123', thumbnail: 'https://images.3speak.tv/x.webp' } })
    expect(await batch.setAudioThumbnail('alice', 'aud123', '')).toBe(false)
  })
})
