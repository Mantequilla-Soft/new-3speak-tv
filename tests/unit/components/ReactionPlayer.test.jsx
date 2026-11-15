// @vitest-environment jsdom
// The reaction player's comment thread (components/ReactionPlayer/ReactionPlayer.jsx):
// the replies under the selected reaction, loaded from Hive, with bots on the
// global comment mutelist removed together with the replies under them.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from './_render.jsx'

const m = vi.hoisted(() => ({}))
vi.mock('../../../src/utils/hiveNode', async (orig) => ({ ...(await orig()), getHiveClient: () => ({ call: (...a) => m.call(...a) }), getHiveUrl: () => 'https://api.hive.example' }))
vi.mock('@hiveio/dhive', () => ({ Client: class { } }))
vi.mock('../../../src/lib/hiveRenderer', () => ({ getHiveRenderer: async () => (md) => `<p>${md}</p>` }))
vi.mock('../../../src/utils/reputation', () => ({ markByReputation: async (list) => list }))
vi.mock('../../../src/utils/hiddenCreators', async () => ({
  dropMuted: (await vi.importActual('../../../src/utils/hiddenCreators')).dropMuted,
  markByHidden: async (list, { viewer } = {}) => {
    const tag = (items) => items.map((c) => ({
      ...c,
      ...(c.author === 'ai-agent-hunter' && c.author !== viewer ? { isMuted: true } : {}),
      children: tag(c.children || []),
    }))
    return tag(list)
  },
}))
vi.mock('../../../src/components/modal/ReportModal', () => ({ default: () => null, isReported: () => false }))
vi.mock('../../../src/components/TranslateButton/TranslateButton', () => ({ default: () => null }))

const { useAppStore } = await import('../../../src/lib/store')
const { default: ReactionPlayer } = await import('../../../src/components/ReactionPlayer/ReactionPlayer.jsx')

const raw = (author, permlink, children = 0) => ({ author, permlink, body: `Body of ${permlink}`, children })
const THREAD = {
  'fan/c1': [raw('fan2', 'r1'), raw('ai-agent-hunter', 'bot1', 1)],
  'ai-agent-hunter/bot1': [raw('fan3', 'r2')],
}

const mount = () => renderWithProviders(
  <ReactionPlayer
    reactions={[{ id: 'reaction-0', author: 'fan', avatar: '', body: 'Main reaction', permlink: 'c1', pct: 10, pctIsSeconds: true, type: 'comment', replyCount: 2 }]}
    selectedIndex={0}
    onSelectReaction={() => {}}
    onClose={() => {}}
    size="standard"
    onSetSize={() => {}}
  />,
)

beforeEach(() => {
  Element.prototype.scrollTo = Element.prototype.scrollTo || function scrollTo() {}
  m.call = vi.fn(async (_api, _method, [a, p]) => THREAD[`${a}/${p}`] || [])
  useAppStore.setState({ user: null })
})

describe('the reaction thread', () => {
  it('drops a muted bot\'s reply and everything under it', async () => {
    mount()
    expect(await screen.findByText('Body of r1')).toBeInTheDocument()
    expect(screen.queryByText('Body of bot1')).not.toBeInTheDocument()
    expect(screen.queryByText('Body of r2')).not.toBeInTheDocument()
    expect(screen.queryByText('ai-agent-hunter')).not.toBeInTheDocument()
  })

  it('shows a muted account its own replies', async () => {
    useAppStore.setState({ user: 'ai-agent-hunter' })
    mount()
    expect(await screen.findByText('Body of bot1')).toBeInTheDocument()
    expect(screen.getByText('Body of r2')).toBeInTheDocument()
  })
})
