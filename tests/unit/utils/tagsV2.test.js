// The v2 tag taxonomy and the per-video tag lookup (src/utils/tagsV2.js).
import { describe, it, expect, vi, beforeEach } from 'vitest'

const axios = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('axios', () => ({ default: axios }))
vi.mock('../../../src/utils/config', () => ({ CHECKER_URL: 'https://checker.test' }))
vi.mock('../../../src/i18n', () => ({ t: (k) => `T(${k})` }))

const load = async () => {
  vi.resetModules()
  return import('../../../src/utils/tagsV2.js')
}
const m = await load()

beforeEach(() => axios.get.mockReset())

describe('taxonomy', () => {
  it('has 7 categories and 29 topics with unique slugs, vlog the only one the tagger never emits', () => {
    expect(m.TAG_CATEGORIES).toHaveLength(7)
    expect(m.ALL_TOPICS).toHaveLength(29)
    expect(m.ALL_TOPIC_SLUGS.filter((s) => !m.isAutoTaggerSlug(s))).toEqual(['vlog'])
    const all = [...m.TAG_CATEGORIES.map((c) => c.slug), ...m.ALL_TOPIC_SLUGS]
    expect(new Set(all).size).toBe(all.length)
  })

  it('every slug has an i18n label key and an emoji', () => {
    for (const c of m.TAG_CATEGORIES) {
      expect(c.labelKey).toBe(`tags.labels.${c.slug}`)
      for (const t of c.topics) {
        expect(t.labelKey).toBe(`tags.labels.${t.slug}`)
        expect(t.emoji).toBeTruthy()
      }
    }
  })

  it('flat options carry their category', () => {
    expect(m.TAG_OPTIONS.find((o) => o.id === 'programming')).toEqual({
      id: 'programming', labelKey: 'tags.labels.programming', emoji: '⌨️', category: 'tech-science',
    })
  })

  it('knows categories, topics and the viewer-only vlog tag', () => {
    expect(m.isKnownTag('tech-science')).toBe(true)
    expect(m.isKnownTag('programming')).toBe(true)
    expect(m.isKnownTag('vlog')).toBe(true)
    expect(m.isKnownTag('tutorial')).toBe(false)
    expect(m.isKnownTag('')).toBe(false)
    expect(m.isCategorySlug('tech-science')).toBe(true)
    expect(m.isCategorySlug('programming')).toBe(false)
    expect(m.isCategorySlug('nope')).toBe(false)
    expect(m.isAutoTaggerSlug('programming')).toBe(true)
    expect(m.isAutoTaggerSlug('vlog')).toBe(false)
  })

  it('gives labels, emoji and the category a tag rolls up to', () => {
    expect(m.getTagLabel('film-tv')).toBe('T(tags.labels.film-tv)')
    expect(m.getTagLabel('unknown-slug')).toBe('unknown-slug')
    expect(m.getTagEmoji('pets')).toBe('🐾')
    expect(m.getTagEmoji('nope')).toBe('')
    expect(m.getCategoryOf('pets')).toBe('food-outdoor')
    expect(m.getCategoryOf('food-outdoor')).toBe('food-outdoor')
    expect(m.getCategoryOf('nope')).toBeNull()
  })
})

describe('getVideoTagsV2', () => {
  it('keeps only known tags and reads the AI flag strictly', async () => {
    const t = await load()
    axios.get.mockResolvedValue({ data: { tagsV2: ['music', 'made-up', 'entertainment'], tagModelV2: 'm1', aiGenerated: 'yes' } })
    expect(await t.getVideoTagsV2('alice', 'my vid')).toEqual({ tags: ['music', 'entertainment'], model: 'm1', aiGenerated: false })
    expect(axios.get).toHaveBeenCalledWith('https://checker.test/transcription-tags/alice/my%20vid')
  })

  it('caches a real answer and shares one request between callers', async () => {
    const t = await load()
    axios.get.mockResolvedValue({ data: { tagsV2: ['news'], aiGenerated: true } })
    const [a, b] = await Promise.all([t.getVideoTagsV2('a', 'p'), t.getVideoTagsV2('a', 'p')])
    expect(a).toEqual({ tags: ['news'], model: null, aiGenerated: true })
    expect(b).toBe(a)
    expect(await t.getVideoTagsV2('a', 'p')).toBe(a)
    expect(t.getCachedTagsV2('a', 'p')).toBe(a)
    expect(axios.get).toHaveBeenCalledTimes(1)
  })

  it('reads an untagged video as no tags', async () => {
    const t = await load()
    axios.get.mockResolvedValue({ data: {} })
    expect(await t.getVideoTagsV2('a', 'p')).toEqual({ tags: [], model: null, aiGenerated: false })
  })

  it('never throws, and retries after a failure', async () => {
    const t = await load()
    axios.get.mockRejectedValueOnce(new Error('down'))
    expect(await t.getVideoTagsV2('a', 'p')).toEqual({ tags: [], model: null, aiGenerated: false })
    expect(t.getCachedTagsV2('a', 'p')).toBeUndefined()
    axios.get.mockResolvedValue({ data: { tagsV2: ['art'] } })
    expect((await t.getVideoTagsV2('a', 'p')).tags).toEqual(['art'])
  })

  it('needs both author and permlink', async () => {
    const t = await load()
    expect(await t.getVideoTagsV2('', 'p')).toEqual({ tags: [], model: null, aiGenerated: false })
    expect(t.getCachedTagsV2('a', '')).toBeUndefined()
    expect(axios.get).not.toHaveBeenCalled()
  })

  it('prefetch warms the cache once', async () => {
    const t = await load()
    axios.get.mockResolvedValue({ data: { tagsV2: ['art'] } })
    t.prefetchVideoTagsV2('a', 'p')
    t.prefetchVideoTagsV2('a', 'p')
    t.prefetchVideoTagsV2('', 'p')
    await vi.waitFor(() => expect(t.getCachedTagsV2('a', 'p')).toBeDefined())
    t.prefetchVideoTagsV2('a', 'p')
    expect(axios.get).toHaveBeenCalledTimes(1)
  })
})
