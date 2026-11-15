// How a render from the editor goes to 3Speak (utils/editorFormat.js): a 9:16
// one as a Short, anything else (and the video podcast) as a normal video.
import { describe, it, expect } from 'vitest'
import { editorPostKind, editorAspect, editorTitle, editorChapters, EDITOR_VIDEO_MAX_SEC } from '../../../src/utils/editorFormat'

describe('editorPostKind', () => {
  it('follows the shape the editor reports', () => {
    expect(editorPostKind({ format: { aspect: '16:9', short: false } })).toBe('video')
    expect(editorPostKind({ format: { aspect: '9:16', short: true } })).toBe('short')
    expect(editorPostKind({ format: { aspect: '1:1' } })).toBe('video')
    expect(editorPostKind({ format: { aspect: '9:16' } })).toBe('short')
  })
  it('the audio editor\'s video podcast is a video; an editor that says nothing makes Shorts', () => {
    expect(editorPostKind({ mediaType: 'video' })).toBe('video')
    expect(editorPostKind({ outputUrl: 'x' })).toBe('short')
    expect(editorPostKind({ format: { aspect: '21:9' } })).toBe('short')
    expect(editorPostKind(null)).toBe('short')
  })
})

describe('editor shape, title and chapters', () => {
  it('knows the four shapes and the 10 minute limit', () => {
    expect(editorAspect('4:3')).toBe('4:3')
    expect(editorAspect('16:10')).toBe(null)
    expect(EDITOR_VIDEO_MAX_SEC).toBe(600)
  })
  it('cleans a suggested title', () => {
    expect(editorTitle('  Episode\n12:   the   talk ')).toBe('Episode 12: the talk')
    expect(editorTitle(5)).toBe('')
    expect(editorTitle('x'.repeat(300))).toHaveLength(120)
  })
  it('chapters start at 0:00, go up, have titles', () => {
    expect(editorChapters([{ start: 0, title: 'Intro' }, { start: 95.4, title: 'Setup' }, { start: 90, title: 'Back' }, { start: 200, title: '' }]).map(c => [c.start, c.title]))
      .toEqual([[0, 'Intro'], [95, 'Setup']])
    expect(editorChapters([{ start: 5, title: 'Late' }])).toEqual([])
    expect(editorChapters('x')).toEqual([])
  })
})
