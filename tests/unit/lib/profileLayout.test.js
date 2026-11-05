// @vitest-environment jsdom
// Stored profile layouts (src/lib/profileLayout.js): defaults filled in on
// read, unknown and missing section types handled, the phone layout, compact
// saves with the 401 sign-in retry, and the small editor helpers. React Query
// is replaced by a pass-through so each hook's query function can be called
// directly; fetch and axios are stubbed.
import { describe, it, expect, beforeEach, vi } from 'vitest'

const h = vi.hoisted(() => ({ establishWalletSession: vi.fn(), axiosGet: vi.fn() }))
vi.mock('@tanstack/react-query', () => ({ useQuery: (options) => options }))
vi.mock('axios', () => ({ default: { get: h.axiosGet } }))
vi.mock('../../../src/hive-api/aioha', () => ({ establishWalletSession: h.establishWalletSession }))
vi.mock('../../../src/utils/config', () => ({ CHECKER_URL: 'https://checker.test' }))

import {
  LINKS_SIDES,
  SECTION_DEFS,
  DEFAULT_SECTIONS,
  GRID_COLUMNS,
  layoutRows,
  withDefaults,
  normalizeLayout,
  mobileSections,
  moveInColumn,
  newSectionId,
  fetchProfileLayout,
  useProfileLayout,
  saveProfileLayout,
  resetProfileLayout,
  isShowablePlaylist,
  useProfileAudioPlaylists,
  layoutTourSeen,
  markLayoutTourSeen,
  LAYOUT_EDIT_EVENT,
  requestLayoutEdit,
  takeLayoutEditRequest,
} from '../../../src/lib/profileLayout.js'

const response = (status, body = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => body })

beforeEach(() => {
  h.establishWalletSession.mockReset()
  h.axiosGet.mockReset()
  localStorage.clear()
})

describe('module surface', () => {
  it('re-exports the grid helpers', () => {
    expect(GRID_COLUMNS).toBe(12)
    expect(typeof layoutRows).toBe('function')
  })

  it('knows every default section type', () => {
    DEFAULT_SECTIONS.forEach((s) => expect(SECTION_DEFS[s.type]).toBeTruthy())
    expect(LINKS_SIDES).toEqual(['right', 'left', 'none'])
  })
})

describe('withDefaults', () => {
  it('fills in a rail section', () => {
    expect(withDefaults({ id: 'videos', type: 'videos' })).toEqual({
      id: 'videos', type: 'videos', hidden: false, count: 20, view: 'row', span: 12, stack: false,
    })
  })

  it('keeps the creator values and clamps the width', () => {
    expect(withDefaults({ id: 'a', type: 'audio', hidden: true, count: 3, view: 'grid', span: 1, stack: true }))
      .toMatchObject({ hidden: true, count: 3, view: 'grid', span: 3, stack: true })
  })

  it.each([
    [{ size: 'lg' }, 'lg'],
    [{ size: 'huge' }, 'md'],
    [{}, 'md'],
  ])('reads the trailer size %o as %s', (extra, size) => {
    expect(withDefaults({ id: 't', type: 'trailer', ...extra }).size).toBe(size)
  })

  it('takes trailer switches only when they are real booleans', () => {
    const t = withDefaults({ id: 't', type: 'trailer', showInfo: false, showSnap: 'no' })
    expect(t.showInfo).toBe(false)
    expect(t.showSnap).toBe(true)
  })

  it.each([
    ['left', 'left'],
    ['none', 'none'],
    ['middle', 'right'],
    [undefined, 'right'],
  ])('reads the links side %s as %s', (side, expected) => {
    expect(withDefaults({ id: 'l', type: 'links', side }).side).toBe(expected)
  })

  it('fills in the playlist rail count and answers bare defaults for an unknown type', () => {
    expect(withDefaults({ id: 'p', type: 'playlistRails' }).playlists).toBe(5)
    expect(withDefaults({ id: 'x', type: 'mystery' })).toEqual({ id: 'x', type: 'mystery', hidden: false, span: 12, stack: false })
  })

  it('treats only hidden === true as hidden', () => {
    expect(withDefaults({ id: 'v', type: 'videos', hidden: 'yes' }).hidden).toBe(false)
  })
})

describe('normalizeLayout', () => {
  it('answers today\'s Overview when nothing is stored', () => {
    const out = normalizeLayout(null)
    expect(out.map((s) => s.id)).toEqual(DEFAULT_SECTIONS.map((s) => s.id))
    expect(out.find((s) => s.type === 'audioPlaylists').hidden).toBe(true)
    expect(out.find((s) => s.type === 'videos').hidden).toBe(false)
  })

  it('drops unknown types and appends section types the layout predates, switched off', () => {
    const out = normalizeLayout([
      { id: 'videos', type: 'videos', count: 4 },
      { id: 'weird', type: 'weird' },
      null,
      { id: 'pl-1', type: 'playlist', playlistId: 'x' },
    ])
    expect(out[0]).toMatchObject({ id: 'videos', count: 4, hidden: false })
    expect(out.map((s) => s.id)).not.toContain('weird')
    const appended = out.slice(2)
    expect(appended.every((s) => s.hidden)).toBe(true)
    expect(appended.map((s) => s.type)).not.toContain('videos')
    // A playlist section may appear many times, so it is never auto-added.
    expect(out.filter((s) => s.type === 'playlist')).toHaveLength(1)
    expect(appended).toHaveLength(DEFAULT_SECTIONS.length - 1)
  })
})

describe('mobileSections', () => {
  const desktop = normalizeLayout([
    { id: 'videos', type: 'videos', span: 6 },
    { id: 'shorts', type: 'shorts', span: 6, stack: true },
    { id: 'links', type: 'links' },
    { id: 'audio', type: 'audio' },
  ]).slice(0, 4)

  it('follows the desktop order as one full column without the links page', () => {
    const out = mobileSections(desktop, null)
    expect(out.map((s) => [s.id, s.span, s.stack])).toEqual([['videos', 12, false], ['shorts', 12, false], ['audio', 12, false]])
  })

  it('keeps the phone order and settings, skipping unknown and repeated entries, then adds the rest', () => {
    const out = mobileSections(desktop, [
      { id: 'audio', count: 2, view: 'grid', span: 3, type: 'videos' },
      { id: 'gone' },
      null,
      { id: 'audio' },
      { id: 'links' },
      { id: 'videos', hidden: true },
    ])
    expect(out.map((s) => s.id)).toEqual(['audio', 'videos', 'shorts'])
    // Phone-only fields come from the stored entry; the type and width never do.
    expect(out[0]).toMatchObject({ type: 'audio', count: 2, view: 'grid', span: 12 })
    expect(out[1].hidden).toBe(true)
  })
})

describe('moveInColumn', () => {
  const list = ['a', 'b', 'c', 'd'].map((id) => ({ id }))

  it.each([
    ['d', 'b', 'top', ['a', 'd', 'b', 'c']],
    ['a', 'c', 'bottom', ['b', 'c', 'a', 'd']],
    ['b', 'missing', 'top', ['a', 'c', 'd', 'b']],
  ])('moves %s to the %s of %s', (active, over, side, expected) => {
    expect(moveInColumn(list, active, over, side).map((s) => s.id)).toEqual(expected)
  })

  it('leaves the list alone for itself or an unknown section', () => {
    expect(moveInColumn(list, 'a', 'a', 'top')).toBe(list)
    expect(moveInColumn(list, 'zz', 'a', 'top')).toBe(list)
  })
})

describe('newSectionId', () => {
  it('lowercases the type and adds a short random suffix', () => {
    expect(newSectionId('Playlist')).toMatch(/^playlist-[a-z0-9]{1,6}$/)
    expect(newSectionId('playlist')).not.toBe(newSectionId('playlist'))
  })
})

describe('fetchProfileLayout and useProfileLayout', () => {
  it('reads the stored layout for the lowercased, encoded user', async () => {
    const f = vi.fn().mockResolvedValue(response(200, { layout: { sections: [] } }))
    vi.stubGlobal('fetch', f)
    expect(await fetchProfileLayout('Al ice')).toEqual({ sections: [] })
    expect(f).toHaveBeenCalledWith('/api/profile-layout/al%20ice')
  })

  it('answers null when there is no stored layout and throws on an error status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response(200, {})).mockResolvedValueOnce(response(500)))
    expect(await fetchProfileLayout('bob')).toBeNull()
    await expect(fetchProfileLayout('bob')).rejects.toThrow('layout 500')
  })

  it('queries per lowercased user and only with a user', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(200, { layout: 'L' })))
    const q = useProfileLayout('Bob')
    expect(q.queryKey).toEqual(['profile-layout', 'bob'])
    expect(q.enabled).toBe(true)
    expect(await q.queryFn()).toBe('L')
    expect(useProfileLayout(null)).toMatchObject({ enabled: false, queryKey: ['profile-layout', ''] })
  })
})

describe('saveProfileLayout and resetProfileLayout', () => {
  it('stores only values that differ from their defaults', async () => {
    const f = vi.fn().mockResolvedValue(response(200, { layout: { ok: 1 } }))
    vi.stubGlobal('fetch', f)
    const sections = normalizeLayout([
      { id: 'trailer', type: 'trailer', size: 'lg', showInfo: false },
      { id: 'videos', type: 'videos', count: 20, view: 'grid', title: '  My videos  ', span: 6 },
      { id: 'shorts', type: 'shorts', stack: true, title: '   ' },
      { id: 'pr', type: 'playlistRails', playlists: 7 },
      { id: 'links', type: 'links', side: 'left' },
      { id: 'pl', type: 'playlist', playlistId: 'abc', count: 10 },
    ]).slice(0, 6)
    const mobile = [withDefaults({ id: 'videos', type: 'videos', span: 6, stack: true, hidden: true, count: 5 }),
      withDefaults({ id: 'links', type: 'links', side: 'left' }),
      withDefaults({ id: 'trailer', type: 'trailer', size: 'sm', showSnap: false })]

    expect(await saveProfileLayout('Alice', sections, mobile)).toEqual({ ok: 1 })

    const [url, init] = f.mock.calls[0]
    expect(url).toBe('/api/profile-layout')
    expect(init).toMatchObject({ method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' } })
    const body = JSON.parse(init.body)
    expect(body.user).toBe('alice')
    expect(body.sections).toEqual([
      { id: 'trailer', type: 'trailer', size: 'lg', showInfo: false },
      { id: 'videos', type: 'videos', view: 'grid', title: 'My videos', span: 6 },
      { id: 'shorts', type: 'shorts', stack: true },
      { id: 'pr', type: 'playlistRails', playlists: 7 },
      { id: 'links', type: 'links', side: 'left' },
      { id: 'pl', type: 'playlist', playlistId: 'abc' },
    ])
    // The phone layout drops what a single column cannot use.
    expect(body.mobile).toEqual([
      { id: 'videos', type: 'videos', hidden: true, count: 5 },
      { id: 'links', type: 'links' },
      { id: 'trailer', type: 'trailer' },
    ])
  })

  it('sends null for the phone layout when phones follow the desktop', async () => {
    const f = vi.fn().mockResolvedValue(response(200, {}))
    vi.stubGlobal('fetch', f)
    expect(await saveProfileLayout('a', [])).toBeNull()
    expect(JSON.parse(f.mock.calls[0][1].body).mobile).toBeNull()
  })

  it('signs in once on a 401 and tries the write again', async () => {
    const f = vi.fn().mockResolvedValueOnce(response(401)).mockResolvedValueOnce(response(200, { layout: 'saved' }))
    vi.stubGlobal('fetch', f)
    expect(await resetProfileLayout('Alice')).toBe('saved')
    expect(h.establishWalletSession).toHaveBeenCalledWith('Alice')
    expect(f).toHaveBeenCalledTimes(2)
    expect(f.mock.calls[0][1].method).toBe('DELETE')
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ user: 'alice' })
  })

  it('says sign-in is needed when the second try is still refused, even if signing failed', async () => {
    h.establishWalletSession.mockRejectedValue(new Error('declined'))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(401)))
    await expect(saveProfileLayout('a', [])).rejects.toMatchObject({ message: 'sign-in-needed', status: 401 })
  })

  it('surfaces other refusals with their status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(403)))
    await expect(saveProfileLayout('a', [])).rejects.toMatchObject({ message: 'layout 403', status: 403 })
    expect(h.establishWalletSession).not.toHaveBeenCalled()
  })
})

describe('isShowablePlaylist', () => {
  it.each([
    [{ access: 'public', name: 'Mix', items: [1] }, true],
    [{ access: 'private', name: 'Mix', items: [1] }, false],
    [{ access: 'public', name: 'Watch Later', items: [1] }, false],
    [{ access: 'public', name: 'Empty', items: [] }, false],
    [{ access: 'public', name: 'No items' }, false],
    [null, false],
  ])('%o -> %s', (playlist, expected) => {
    expect(!!isShowablePlaylist(playlist)).toBe(expected)
  })
})

describe('useProfileAudioPlaylists', () => {
  it('lists the owner albums first, then their listener playlists, dropping other owners', async () => {
    h.axiosGet.mockResolvedValue({
      data: {
        by_artist: [{ id: 1, owner: 'Alice' }, { id: 2, owner: 'bob' }],
        by_listeners: [{ id: 3, owner: 'alice' }],
      },
    })
    const q = useProfileAudioPlaylists('alice')
    expect(q.queryKey).toEqual(['profile-audio-playlists', 'alice'])
    const out = await q.queryFn()
    expect(h.axiosGet).toHaveBeenCalledWith('https://checker.test/audio/playlists?owner=alice&limit=24')
    expect(out).toEqual([{ id: 1, owner: 'Alice', _kind: 'artist' }, { id: 3, owner: 'alice', _kind: 'listener' }])
  })

  it('copes with an empty answer and is disabled without a user', async () => {
    h.axiosGet.mockResolvedValue({ data: null })
    expect(await useProfileAudioPlaylists('a').queryFn()).toEqual([])
    expect(useProfileAudioPlaylists(undefined).enabled).toBe(false)
  })
})

describe('the layout tour flag', () => {
  it('is unseen until marked', () => {
    expect(layoutTourSeen()).toBe(false)
    markLayoutTourSeen()
    expect(layoutTourSeen()).toBe(true)
  })

  it('counts as seen when storage is blocked, and marking it then does not throw', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    expect(layoutTourSeen()).toBe(true)
    expect(() => markLayoutTourSeen()).not.toThrow()
  })
})

describe('requestLayoutEdit', () => {
  it('fires the customize event and leaves a one-time request for a later Overview', () => {
    const heard = vi.fn()
    window.addEventListener(LAYOUT_EDIT_EVENT, heard)
    requestLayoutEdit()
    window.removeEventListener(LAYOUT_EDIT_EVENT, heard)
    expect(heard).toHaveBeenCalledTimes(1)
    expect(takeLayoutEditRequest()).toBe(true)
    expect(takeLayoutEditRequest()).toBe(false)
  })
})
