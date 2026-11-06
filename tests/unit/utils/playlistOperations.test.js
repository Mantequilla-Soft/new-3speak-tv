// Playlist operations (src/utils/playlistOperations.js): every action becomes a
// 3speak_playlist_* custom_json signed with the posting key. Signing is mocked,
// so these tests assert the exact operations and never broadcast anything.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ customJson: vi.fn(), broadcast: vi.fn(), user: vi.fn() }))
vi.mock('../../../src/hive-api/aioha', () => ({
  customJsonWithAioha: h.customJson,
  broadcastWithAioha: h.broadcast,
  getOperationUser: h.user,
}))
vi.mock('@aioha/aioha', () => ({ KeyTypes: { Posting: 'posting', Active: 'active' } }))

import {
  createPlaylist, addToPlaylist, removeFromPlaylist, reorderInPlaylist, updatePlaylist,
  deletePlaylist, createPlaylistAndAdd, executePlaylistChanges, PlaylistActionTypes,
} from '../../../src/utils/playlistOperations.js'

beforeEach(() => {
  h.customJson.mockReset().mockResolvedValue({ success: true, result: 'tx1' })
  h.broadcast.mockReset().mockResolvedValue({ success: true })
  h.user.mockReset().mockReturnValue('alice')
})

// The last custom_json as [key, id, parsed payload, display title].
const lastOp = () => {
  const [key, id, json, title] = h.customJson.mock.calls.at(-1)
  return [key, id, JSON.parse(json), title]
}

describe('createPlaylist', () => {
  it('sends just a name and access for a plain playlist', async () => {
    await createPlaylist('Road trip')
    expect(lastOp()).toEqual(['posting', '3speak_playlist_create', { name: 'Road trip', access: 'public' }, 'Create Playlist'])
  })

  it('adds an id, and folds tags, type and extra metadata into json_metadata', async () => {
    await createPlaylist('Album', 'private', 'pl-1', ['rock'], 'audio', { album: { credits: 'me' } })
    const [, , payload] = lastOp()
    expect(payload).toEqual({ name: 'Album', access: 'private', playlist_id: 'pl-1', json_metadata: expect.any(String) })
    expect(JSON.parse(payload.json_metadata)).toEqual({ tags: ['rock'], type: 'audio', album: { credits: 'me' } })
  })

  it('ignores extra metadata that is not an object', async () => {
    await createPlaylist('X', 'public', null, [], null, 'junk')
    expect(lastOp()[2]).not.toHaveProperty('json_metadata')
  })

  it('returns whatever signing returned, and passes a failure through', async () => {
    expect(await createPlaylist('X')).toEqual({ success: true, result: 'tx1' })
    h.customJson.mockRejectedValueOnce(new Error('user cancelled'))
    await expect(createPlaylist('X')).rejects.toThrow('user cancelled')
  })
})

describe('item operations', () => {
  it.each([
    ['add (default position 0)', () => addToPlaylist('pl', 'bob', 'v1'), 'add',
      { playlist_id: 'pl', author: 'bob', permlink: 'v1', position: 0 }, 'Add to Playlist'],
    ['add at a position', () => addToPlaylist('pl', 'bob', 'v1', 4), 'add',
      { playlist_id: 'pl', author: 'bob', permlink: 'v1', position: 4 }, 'Add to Playlist'],
    ['remove', () => removeFromPlaylist('pl', 'bob', 'v1'), 'remove',
      { playlist_id: 'pl', author: 'bob', permlink: 'v1' }, 'Remove from Playlist'],
    ['reorder', () => reorderInPlaylist('pl', 'bob', 'v1', 2), 'reorder',
      { playlist_id: 'pl', author: 'bob', permlink: 'v1', new_position: 2 }, 'Reorder Playlist'],
    ['delete', () => deletePlaylist('pl'), 'delete', { playlist_id: 'pl' }, 'Delete Playlist'],
  ])('%s builds the right custom_json', async (_name, act, op, payload, title) => {
    await act()
    expect(lastOp()).toEqual(['posting', `3speak_playlist_${op}`, payload, title])
  })
})

describe('updatePlaylist', () => {
  it('sends only the fields that were given, including falsy ones', async () => {
    await updatePlaylist('pl', { name: '', access: 'private', thumbnail: null })
    expect(lastOp()[2]).toEqual({ playlist_id: 'pl', name: '', access: 'private', thumbnail: null })
  })

  it('passes metadata through in both shapes', async () => {
    await updatePlaylist('pl', { json_metadata: '{"a":1}', metadata: { b: 2 } })
    expect(lastOp()[1]).toBe('3speak_playlist_update')
    expect(lastOp()[2]).toEqual({ playlist_id: 'pl', json_metadata: '{"a":1}', metadata: { b: 2 } })
  })

  it('with no fields it only names the playlist', async () => {
    await updatePlaylist('pl')
    expect(lastOp()[2]).toEqual({ playlist_id: 'pl' })
  })
})

describe('createPlaylistAndAdd', () => {
  it('creates and adds in one transaction signed by the session user', async () => {
    await createPlaylistAndAdd('Faves', 'public', 'pl-9', 'bob', 'v1', ['music'])
    expect(h.customJson).not.toHaveBeenCalled()
    const [ops, key] = h.broadcast.mock.calls[0]
    expect(key).toBe('posting')
    expect(ops.map(([type, op]) => [type, op.id, op.required_auths, op.required_posting_auths, JSON.parse(op.json)])).toEqual([
      ['custom_json', '3speak_playlist_create', [], ['alice'],
        { name: 'Faves', access: 'public', playlist_id: 'pl-9', json_metadata: JSON.stringify({ tags: ['music'] }) }],
      ['custom_json', '3speak_playlist_add', [], ['alice'],
        { playlist_id: 'pl-9', author: 'bob', permlink: 'v1', position: 0 }],
    ])
  })

  it('leaves json_metadata out without tags', async () => {
    await createPlaylistAndAdd('Faves', 'public', 'pl-9', 'bob', 'v1')
    expect(JSON.parse(h.broadcast.mock.calls[0][0][0][1].json)).not.toHaveProperty('json_metadata')
  })

  it('refuses to build operations without a signed-in user', async () => {
    h.user.mockReturnValue(null)
    await expect(createPlaylistAndAdd('F', 'public', 'p', 'b', 'v')).rejects.toThrow('Not logged in')
    expect(h.broadcast).not.toHaveBeenCalled()
  })
})

describe('executePlaylistChanges', () => {
  it('runs changes in order, one transaction each, reporting progress', async () => {
    const onProgress = vi.fn()
    const changes = [
      { type: PlaylistActionTypes.REORDER, author: 'a', permlink: 'p1', newPosition: 3 },
      { type: PlaylistActionTypes.REMOVE, author: 'b', permlink: 'p2' },
    ]
    const res = await executePlaylistChanges('pl', changes, onProgress)
    expect(h.customJson.mock.calls.map((c) => c[1])).toEqual(['3speak_playlist_reorder', '3speak_playlist_remove'])
    expect(onProgress.mock.calls).toEqual([[1, 2, changes[0]], [2, 2, changes[1]]])
    expect(res).toEqual({
      total: 2,
      failed: [],
      success: [{ ...changes[0], result: { success: true, result: 'tx1' } }, { ...changes[1], result: { success: true, result: 'tx1' } }],
    })
  })

  it('keeps going past a failed or unknown change and reports each failure', async () => {
    h.customJson.mockRejectedValueOnce(new Error('RC exhausted'))
    const res = await executePlaylistChanges('pl', [
      { type: 'remove', author: 'a', permlink: 'p1' },
      { type: 'rename', author: 'a', permlink: 'p2' },
      { type: 'remove', author: 'a', permlink: 'p3' },
    ])
    expect(res.failed).toEqual([
      { type: 'remove', author: 'a', permlink: 'p1', error: 'RC exhausted' },
      { type: 'rename', author: 'a', permlink: 'p2', error: 'Unknown action type: rename' },
    ])
    expect(res.success.map((s) => s.permlink)).toEqual(['p3'])
  })

  it('an empty batch does nothing', async () => {
    expect(await executePlaylistChanges('pl', [])).toEqual({ success: [], failed: [], total: 0 })
    expect(h.customJson).not.toHaveBeenCalled()
  })
})
