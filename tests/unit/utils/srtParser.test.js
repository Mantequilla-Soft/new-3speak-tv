// SRT subtitle parsing (src/utils/srtParser.js), which feeds the caption
// overlay and the transcript on the watch page.
import { describe, it, expect } from 'vitest'
import { parseSrt } from '../../../src/utils/srtParser.js'

const SRT = `1
00:00:01,000 --> 00:00:04,500
Hello and welcome.

2
00:00:05,250 --> 00:00:07,000
Two lines
of text here.

3
01:02:03,004 --> 01:02:05,000
Late cue`

describe('parseSrt', () => {
  it('reads cues with start, end in seconds and the text', () => {
    expect(parseSrt(SRT)).toEqual([
      { start: 1, end: 4.5, text: 'Hello and welcome.' },
      { start: 5.25, end: 7, text: 'Two lines\nof text here.' },
      { start: 3723.004, end: 3725, text: 'Late cue' },
    ])
  })

  it('reads CRLF files and dot millisecond separators', () => {
    const crlf = '1\r\n00:00:01.000 --> 00:00:02.000\r\nHi\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\nThere\r\n'
    expect(parseSrt(crlf)).toEqual([
      { start: 1, end: 2, text: 'Hi' },
      { start: 3, end: 4, text: 'There' },
    ])
  })

  it('reads cues without a number line and with position info after the end time', () => {
    expect(parseSrt('00:00:01,000 --> 00:00:02,000 X1:100 X2:200\nNo index')).toEqual([
      { start: 1, end: 2, text: 'No index' },
    ])
  })

  it('tolerates extra blank lines, surrounding whitespace and a byte order mark', () => {
    const messy = `\uFEFF\n\n1\n00:00:01,000 --> 00:00:02,000\nA\n\n\n\n2\n00:00:02,000 --> 00:00:03,000\nB\n\n\n`
    expect(parseSrt(messy).map((c) => c.text)).toEqual(['A', 'B'])
  })

  it('skips cues with no text or a broken time line', () => {
    const srt = [
      '1\n00:00:01,000 --> 00:00:02,000\n   ',
      '2\nthis is not a time --> nope\nBroken',
      '3\n00:00:03,000\nNo arrow',
      '4\n00:00:04,000 --> 00:00:05,000\nKept',
    ].join('\n\n')
    expect(parseSrt(srt)).toEqual([{ start: 4, end: 5, text: 'Kept' }])
  })

  it('keeps unicode and markup in the text as written', () => {
    const srt = '1\n00:00:00,000 --> 00:00:01,000\n<i>¡Hola!</i> 日本語 🎬'
    expect(parseSrt(srt)[0].text).toBe('<i>¡Hola!</i> 日本語 🎬')
  })

  it('returns no cues for an empty or whitespace-only file', () => {
    expect(parseSrt('')).toEqual([])
    expect(parseSrt('  \n\n ')).toEqual([])
  })

  it('handles a long file', () => {
    const blocks = Array.from({ length: 3000 }, (_, i) => {
      const t = (s) => `00:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')},000`
      return `${i + 1}\n${t(i)} --> ${t(i + 1)}\nLine ${i}`
    })
    const cues = parseSrt(blocks.join('\n\n'))
    expect(cues).toHaveLength(3000)
    expect(cues[2999]).toEqual({ start: 2999 % 3600, end: 3000 % 3600, text: 'Line 2999' })
  })
})
