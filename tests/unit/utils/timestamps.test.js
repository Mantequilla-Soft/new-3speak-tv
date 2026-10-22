// Timestamps in descriptions and comments (src/utils/timestamps.js): parsing,
// seek links in rendered HTML, YouTube-style chapters and the 3speak.tv links
// written into comment markdown.
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import {
  parseStamp, formatStamp, linkifyTimestamps, handleTimestampClick, chapterFromLine,
  parseChapters, chapterAt, watchTimeUrl, linkTimestampsInMarkdown, unlinkTimestampsInMarkdown,
} from '../../../src/utils/timestamps.js'

describe('parseStamp', () => {
  it('reads m:ss, mm:ss and h:mm:ss', () => {
    expect(parseStamp('0:00')).toBe(0)
    expect(parseStamp('4:12')).toBe(252)
    expect(parseStamp('12:05')).toBe(725)
    expect(parseStamp('1:02:03')).toBe(3723)
    expect(parseStamp('  4:12  ')).toBe(252)
  })

  it('accepts minutes past 59 when there is no hour part', () => {
    expect(parseStamp('75:30')).toBe(4530)
  })

  it('rejects minutes past 59 once there is an hour part', () => {
    expect(parseStamp('1:75:30')).toBeNull()
  })

  it('rejects seconds of 60 or more, ratios, versions and clock times', () => {
    expect(parseStamp('4:60')).toBeNull()
    expect(parseStamp('1:2:3:4')).toBeNull()
    expect(parseStamp('1.12:30')).toBeNull()
    expect(parseStamp('10:30 pm')).toBeNull()
    expect(parseStamp('10:30am')).toBeNull()
    expect(parseStamp('10:30 a.m.')).toBeNull()
  })

  it('returns null for empty and non-timestamp input', () => {
    expect(parseStamp('')).toBeNull()
    expect(parseStamp(null)).toBeNull()
    expect(parseStamp(undefined)).toBeNull()
    expect(parseStamp('intro')).toBeNull()
    expect(parseStamp('at 4:12')).toBeNull()
  })
})

describe('formatStamp', () => {
  it('writes m:ss below an hour and h:mm:ss above', () => {
    expect(formatStamp(0)).toBe('0:00')
    expect(formatStamp(65)).toBe('1:05')
    expect(formatStamp(3599)).toBe('59:59')
    expect(formatStamp(3600)).toBe('1:00:00')
    expect(formatStamp(3723)).toBe('1:02:03')
  })

  it('floors fractions and clamps junk and negatives to 0:00', () => {
    expect(formatStamp(65.9)).toBe('1:05')
    expect(formatStamp(-5)).toBe('0:00')
    expect(formatStamp('abc')).toBe('0:00')
    expect(formatStamp(undefined)).toBe('0:00')
  })

  it('round-trips with parseStamp', () => {
    for (const s of [0, 9, 60, 252, 3599, 3600, 3723, 36000]) expect(parseStamp(formatStamp(s))).toBe(s)
  })
})

const links = (html) => {
  const tpl = document.createElement('template')
  tpl.innerHTML = html
  return [...tpl.content.querySelectorAll('a.ts-link')].map((a) => [a.textContent, a.dataset.seek, a.getAttribute('href')])
}

describe('linkifyTimestamps', () => {
  it('wraps a timestamp inside the video in a seek link', () => {
    const out = linkifyTimestamps('<p>The fix is at 4:12.</p>', 600)
    expect(links(out)).toEqual([['4:12', '252', '#t=252']])
    expect(out).toContain('The fix is at ')
    expect(out).toMatch(/<\/a>\.<\/p>$/)
  })

  it("a timestamp past the video's end is not linked", () => {
    const out = linkifyTimestamps('<p>Jump to 1:30 or 9:00</p>', 120)
    expect(links(out)).toEqual([['1:30', '90', '#t=90']])
    expect(out).toContain(' or 9:00')
  })

  it('a timestamp exactly at the end is still linked', () => {
    expect(links(linkifyTimestamps('<p>2:00</p>', 120))).toEqual([['2:00', '120', '#t=120']])
  })

  it('leaves html alone while the duration is unknown', () => {
    const html = '<p>at 0:30</p>'
    expect(linkifyTimestamps(html, 0)).toBe(html)
    expect(linkifyTimestamps(html, undefined)).toBe(html)
    expect(linkifyTimestamps(html, NaN)).toBe(html)
  })

  it('never links inside an existing link, code or pre', () => {
    const html = '<p><a href="https://x.com">0:30</a> <code>0:40</code></p><pre>0:50</pre><p>1:00</p>'
    expect(links(linkifyTimestamps(html, 600))).toEqual([['1:00', '60', '#t=60']])
  })

  it('links several timestamps in one text node and keeps the text between', () => {
    const out = linkifyTimestamps('<p>0:10 then 1:02:03 then end</p>', 4000)
    expect(links(out)).toEqual([['0:10', '10', '#t=10'], ['1:02:03', '3723', '#t=3723']])
    const tpl = document.createElement('template')
    tpl.innerHTML = out
    expect(tpl.content.textContent).toBe('0:10 then 1:02:03 then end')
  })

  it('ignores clock times and returns empty input as an empty string', () => {
    const html = '<p>live at 10:30 pm</p>'
    expect(linkifyTimestamps(html, 99999)).toBe(html)
    expect(linkifyTimestamps('', 100)).toBe('')
    expect(linkifyTimestamps(null, 100)).toBe('')
  })

  it('does not run markup in the text as html', () => {
    const out = linkifyTimestamps('<p>&lt;img src=x onerror=alert(1)&gt; 0:05</p>', 60)
    expect(out).not.toContain('<img')
    expect(links(out)).toEqual([['0:05', '5', '#t=5']])
  })

  it('gives the same answer from cache on a repeat call', () => {
    const html = '<p>repeat 0:07</p>'
    const a = linkifyTimestamps(html, 50)
    expect(linkifyTimestamps(html, 50)).toBe(a)
    expect(links(linkifyTimestamps(html, 5))).toEqual([])
  })
})

describe('handleTimestampClick', () => {
  const clickOn = (el) => ({ target: el, preventDefault: vi.fn(), stopPropagation: vi.fn() })

  it('seeks instead of navigating when a timestamp link is clicked', () => {
    const div = document.createElement('div')
    div.innerHTML = linkifyTimestamps('<p>see <b>1:05</b></p>', 300)
    const e = clickOn(div.querySelector('a.ts-link'))
    const onSeek = vi.fn()
    expect(handleTimestampClick(e, onSeek)).toBe(true)
    expect(onSeek).toHaveBeenCalledWith(65)
    expect(e.preventDefault).toHaveBeenCalled()
    expect(e.stopPropagation).toHaveBeenCalled()
  })

  it('leaves ordinary links and missing handlers alone', () => {
    const a = document.createElement('a')
    a.href = 'https://example.com'
    const e = clickOn(a)
    const onSeek = vi.fn()
    expect(handleTimestampClick(e, onSeek)).toBe(false)
    expect(onSeek).not.toHaveBeenCalled()
    expect(e.preventDefault).not.toHaveBeenCalled()

    const ts = document.createElement('a')
    ts.className = 'ts-link'
    ts.dataset.seek = '5'
    expect(handleTimestampClick(clickOn(ts), null)).toBe(false)
    expect(handleTimestampClick({ target: null }, onSeek)).toBe(false)
  })
})

describe('chapterFromLine', () => {
  it('reads time-first lines with any separator', () => {
    expect(chapterFromLine('0:00 Intro')).toEqual({ start: 0, title: 'Intro' })
    expect(chapterFromLine('1:05 - Setup')).toEqual({ start: 65, title: 'Setup' })
    expect(chapterFromLine('1:05 | Setup')).toEqual({ start: 65, title: 'Setup' })
    expect(chapterFromLine('(1:05) Setup')).toEqual({ start: 65, title: 'Setup' })
    expect(chapterFromLine('[1:05] Setup')).toEqual({ start: 65, title: 'Setup' })
  })

  it('reads time-last lines', () => {
    expect(chapterFromLine('Outro 12:00')).toEqual({ start: 720, title: 'Outro' })
    expect(chapterFromLine('Outro (12:00)')).toEqual({ start: 720, title: 'Outro' })
    expect(chapterFromLine('Outro - 12:00')).toEqual({ start: 720, title: 'Outro' })
  })

  it('strips bullets, numbering, bold and markdown or html links', () => {
    expect(chapterFromLine('- 0:00 Intro')).toEqual({ start: 0, title: 'Intro' })
    expect(chapterFromLine('• 0:00 Intro')).toEqual({ start: 0, title: 'Intro' })
    expect(chapterFromLine('3. 0:00 Intro')).toEqual({ start: 0, title: 'Intro' })
    expect(chapterFromLine('**0:00** Intro')).toEqual({ start: 0, title: 'Intro' })
    expect(chapterFromLine('- [1:05](https://3speak.tv/watch?v=a/p&t=65) Setup')).toEqual({ start: 65, title: 'Setup' })
    expect(chapterFromLine('<a href="https://x.com/?t=65">1:05</a> Setup')).toEqual({ start: 65, title: 'Setup' })
  })

  it('a bare timestamp is a chapter with no title', () => {
    expect(chapterFromLine('2:30')).toEqual({ start: 150, title: '' })
  })

  it('keeps unicode titles', () => {
    expect(chapterFromLine('0:30 Einführung 🎬')).toEqual({ start: 30, title: 'Einführung 🎬' })
  })

  it('returns null for lines without a timestamp, empty lines and impossible times', () => {
    expect(chapterFromLine('Just some words')).toBeNull()
    expect(chapterFromLine('')).toBeNull()
    expect(chapterFromLine('- ')).toBeNull()
    expect(chapterFromLine('1:75:00 Nope')).toBeNull()
  })
})

const LIST = ['0:00 Intro', '1:00 Setup', '2:30 Demo', '4:00 Outro'].join('\n')

describe('parseChapters', () => {
  it('turns a list of three or more lines into chapters with ends', () => {
    expect(parseChapters(LIST, 300)).toEqual([
      { start: 0, end: 60, title: 'Intro' },
      { start: 60, end: 150, title: 'Setup' },
      { start: 150, end: 240, title: 'Demo' },
      { start: 240, end: 300, title: 'Outro' },
    ])
  })

  it('needs at least three timestamp lines', () => {
    expect(parseChapters('0:00 Intro\n1:00 Setup', 300)).toEqual([])
  })

  it('returns nothing while the duration is unknown or the body is empty', () => {
    expect(parseChapters(LIST, 0)).toEqual([])
    expect(parseChapters(LIST, undefined)).toEqual([])
    expect(parseChapters('', 300)).toEqual([])
    expect(parseChapters(null, 300)).toEqual([])
  })

  it('adds an untitled first chapter when the list does not start at 0:00', () => {
    const ch = parseChapters('0:30 A\n1:00 B\n2:00 C', 300)
    expect(ch[0]).toEqual({ start: 0, end: 30, title: '' })
    expect(ch.map((c) => c.title)).toEqual(['', 'A', 'B', 'C'])
  })

  it('drops chapters at or past the end of the video', () => {
    const ch = parseChapters(LIST, 200)
    expect(ch.map((c) => c.start)).toEqual([0, 60, 150])
    expect(ch.at(-1).end).toBe(200)
  })

  it('returns nothing when too few chapters fall inside the video', () => {
    expect(parseChapters(LIST, 90)).toEqual([])
  })

  it('reads lines split by <br> and CRLF, and blank lines do not break the list', () => {
    expect(parseChapters('0:00 A<br>1:00 B<br/>2:00 C', 300)).toHaveLength(3)
    expect(parseChapters('0:00 A\r\n\r\n1:00 B\r\n\r\n2:00 C', 300)).toHaveLength(3)
  })

  it('picks the longest ascending run and ignores timestamps in prose around it', () => {
    const body = [
      'Recorded at 9:00 this morning.',
      '',
      '0:00 A', '1:00 B', '2:00 C', '3:00 D',
      'Thanks for watching!',
      '0:10 x', '0:20 y', '0:30 z',
    ].join('\n')
    expect(parseChapters(body, 600).map((c) => c.title)).toEqual(['A', 'B', 'C', 'D'])
  })

  it('a time going backwards starts a new run', () => {
    const body = '0:00 A\n1:00 B\n0:30 C\n2:00 D\n3:00 E'
    expect(parseChapters(body, 600).map((c) => c.title)).toEqual(['', 'C', 'D', 'E'])
  })

  it('merges a chapter shorter than three seconds into the one before', () => {
    expect(parseChapters('0:00 A\n1:00 B\n1:01 C\n2:00 D', 300)).toEqual([
      { start: 0, end: 61, title: 'A' },
      { start: 61, end: 120, title: 'C' },
      { start: 120, end: 300, title: 'D' },
    ])
  })

  it('handles a huge description without trouble', () => {
    const big = Array.from({ length: 5000 }, (_, i) => `${formatStamp(i * 10)} Part ${i}`).join('\n')
    const ch = parseChapters(big, 50000)
    expect(ch).toHaveLength(5000)
    expect(ch.at(-1)).toEqual({ start: 49990, end: 50000, title: 'Part 4999' })
  })
})

describe('chapterAt', () => {
  const ch = parseChapters(LIST, 300)

  it('finds the chapter containing a time', () => {
    expect(chapterAt(ch, 0).title).toBe('Intro')
    expect(chapterAt(ch, 59.9).title).toBe('Intro')
    expect(chapterAt(ch, 60).title).toBe('Setup')
    expect(chapterAt(ch, 299).title).toBe('Outro')
  })

  it('falls back to the first chapter before the start, and null with no chapters', () => {
    expect(chapterAt(ch, -1).title).toBe('Intro')
    expect(chapterAt([], 10)).toBeNull()
    expect(chapterAt(null, 10)).toBeNull()
  })
})

describe('timestamps in comment markdown', () => {
  const post = { author: 'alice', permlink: 'my-vid', duration: 600 }

  it('watchTimeUrl links to that second of the video on 3speak.tv', () => {
    expect(watchTimeUrl('alice', 'my-vid', 252.7)).toBe('https://3speak.tv/watch?v=alice/my-vid&t=252')
  })

  it('turns a timestamp inside the video into a 3speak.tv link', () => {
    expect(linkTimestampsInMarkdown('great bit at 4:12!', post))
      .toBe('great bit at [4:12](https://3speak.tv/watch?v=alice/my-vid&t=252)!')
  })

  it('leaves timestamps past the end as plain text', () => {
    expect(linkTimestampsInMarkdown('at 4:12 and 59:00', post))
      .toBe('at [4:12](https://3speak.tv/watch?v=alice/my-vid&t=252) and 59:00')
  })

  it('does not link inside code, existing links, images, html tags or bare urls', () => {
    const text = [
      '`0:10` and ```\n0:20\n```',
      '[0:30](https://example.com) ![0:40](https://img.example/0:40.png)',
      '<span title="0:50">x</span> https://example.com/t/1:00',
      'but 1:10 yes',
    ].join('\n')
    const out = linkTimestampsInMarkdown(text, post)
    expect(out.match(/3speak\.tv\/watch/g)).toHaveLength(1)
    expect(out).toContain('[1:10](https://3speak.tv/watch?v=alice/my-vid&t=70)')
    expect(out).toContain('`0:10`')
    expect(out).toContain('[0:30](https://example.com)')
    expect(out).toContain('https://example.com/t/1:00')
  })

  it('returns the text untouched without a post or a duration', () => {
    expect(linkTimestampsInMarkdown('at 0:10', { ...post, duration: 0 })).toBe('at 0:10')
    expect(linkTimestampsInMarkdown('at 0:10', { ...post, author: '' })).toBe('at 0:10')
    expect(linkTimestampsInMarkdown('at 0:10', { ...post, permlink: undefined })).toBe('at 0:10')
    expect(linkTimestampsInMarkdown(null, post)).toBe('')
  })

  it('unlinking for the edit box gives back what the author typed', () => {
    const typed = 'see 0:10, 4:12 and `5:00` and 59:00'
    const linked = linkTimestampsInMarkdown(typed, post)
    expect(linked).not.toBe(typed)
    expect(unlinkTimestampsInMarkdown(linked, post)).toBe(typed)
  })

  it('unlinking leaves links to other videos and other sites alone', () => {
    const other = '[4:12](https://3speak.tv/watch?v=bob/other&t=252)'
    const site = '[4:12](https://example.com/watch?v=alice/my-vid&t=252)'
    expect(unlinkTimestampsInMarkdown(other, post)).toBe(other)
    expect(unlinkTimestampsInMarkdown(site, post)).toBe(site)
  })

  it('unlinking does not treat a permlink prefix as the same video', () => {
    const longer = '[4:12](https://3speak.tv/watch?v=alice/my-vid-2&t=252)'
    expect(unlinkTimestampsInMarkdown(longer, post)).toBe(longer)
  })

  it('unlinking accepts subdomains and links without a time', () => {
    expect(unlinkTimestampsInMarkdown('[0:00](https://www.3speak.tv/watch?v=alice/my-vid)', post)).toBe('0:00')
  })

  it('author and permlink with regex characters are matched literally', () => {
    const p = { author: 'a.b', permlink: 'x-y' }
    expect(unlinkTimestampsInMarkdown('[1:00](https://3speak.tv/watch?v=aXb/x-y&t=60)', p))
      .toBe('[1:00](https://3speak.tv/watch?v=aXb/x-y&t=60)')
    expect(unlinkTimestampsInMarkdown('[1:00](https://3speak.tv/watch?v=a.b/x-y&t=60)', p)).toBe('1:00')
  })
})
