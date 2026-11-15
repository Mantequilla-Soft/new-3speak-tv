// Chapters of a 3Speak post for the players (src/utils/postChapters.js): the
// timeline's chapters first, else the timestamped list in the text.
import { describe, it, expect } from 'vitest'
import { chaptersOfPost } from '../../../src/utils/postChapters'

describe('chaptersOfPost', () => {
  it('the audio editor\'s list in the text, with ends', () => {
    const body = 'https://audio.3speak.tv/play?a=x\n\nNotes\n\n0:00 Intro\n5:00 Guest\n20:00 Questions'
    expect(chaptersOfPost({ body, json_metadata: '{}', duration: 1800 })).toEqual([
      { start: 0, end: 300, title: 'Intro' },
      { start: 300, end: 1200, title: 'Guest' },
      { start: 1200, end: 1800, title: 'Questions' },
    ])
  })

  it('stored chapters in the metadata win over the text', () => {
    const meta = JSON.stringify({ video: { chapters: [{ start: 0, title: 'Start' }, { start: 60, title: 'Middle' }] } })
    expect(chaptersOfPost({ body: '0:00 a\n1:00 b\n2:00 c', json_metadata: meta, duration: 600 }).map((c) => c.title)).toEqual(['Start', 'Middle'])
  })

  it('nothing without a duration or a list', () => {
    expect(chaptersOfPost({ body: '0:00 a\n1:00 b\n2:00 c', json_metadata: '{}', duration: 0 })).toEqual([])
    expect(chaptersOfPost({ body: 'just notes', json_metadata: '{}', duration: 600 })).toEqual([])
  })
})
