// Playlist type (video / audio) and audio kind: what the owner chose, else
// worked out from the items (src/lib/playlistType.js).
import { describe, it, expect } from 'vitest'
import {
  trackCategoryToKind,
  kindFromCategories,
  storedPlaylistType,
  resolvePlaylistType,
  playlistTypeFields,
} from '../../../src/lib/playlistType.js'

const audio = (category) => ({ isAudio: true, category })
const video = { isAudio: false }

describe('trackCategoryToKind', () => {
  it('maps upload categories to kinds', () => {
    expect(trackCategoryToKind('song')).toBe('music')
    expect(trackCategoryToKind('music')).toBe('music')
    expect(trackCategoryToKind('voice_message')).toBe('voice')
    expect(trackCategoryToKind('interview')).toBe('podcast')
    expect(trackCategoryToKind('audiobook')).toBe('podcast')
    expect(trackCategoryToKind('podcast')).toBe('podcast')
    expect(trackCategoryToKind(undefined)).toBe('sounds')
  })
  it('picks the most common kind, ties to the earlier one', () => {
    expect(kindFromCategories(['song', 'song', 'podcast'])).toBe('music')
    expect(kindFromCategories(['song', 'podcast'])).toBe('podcast')
    expect(kindFromCategories([])).toBe(null)
  })
})

describe('storedPlaylistType', () => {
  it('ignores the indexer default `video` on its own', () => {
    expect(storedPlaylistType({ type: 'video' })).toEqual({ type: null, kind: null })
  })
  it('reads a top-level audio type and kind', () => {
    expect(storedPlaylistType({ type: 'audio', audio_kind: 'music' })).toEqual({ type: 'audio', kind: 'music' })
    expect(storedPlaylistType({ type: 'video', audio_kind: 'voice' })).toEqual({ type: 'audio', kind: 'voice' })
  })
  it('reads json_metadata, also double-encoded', () => {
    expect(storedPlaylistType({ type: 'video', json_metadata: '{"type":"audio"}' })).toEqual({ type: 'audio', kind: null })
    expect(storedPlaylistType({ json_metadata: JSON.stringify(JSON.stringify({ type: 'video' })) })).toEqual({ type: 'video', kind: null })
    expect(storedPlaylistType({ json_metadata: { type: 'audio', audio_kind: 'sounds' } })).toEqual({ type: 'audio', kind: 'sounds' })
  })
  it('an explicit video in json_metadata wins over a stray kind', () => {
    expect(storedPlaylistType({ audio_kind: 'music', json_metadata: '{"type":"video"}' })).toEqual({ type: 'video', kind: null })
  })
})

describe('resolvePlaylistType', () => {
  it('waits for items when nothing is stored', () => {
    expect(resolvePlaylistType({ type: 'video' }, null)).toEqual({ type: null, kind: null, chosen: false })
  })
  it('infers from items when nothing is stored', () => {
    expect(resolvePlaylistType({}, [audio('song'), audio('song')])).toEqual({ type: 'audio', kind: 'music', chosen: false })
    expect(resolvePlaylistType({}, [audio('song'), video])).toEqual({ type: 'video', kind: null, chosen: false })
    expect(resolvePlaylistType({}, [])).toEqual({ type: 'video', kind: null, chosen: false })
  })
  it('the owner choice wins over the items', () => {
    expect(resolvePlaylistType({ json_metadata: '{"type":"video"}' }, [audio('song')])).toEqual({ type: 'video', kind: null, chosen: true })
    expect(resolvePlaylistType({ type: 'audio', audio_kind: 'podcast' }, [audio('song')])).toEqual({ type: 'audio', kind: 'podcast', chosen: true })
  })
  it('an audio choice without a kind takes it from the tracks', () => {
    expect(resolvePlaylistType({ json_metadata: '{"type":"audio"}' }, [audio('voice_message')])).toEqual({ type: 'audio', kind: 'voice', chosen: true })
    expect(resolvePlaylistType({ json_metadata: '{"type":"audio"}' }, null)).toEqual({ type: 'audio', kind: 'podcast', chosen: true })
  })
})

describe('playlistTypeFields', () => {
  it('builds op fields', () => {
    expect(playlistTypeFields('audio', 'music')).toEqual({ type: 'audio', audio_kind: 'music', meta: { type: 'audio', audio_kind: 'music' } })
    expect(playlistTypeFields('audio', 'nope')).toEqual({ type: 'audio', audio_kind: 'podcast', meta: { type: 'audio', audio_kind: 'podcast' } })
    expect(playlistTypeFields('video', 'music')).toEqual({ type: 'video', audio_kind: '', meta: { type: 'video' } })
  })
})
