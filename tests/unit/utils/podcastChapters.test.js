// Record as podcast (H23): the server's structured chapters in the viewer's language.
import { describe, it, expect } from 'vitest'
import { podcastChapters } from '../../../src/utils/podcastChapters.js'

const t = (k, o) => (o?.user ? `${k}:${o.user}` : k)

describe('podcastChapters', () => {
  it('names the opening after the show, joins after the speaker, keeps marker titles', () => {
    expect(podcastChapters([
      { start: 0, kind: 'start' },
      { start: 120, kind: 'join', identity: 'fan' },
      { start: 300, kind: 'marker', title: 'Questions' },
      { start: 400, kind: 'marker' },
      { start: 'x', kind: 'marker', title: 'bad' },
      null,
    ], 'Weekly show', t)).toEqual([
      { start: 0, title: 'Weekly show' },
      { start: 120, title: 'podcastRecord.chapters.join:fan' },
      { start: 300, title: 'Questions' },
      { start: 400, title: 'podcastRecord.chapters.marker' },
    ])
  })

  it('falls back to Intro without a show title, and to nothing for bad input', () => {
    expect(podcastChapters([{ start: 0, kind: 'start' }], null, t)).toEqual([{ start: 0, title: 'podcastRecord.chapters.intro' }])
    expect(podcastChapters(null, 'x', t)).toEqual([])
  })
})
