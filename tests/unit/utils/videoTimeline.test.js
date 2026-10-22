// Chapters and link toasters stored in a video's json_metadata and written into
// its description (src/utils/videoTimeline.js). The embed player reads the same
// format, so these pin both the shape and the description sections.
import { describe, it, expect } from 'vitest'
import {
  cleanUrl, siteOf, normalizeChapters, normalizeLink, normalizeLinks, withTimeline, timelineMeta,
  parseJsonMetadata, readTimeline, chaptersWithEnds, findChapterBlock, chaptersFromText, chapterBlock,
  linkBlock, applyTimelineToDescription, splitSystemTail, applyTimelineToBody, activeLinksAt,
  MAX_CHAPTERS, MAX_LINKS, CHAPTER_TITLE_MAX,
} from '../../../src/utils/videoTimeline.js'

const CH = [{ start: 0, title: 'Intro' }, { start: 65, title: 'Setup' }, { start: 200, title: 'Demo' }]
const POST = { author: 'alice', permlink: 'my-vid' }

describe('cleanUrl and siteOf', () => {
  it('keeps http and https urls in normalised form', () => {
    expect(cleanUrl(' https://Example.com/x?y=1 ')).toBe('https://example.com/x?y=1')
    expect(cleanUrl('http://example.com')).toBe('http://example.com/')
  })

  it('rejects other schemes, credentials, junk and overlong urls', () => {
    expect(cleanUrl('javascript:alert(1)')).toBeNull()
    expect(cleanUrl('data:text/html,hi')).toBeNull()
    expect(cleanUrl('ftp://example.com')).toBeNull()
    expect(cleanUrl('https://user:pw@example.com')).toBeNull()
    expect(cleanUrl('not a url')).toBeNull()
    expect(cleanUrl('')).toBeNull()
    expect(cleanUrl(42)).toBeNull()
    expect(cleanUrl(`https://example.com/${'a'.repeat(500)}`)).toBeNull()
  })

  it('siteOf gives the host without www', () => {
    expect(siteOf('https://www.example.com/x')).toBe('example.com')
    expect(siteOf('https://blog.example.com')).toBe('blog.example.com')
    expect(siteOf('nope')).toBe('')
  })
})

describe('normalizeChapters', () => {
  it('keeps a valid list sorted by start', () => {
    expect(normalizeChapters([CH[2], CH[0], CH[1]])).toEqual(CH)
  })

  it('needs the first chapter at 0:00', () => {
    expect(normalizeChapters([{ start: 5, title: 'A' }, { start: 60, title: 'B' }])).toEqual([])
  })

  it('needs at least two chapters', () => {
    expect(normalizeChapters([{ start: 0, title: 'A' }])).toEqual([])
    expect(normalizeChapters([])).toEqual([])
  })

  it('drops untitled chapters, bad starts and non-objects', () => {
    expect(normalizeChapters([
      { start: 0, title: 'A' }, { start: 10, title: '   ' }, { start: -5, title: 'neg' },
      { start: 'abc', title: 'nan' }, null, 'x', { start: 20, title: 'B' },
    ])).toEqual([{ start: 0, title: 'A' }, { start: 20, title: 'B' }])
  })

  it('accepts numeric strings and floors fractional seconds', () => {
    expect(normalizeChapters([{ start: '0', title: 'A' }, { start: '61.9', title: 'B' }]))
      .toEqual([{ start: 0, title: 'A' }, { start: 61, title: 'B' }])
  })

  it('drops a chapter less than three seconds after the one before', () => {
    expect(normalizeChapters([{ start: 0, title: 'A' }, { start: 2, title: 'typo' }, { start: 3, title: 'B' }]))
      .toEqual([{ start: 0, title: 'A' }, { start: 3, title: 'B' }])
  })

  it('drops chapters at or past a known duration', () => {
    expect(normalizeChapters(CH, { duration: 200 })).toEqual(CH.slice(0, 2))
    expect(normalizeChapters(CH, { duration: 60 })).toEqual([])
  })

  it('cleans titles: control and bidi characters out, whitespace collapsed, length capped', () => {
    const [, b] = normalizeChapters([{ start: 0, title: 'A' }, { start: 10, title: ' a‮b\n\tc​d ' }])
    expect(b.title).toBe('a b c d')
    const [long] = normalizeChapters([{ start: 0, title: '😀'.repeat(150) }, { start: 10, title: 'B' }])
    expect(Array.from(long.title)).toHaveLength(CHAPTER_TITLE_MAX)
  })

  it('keeps zero-width joiners so emoji sequences survive', () => {
    const family = '👨‍👩‍👧'
    expect(normalizeChapters([{ start: 0, title: family }, { start: 10, title: 'B' }])[0].title).toBe(family)
  })

  it('caps the list at 50 chapters', () => {
    const many = Array.from({ length: 80 }, (_, i) => ({ start: i * 10, title: `C${i}` }))
    expect(normalizeChapters(many)).toHaveLength(MAX_CHAPTERS)
  })

  it('returns [] for anything that is not an array', () => {
    expect(normalizeChapters(null)).toEqual([])
    expect(normalizeChapters({ 0: CH[0] })).toEqual([])
  })
})

describe('normalizeLink', () => {
  it('keeps a video link, lowercasing the author and dropping @', () => {
    expect(normalizeLink({ at: 42, dur: 8, kind: 'video', author: '@Alice', permlink: 'my-vid', title: 'My vid' }))
      .toEqual({ at: 42, dur: 8, kind: 'video', author: 'alice', permlink: 'my-vid', title: 'My vid' })
  })

  it('keeps a profile link without a title', () => {
    expect(normalizeLink({ at: 120, kind: 'profile', account: 'bob', title: 'ignored' }))
      .toEqual({ at: 120, dur: 8, kind: 'profile', account: 'bob' })
  })

  it('keeps a url link and fills in the site from the url', () => {
    expect(normalizeLink({ at: 300, dur: 10, kind: 'url', url: 'https://www.example.com/x', title: 'Example' }))
      .toEqual({ at: 300, dur: 10, kind: 'url', url: 'https://www.example.com/x', title: 'Example', site: 'example.com' })
  })

  it('clamps the duration to 3..60 and defaults it to 8', () => {
    const base = { at: 0, kind: 'profile', account: 'bob' }
    expect(normalizeLink({ ...base, dur: 1 }).dur).toBe(3)
    expect(normalizeLink({ ...base, dur: 600 }).dur).toBe(60)
    expect(normalizeLink({ ...base, dur: 7.6 }).dur).toBe(8)
    expect(normalizeLink({ ...base, dur: 0 }).dur).toBe(8)
    expect(normalizeLink({ ...base, dur: 'x' }).dur).toBe(8)
    expect(normalizeLink({ ...base }).dur).toBe(8)
  })

  it('rejects invalid accounts, permlinks, urls and kinds', () => {
    expect(normalizeLink({ at: 0, kind: 'profile', account: 'ab' })).toBeNull()
    expect(normalizeLink({ at: 0, kind: 'profile', account: '1abc' })).toBeNull()
    expect(normalizeLink({ at: 0, kind: 'video', author: 'alice', permlink: 'Has Spaces' })).toBeNull()
    expect(normalizeLink({ at: 0, kind: 'url', url: 'javascript:alert(1)' })).toBeNull()
    expect(normalizeLink({ at: 0, kind: 'other', url: 'https://x.com' })).toBeNull()
    expect(normalizeLink(null)).toBeNull()
  })

  it('rejects a link without a start or past a known duration', () => {
    expect(normalizeLink({ kind: 'profile', account: 'bob' })).toBeNull()
    expect(normalizeLink({ at: -1, kind: 'profile', account: 'bob' })).toBeNull()
    expect(normalizeLink({ at: 100, kind: 'profile', account: 'bob' }, { duration: 100 })).toBeNull()
    expect(normalizeLink({ at: 99, kind: 'profile', account: 'bob' }, { duration: 100 })).not.toBeNull()
  })
})

describe('normalizeLinks', () => {
  it('sorts by start, keeping the creator order for links at the same second', () => {
    const out = normalizeLinks([
      { at: 50, kind: 'profile', account: 'carol' },
      { at: 10, kind: 'profile', account: 'bob' },
      { at: 10, kind: 'profile', account: 'alice' },
      { at: 5, kind: 'nope' },
    ])
    expect(out.map((l) => l.account)).toEqual(['bob', 'alice', 'carol'])
  })

  it('caps the list at 20 links', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ at: i, kind: 'profile', account: 'bob' }))
    expect(normalizeLinks(many)).toHaveLength(MAX_LINKS)
    expect(normalizeLinks('nope')).toEqual([])
  })
})

describe('withTimeline and timelineMeta', () => {
  const links = [{ at: 5, kind: 'profile', account: 'bob' }]

  it('writes the timeline next to the other video keys', () => {
    expect(withTimeline({ duration: 300, chapters: 'stale' }, CH, links)).toEqual({
      duration: 300, timeline_v: 1, chapters: CH, links: [{ at: 5, dur: 8, kind: 'profile', account: 'bob' }],
    })
  })

  it('takes the timeline out when nothing valid is left', () => {
    expect(withTimeline({ duration: 300, timeline_v: 1, chapters: CH, links }, [], [])).toEqual({ duration: 300 })
    expect(withTimeline(null, [], [])).toEqual({})
  })

  it('writes only the parts that exist', () => {
    expect(timelineMeta(CH, [])).toEqual({ timeline_v: 1, chapters: CH })
    expect(timelineMeta([], links)).toEqual({ timeline_v: 1, links: [{ at: 5, dur: 8, kind: 'profile', account: 'bob' }] })
  })
})

describe('readTimeline', () => {
  it('reads the timeline from a json_metadata string', () => {
    const meta = JSON.stringify({ video: { timeline_v: 1, chapters: CH, links: [{ at: 1, kind: 'profile', account: 'bob' }] } })
    const t = readTimeline(meta)
    expect(t.present).toBe(true)
    expect(t.chapters).toEqual(CH)
    expect(t.links).toHaveLength(1)
  })

  it('normalises again on read, because json_metadata is unchecked', () => {
    const t = readTimeline({ video: { timeline_v: 1, chapters: [{ start: 5, title: 'x' }, { start: 9, title: 'y' }], links: [{ at: 1, kind: 'url', url: 'javascript:x' }] } })
    expect(t).toEqual({ chapters: [], links: [], present: true })
  })

  it('says there is no timeline without timeline_v, or for broken metadata', () => {
    expect(readTimeline({ video: { chapters: CH } })).toEqual({ chapters: [], links: [], present: false })
    expect(readTimeline('{not json')).toEqual({ chapters: [], links: [], present: false })
    expect(readTimeline(null).present).toBe(false)
    expect(readTimeline('"just a string"').present).toBe(false)
  })

  it('parseJsonMetadata returns {} for anything that is not a json object', () => {
    expect(parseJsonMetadata('')).toEqual({})
    expect(parseJsonMetadata('null')).toEqual({})
    expect(parseJsonMetadata('42')).toEqual({})
    expect(parseJsonMetadata('{"a":1}')).toEqual({ a: 1 })
    const obj = { a: 1 }
    expect(parseJsonMetadata(obj)).toBe(obj)
  })
})

describe('chaptersWithEnds', () => {
  it('adds ends for the player controls', () => {
    expect(chaptersWithEnds(CH, 300)).toEqual([
      { start: 0, end: 65, title: 'Intro' },
      { start: 65, end: 200, title: 'Setup' },
      { start: 200, end: 300, title: 'Demo' },
    ])
  })

  it('is empty until the duration is known, and drops chapters past the end', () => {
    expect(chaptersWithEnds(CH, 0)).toEqual([])
    expect(chaptersWithEnds(CH, 100)).toEqual([{ start: 0, end: 65, title: 'Intro' }, { start: 65, end: 100, title: 'Setup' }])
  })
})

describe('reading a chapter list from a description', () => {
  const desc = 'About this video.\n\n0:00 Intro\n1:05 Setup\n\n3:20 Demo\n\nThanks!'

  it('findChapterBlock gives the line range of the list', () => {
    const b = findChapterBlock(desc)
    expect(b.from).toBe(2)
    expect(b.to).toBe(5)
    expect(b.chapters.map((c) => c.start)).toEqual([0, 65, 200])
  })

  it('findChapterBlock needs three lines', () => {
    expect(findChapterBlock('0:00 A\n1:00 B')).toBeNull()
    expect(findChapterBlock('')).toBeNull()
  })

  it('chaptersFromText returns the list as written, even without 0:00', () => {
    expect(chaptersFromText(desc)).toEqual(CH)
    expect(chaptersFromText('0:30 A\n1:00\n2:00 C')).toEqual([{ start: 30, title: 'A' }, { start: 60, title: '' }, { start: 120, title: 'C' }])
    expect(chaptersFromText('no list')).toEqual([])
  })
})

describe('chapterBlock and linkBlock', () => {
  it('writes chapter times as plain text before the post exists', () => {
    expect(chapterBlock(CH)).toEqual(['#### Video Chapters', '', '- 0:00 Intro', '- 1:05 Setup', '- 3:20 Demo'])
  })

  it('links each chapter time to that moment on 3speak.tv, 0:00 without &t', () => {
    expect(chapterBlock(CH, POST).slice(2)).toEqual([
      '- [0:00](https://3speak.tv/watch?v=alice/my-vid) Intro',
      '- [1:05](https://3speak.tv/watch?v=alice/my-vid&t=65) Setup',
      '- [3:20](https://3speak.tv/watch?v=alice/my-vid&t=200) Demo',
    ])
  })

  it('writes nothing for an invalid chapter list', () => {
    expect(chapterBlock([{ start: 10, title: 'A' }, { start: 20, title: 'B' }])).toEqual([])
  })

  it('writes one line per link target, repeats listed once', () => {
    expect(linkBlock([
      { at: 1, kind: 'profile', account: 'bob' },
      { at: 2, kind: 'video', author: 'alice', permlink: 'my-vid', title: 'My vid' },
      { at: 3, kind: 'video', author: 'carol', permlink: 'x' },
      { at: 4, kind: 'url', url: 'https://example.com/x', title: 'Example page' },
      { at: 9, kind: 'profile', account: 'bob' },
    ])).toEqual([
      '#### Video Links',
      '[@bob on 3Speak.tv](https://3speak.tv/@bob)',
      '[My vid by @alice](https://3speak.tv/watch?v=alice/my-vid)',
      '[A video by @carol](https://3speak.tv/watch?v=carol/x)',
      '[Example page](https://example.com/x)',
    ])
  })

  it('escapes brackets in titles and parentheses in urls so the link cannot break', () => {
    const [, line] = linkBlock([{ at: 1, kind: 'url', url: 'https://en.wikipedia.org/wiki/Foo_(bar)', title: 'See [this]' }])
    expect(line).toBe('[See \\[this\\]](https://en.wikipedia.org/wiki/Foo_%28bar%29)')
  })

  it('falls back to the site, then the url, as a url link label', () => {
    expect(linkBlock([{ at: 1, kind: 'url', url: 'https://www.example.com/a' }])[1]).toBe('[example.com](https://www.example.com/a)')
  })

  it('writes nothing without links', () => {
    expect(linkBlock([])).toEqual([])
    expect(linkBlock(undefined)).toEqual([])
  })
})

describe('applyTimelineToDescription', () => {
  const links = [{ at: 5, kind: 'profile', account: 'bob' }]

  it('appends the sections to a description without any', () => {
    expect(applyTimelineToDescription('Hello world.', { chapters: CH, links }, POST)).toBe([
      'Hello world.',
      '',
      '#### Video Chapters',
      '',
      '- [0:00](https://3speak.tv/watch?v=alice/my-vid) Intro',
      '- [1:05](https://3speak.tv/watch?v=alice/my-vid&t=65) Setup',
      '- [3:20](https://3speak.tv/watch?v=alice/my-vid&t=200) Demo',
      '',
      '#### Video Links',
      '[@bob on 3Speak.tv](https://3speak.tv/@bob)',
    ].join('\n'))
  })

  it('replaces a typed chapter list where it stands', () => {
    const desc = 'Top text.\n\n0:00 Old intro\n1:00 Old middle\n2:00 Old end\n\nBottom text.'
    const out = applyTimelineToDescription(desc, { chapters: CH })
    expect(out).toBe('Top text.\n\n#### Video Chapters\n\n- 0:00 Intro\n- 1:05 Setup\n- 3:20 Demo\n\nBottom text.')
  })

  it('is stable when applied again to its own output', () => {
    const once = applyTimelineToDescription('Hello.\n\nMore text.', { chapters: CH.slice(0, 2), links }, POST)
    expect(applyTimelineToDescription(once, { chapters: CH.slice(0, 2), links }, POST)).toBe(once)
  })

  it('rewrites a two-chapter list it wrote earlier rather than adding a second one', () => {
    const once = applyTimelineToDescription('Hi.', { chapters: CH.slice(0, 2) })
    const twice = applyTimelineToDescription(once, { chapters: CH })
    expect(twice.match(/#### Video Chapters/g)).toHaveLength(1)
    expect(twice).toContain('- 3:20 Demo')
  })

  it('removes the link section when the links are gone, and keeps the chapters', () => {
    const once = applyTimelineToDescription('Hi.', { chapters: CH, links })
    const out = applyTimelineToDescription(once, { chapters: CH, links: [] })
    expect(out).not.toContain('Video Links')
    expect(out).toContain('#### Video Chapters')
  })

  it('leaves an existing typed list alone when there are too few chapters to write', () => {
    const desc = 'x\n0:00 A\n1:00 B\n2:00 C'
    expect(applyTimelineToDescription(desc, { chapters: [] })).toBe(desc)
  })

  it('returns the description unchanged when there is nothing to do', () => {
    expect(applyTimelineToDescription('Just text  \n\n', {})).toBe('Just text  \n\n')
    expect(applyTimelineToDescription(undefined, {})).toBe('')
  })

  it('does not swallow prose that follows the link section', () => {
    const once = applyTimelineToDescription('Hi.', { links })
    const desc = `${once}\nA normal sentence after.`
    const out = applyTimelineToDescription(desc, { links: [] })
    expect(out).toBe('Hi.\n\nA normal sentence after.')
  })
})

describe('splitSystemTail and applyTimelineToBody', () => {
  const footer = '---\n\n▶️ [Watch on 3speak.tv](https://3speak.tv/watch?v=alice/my-vid)'
  const body = `My words.\n\n${footer}`

  it('splits off the footer 3Speak appends', () => {
    expect(splitSystemTail(body)).toEqual({ main: 'My words.\n', tail: footer })
  })

  it('splits off several system sections in a row, sound credits and banner included', () => {
    const tail = '---\n*Sound: Song by @x*\n---\n[Watch on 3Speak](https://3speak.tv/watch?v=a/b)\n[![banner](https://3speak.tv/banners/alice.png)](https://3speak.tv/@alice)'
    expect(splitSystemTail(`Text\n${tail}`)).toEqual({ main: 'Text', tail })
  })

  it("keeps a creator's own section after a rule in the main text", () => {
    const own = 'Text\n---\nMy own notes here'
    expect(splitSystemTail(own)).toEqual({ main: own, tail: '' })
  })

  it('places the chapters above the footer', () => {
    const out = applyTimelineToBody(body, { chapters: CH })
    expect(out).toBe(`My words.\n\n#### Video Chapters\n\n- 0:00 Intro\n- 1:05 Setup\n- 3:20 Demo\n\n${footer}`)
  })

  it('returns the body untouched when nothing changes', () => {
    expect(applyTimelineToBody(body, {})).toBe(body)
    expect(applyTimelineToBody(null, {})).toBe('')
  })

  it('works on a body without a footer', () => {
    expect(applyTimelineToBody('Text', { chapters: CH })).toBe('Text\n\n#### Video Chapters\n\n- 0:00 Intro\n- 1:05 Setup\n- 3:20 Demo')
  })
})

describe('activeLinksAt', () => {
  const links = [{ at: 10, dur: 8 }, { at: 15, dur: 3 }]

  it('shows a link from its start until just before start + dur', () => {
    expect(activeLinksAt(links, 9.9)).toEqual([])
    expect(activeLinksAt(links, 10)).toEqual([links[0]])
    expect(activeLinksAt(links, 16)).toEqual(links)
    expect(activeLinksAt(links, 18)).toEqual([])
  })

  it('returns [] for bad input', () => {
    expect(activeLinksAt(null, 10)).toEqual([])
    expect(activeLinksAt(links, NaN)).toEqual([])
  })
})
