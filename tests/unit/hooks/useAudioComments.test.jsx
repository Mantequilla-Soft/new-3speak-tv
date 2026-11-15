// @vitest-environment jsdom
// The replies to the audio playing (components/GlobalAudioPlayer/useAudioComments.js),
// for the player's Comments panel and the audio post page: one Hive read, and bots
// on the global comment mutelist left out (never the viewer's own replies).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

const m = vi.hoisted(() => ({}))
vi.mock('axios', async (orig) => { const real = (await orig()).default; return { default: Object.assign(Object.create(real), { create: real.create, post: (...a) => m.post(...a) }) } })
vi.mock('../../../src/utils/hiveNode', async (orig) => ({ ...(await orig()), getHiveUrl: () => 'https://api.hive.example' }))
vi.mock('../../../src/utils/hiddenCreators', () => ({ batchCheckFlags: (...a) => m.flags(...a) }))

const { useAppStore } = await import('../../../src/lib/store')
const { default: useAudioComments } = await import('../../../src/components/GlobalAudioPlayer/useAudioComments.js')

const reply = (author, permlink, at) => ({ author, permlink, body: `**hi** from ${author}`, json_metadata: JSON.stringify(at == null ? {} : { parentTimestamp: at }) })

beforeEach(() => {
  m.post = vi.fn(async () => ({ data: { result: [reply('fan', 'c1', 12), reply('AI-Agent-Hunter', 'bot1', 20), reply('fan2', 'c2')] } }))
  m.flags = vi.fn(async () => ({ hidden: new Set(), muted: new Set(['ai-agent-hunter']) }))
  useAppStore.setState({ user: null })
})

describe('useAudioComments', () => {
  it('lists the replies as plain text with their moment, without muted bots', async () => {
    const { result } = renderHook(() => useAudioComments('badadib', 'episode-1'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.items).toEqual([
      { author: 'fan', permlink: 'c1', text: 'hi from fan', at: 12 },
      { author: 'fan2', permlink: 'c2', text: 'hi from fan2', at: null },
    ])
    expect(m.flags).toHaveBeenCalledWith(['fan', 'AI-Agent-Hunter', 'fan2'])
  })

  it('keeps the viewer\'s own replies, and everything when the lookup mutes nobody', async () => {
    useAppStore.setState({ user: 'ai-agent-hunter' })
    const { result } = renderHook(() => useAudioComments('badadib', 'episode-1'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.items.map((c) => c.author)).toEqual(['fan', 'AI-Agent-Hunter', 'fan2'])
  })
})
