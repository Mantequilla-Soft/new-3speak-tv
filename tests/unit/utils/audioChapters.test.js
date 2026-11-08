import { describe, it, expect } from 'vitest'
import { sanitizeChapters, chapterTime, chaptersText, withChapters } from '../../../src/utils/audioChapters'

describe('audioChapters', () => {
  it('keeps plain titled chapters in order and drops the rest', () => {
    expect(sanitizeChapters([
      { start: 0, end: 10, title: ' Intro ' },
      { start: 5, title: '' },
      { start: 75.4, title: 'Q&A [live] <b>now</b>\nok' },
      { start: 60, title: 'out of order' },
      { start: -1, title: 'negative' },
      { start: 'x', title: 'nan' },
      'junk',
      null,
    ])).toEqual([{ start: 0, title: 'Intro' }, { start: 75.4, title: 'Q&A live bnow/b ok' }])
    expect(sanitizeChapters('nope')).toEqual([])
    expect(sanitizeChapters(Array.from({ length: 150 }, (_, i) => ({ start: i, title: `c${i}` })))).toHaveLength(100)
  })

  it('writes the list the way chapter lists are written', () => {
    expect(chapterTime(0)).toBe('0:00')
    expect(chapterTime(75.9)).toBe('1:15')
    expect(chapterTime(3723)).toBe('1:02:03')
    expect(chaptersText([{ start: 0, title: 'Intro' }, { start: 760, title: 'Questions' }])).toBe('0:00 Intro\n12:40 Questions')
    expect(chaptersText([])).toBe('')
  })

  it('puts the list under the text, or in place of the list from an earlier edit', () => {
    expect(withChapters('', '', '0:00 Intro')).toBe('0:00 Intro')
    expect(withChapters('My notes', '', '0:00 Intro')).toBe('My notes\n\n0:00 Intro')
    expect(withChapters('My notes\n\n0:00 Intro', '0:00 Intro', '0:00 Intro\n2:00 Talk')).toBe('My notes\n\n0:00 Intro\n2:00 Talk')
    expect(withChapters('My notes\n\n0:00 Intro', '0:00 Intro', '')).toBe('My notes')
    expect(withChapters('Edited by hand', '0:00 Intro', '0:00 Intro')).toBe('Edited by hand\n\n0:00 Intro')
    expect(withChapters('Notes', '', '')).toBe('Notes')
  })
})
