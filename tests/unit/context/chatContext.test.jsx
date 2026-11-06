// The chat state behind the overlay and /chat (src/context/ChatContext.jsx): the
// silent connect once per login, the manual Connect that may ask the wallet, the
// logout that drops everything, warm-up users chatting as `~<id>`, and the
// conversation actions (open a DM, create a private room, join and leave).
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

vi.mock('@snapie/chat-client/react', () => ({ ChatProvider: ({ children }) => children }))
vi.mock('../../../src/i18n', () => ({ t: (key) => key }))
vi.mock('../../../src/lib/store', async () => {
  const { create } = await import('zustand')
  return { useAppStore: create(() => ({ user: null, authenticated: false, incubationHandle: null })) }
})

// A stand-in for the Snapie SDK client: it is "authenticated" as whoever the
// last successful sign-in named.
const chat = vi.hoisted(() => ({ client: null, authenticateChat: null, authenticateWarmupChat: null, canSign: true }))
function makeClient() {
  let name = null
  return {
    isAuthenticated: vi.fn(() => !!name),
    getUsername: vi.fn(() => name),
    logout: vi.fn(() => { name = null }),
    _signInAs: (n) => { name = n },
    openDm: vi.fn(async () => ({ _id: 'dm-1' })),
    createGroup: vi.fn(async ({ name: n }) => ({ _id: 'g-1', name: n })),
    addGroupMember: vi.fn(async (id, m) => ({ _id: id, name: 'Room', members: [m] })),
    joinChannel: vi.fn(async () => {}),
    leaveChannel: vi.fn(async () => {}),
    removeGroupMember: vi.fn(async () => {}),
  }
}
vi.mock('../../../src/lib/snapieChat', () => ({
  getChatClient: () => chat.client,
  authenticateChat: (...a) => chat.authenticateChat(...a),
  authenticateWarmupChat: (...a) => chat.authenticateWarmupChat(...a),
  canSignChatChallenge: () => chat.canSign,
  isWarmupChatId: (id) => typeof id === 'string' && id.startsWith('~'),
}))

const { useAppStore } = await import('../../../src/lib/store')
const { ChatProvider, useChat } = await import('../../../src/context/ChatContext.jsx')

const wrapper = ({ children }) => <ChatProvider>{children}</ChatProvider>
const mount = () => renderHook(() => useChat(), { wrapper })

beforeEach(() => {
  chat.client = makeClient()
  chat.canSign = true
  chat.authenticateChat = vi.fn(async (u) => { chat.client._signInAs(u) })
  chat.authenticateWarmupChat = vi.fn(async () => { chat.client._signInAs('~w123') })
  useAppStore.setState({ user: null, authenticated: false, incubationHandle: null })
})

describe('connecting', () => {
  it('a logged-out visitor is not connected and nothing is attempted', () => {
    const { result } = mount()
    expect(result.current).toMatchObject({ ready: false, connecting: false, chatUser: null, warmup: false })
    expect(chat.authenticateChat).not.toHaveBeenCalled()
  })

  it('a logged-in user is connected silently, without a wallet popup', async () => {
    useAppStore.setState({ user: 'badadib', authenticated: true })
    const { result } = mount()
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(chat.authenticateChat).toHaveBeenCalledWith('badadib', { allowClientFallback: false })
    expect(result.current.chatUser).toBe('badadib')
  })

  it('reuses a token the client already holds for this user', () => {
    chat.client._signInAs('badadib')
    useAppStore.setState({ user: 'badadib', authenticated: true })
    const { result } = mount()
    expect(result.current.ready).toBe(true)
    expect(chat.authenticateChat).not.toHaveBeenCalled()
  })

  it('drops a token that belongs to someone else before signing in', async () => {
    chat.client._signInAs('someoneelse')
    useAppStore.setState({ user: 'badadib', authenticated: true })
    const { result } = mount()
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(chat.client.logout).toHaveBeenCalled()
    expect(result.current.chatUser).toBe('badadib')
  })

  it('a failed silent attempt shows no error and is not retried on every render', async () => {
    chat.authenticateChat = vi.fn(async () => { throw new Error('no @threespeak grant') })
    useAppStore.setState({ user: 'badadib', authenticated: true })
    const { result, rerender } = mount()
    await waitFor(() => expect(result.current.connecting).toBe(false))
    rerender()
    expect(result.current).toMatchObject({ ready: false, error: null })
    expect(chat.authenticateChat).toHaveBeenCalledTimes(1)
  })

  it('the manual Connect may use the wallet, and surfaces its failure', async () => {
    chat.authenticateChat = vi.fn(async () => { throw new Error('no @threespeak grant') })
    useAppStore.setState({ user: 'badadib', authenticated: true })
    const { result } = mount()
    await waitFor(() => expect(result.current.connecting).toBe(false))

    chat.authenticateChat = vi.fn(async () => { throw new Error('User rejected') })
    let ok
    await act(async () => { ok = await result.current.connect() })
    expect(ok).toBe(false)
    expect(chat.authenticateChat).toHaveBeenCalledWith('badadib', { allowClientFallback: true })
    expect(result.current.error).toBe('User rejected')

    chat.authenticateChat = vi.fn(async (u) => { chat.client._signInAs(u) })
    await act(async () => { ok = await result.current.connect() })
    expect(ok).toBe(true)
    expect(result.current).toMatchObject({ ready: true, error: null })
  })

  it('a failure without a message falls back to the generic text', async () => {
    useAppStore.setState({ user: 'badadib', authenticated: true })
    const { result } = mount()
    await waitFor(() => expect(result.current.ready).toBe(true))
    chat.authenticateChat = vi.fn(async () => { throw {} })
    await act(async () => { await result.current.connect() })
    expect(result.current.error).toBe('misc.chat.connectFailed')
  })

  it('Connect while logged out asks to log in first', async () => {
    const { result } = mount()
    let ok
    await act(async () => { ok = await result.current.connect() })
    expect(ok).toBe(false)
    expect(result.current.error).toBe('misc.chat.loginFirst')
  })

  it('reports whether the login could sign a challenge', () => {
    chat.canSign = false
    expect(mount().result.current.canConnect).toBe(false)
    chat.canSign = true
    expect(mount().result.current.canConnect).toBe(true)
  })
})

describe('a warm-up user (no Hive account)', () => {
  it('chats as their ~id through the ButrAuth session', async () => {
    chat.canSign = false
    useAppStore.setState({ user: null, authenticated: true, incubationHandle: 'newbie' })
    const { result } = mount()
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(chat.authenticateWarmupChat).toHaveBeenCalledTimes(1)
    expect(chat.authenticateChat).not.toHaveBeenCalled()
    expect(result.current).toMatchObject({ warmup: true, chatUser: '~w123', canConnect: true })
  })

  it('Connect goes through the warm-up sign-in, never the wallet', async () => {
    chat.authenticateWarmupChat = vi.fn(async () => { throw new Error('down') })
    useAppStore.setState({ user: null, authenticated: true, incubationHandle: 'newbie' })
    const { result } = mount()
    await waitFor(() => expect(result.current.connecting).toBe(false))
    chat.authenticateWarmupChat = vi.fn(async () => { chat.client._signInAs('~w123') })
    await act(async () => { await result.current.connect() })
    expect(result.current.ready).toBe(true)
    expect(chat.authenticateChat).not.toHaveBeenCalled()
  })
})

describe('logging out', () => {
  it('signs the client out and closes everything that was open', async () => {
    useAppStore.setState({ user: 'badadib', authenticated: true })
    const { result } = mount()
    await waitFor(() => expect(result.current.ready).toBe(true))
    act(() => {
      result.current.openConversation({ _id: 'c1', type: 'dm' })
      result.current.openOverlay()
    })
    expect(result.current.overlayOpen).toBe(true)

    act(() => useAppStore.setState({ user: null, authenticated: false }))
    expect(chat.client.logout).toHaveBeenCalled()
    expect(result.current).toMatchObject({ ready: false, activeConversation: null, overlayOpen: false, error: null })
  })

  it('a different account logging in afterwards gets its own silent attempt', async () => {
    useAppStore.setState({ user: 'badadib', authenticated: true })
    const { result } = mount()
    await waitFor(() => expect(result.current.ready).toBe(true))
    act(() => useAppStore.setState({ user: null, authenticated: false }))
    act(() => useAppStore.setState({ user: 'other', authenticated: true }))
    await waitFor(() => expect(result.current.chatUser).toBe('other'))
    expect(chat.authenticateChat.mock.calls.map(([u]) => u)).toEqual(['badadib', 'other'])
  })
})

describe('conversations', () => {
  async function connected() {
    useAppStore.setState({ user: 'badadib', authenticated: true })
    const hook = mount()
    await waitFor(() => expect(hook.result.current.ready).toBe(true))
    return hook
  }

  it('opening a DM normalises the handle and fills in what the SDK leaves out', async () => {
    const { result } = await connected()
    let conv
    await act(async () => { conv = await result.current.openDmWith('  @Alice ') })
    expect(chat.client.openDm).toHaveBeenCalledWith('alice')
    expect(conv).toEqual({ _id: 'dm-1', type: 'dm', peer: 'alice', name: 'alice' })
    expect(result.current.activeConversation).toEqual(conv)

    act(() => result.current.backToList())
    expect(result.current.activeConversation).toBeNull()
  })

  it('an empty DM target does nothing', async () => {
    const { result } = await connected()
    await act(async () => { await result.current.openDmWith('  @ ') })
    expect(chat.client.openDm).not.toHaveBeenCalled()
  })

  it('a DM asked for before the client is ready opens once it is', async () => {
    let finish
    chat.authenticateChat = vi.fn(() => new Promise((r) => { finish = () => { chat.client._signInAs('badadib'); r() } }))
    useAppStore.setState({ user: 'badadib', authenticated: true })
    const { result } = mount()
    act(() => result.current.openOverlay({ dm: '@Bob' }))
    expect(result.current.overlayOpen).toBe(true)
    expect(chat.client.openDm).not.toHaveBeenCalled()
    await act(async () => { finish() })
    await waitFor(() => expect(result.current.activeConversation).toMatchObject({ peer: 'bob' }))
    expect(chat.client.openDm).toHaveBeenCalledWith('bob')
  })

  it('a private room is created private, with every invitee added, and opened', async () => {
    const { result } = await connected()
    let conv
    await act(async () => {
      conv = await result.current.createPrivateRoom({ name: ' Crew ', description: ' plans ', members: ['@Ann', '', 'bob '] })
    })
    expect(chat.client.createGroup).toHaveBeenCalledWith({ name: 'Crew', description: 'plans', isPublic: false, members: ['ann', 'bob'] })
    expect(chat.client.addGroupMember.mock.calls).toEqual([['g-1', 'ann'], ['g-1', 'bob']])
    expect(conv).toMatchObject({ _id: 'g-1', type: 'group', name: 'Room' })
    expect(result.current.activeConversation).toEqual(conv)
  })

  it('one invitee that cannot be added does not fail the room', async () => {
    const { result } = await connected()
    chat.client.addGroupMember.mockRejectedValueOnce(new Error('already a member'))
    chat.client.addGroupMember.mockResolvedValueOnce(null)
    let conv
    await act(async () => { conv = await result.current.createPrivateRoom({ name: 'Crew', members: ['ann', 'bob'] }) })
    expect(conv).toMatchObject({ _id: 'g-1', type: 'group', name: 'Crew' })
  })

  it('a room needs a name', async () => {
    const { result } = await connected()
    await expect(result.current.createPrivateRoom({ name: '  ' })).rejects.toThrow('misc.chat.roomNameRequired')
    expect(chat.client.createGroup).not.toHaveBeenCalled()
  })

  it('joining a channel object opens it; a bare id only joins', async () => {
    const { result } = await connected()
    await act(async () => { await result.current.joinChannel({ _id: 'ch1', name: 'General' }) })
    expect(chat.client.joinChannel).toHaveBeenCalledWith('ch1')
    expect(result.current.activeConversation).toEqual({ _id: 'ch1', name: 'General', type: 'channel' })

    act(() => result.current.backToList())
    let out
    await act(async () => { out = await result.current.joinChannel('ch2') })
    expect(chat.client.joinChannel).toHaveBeenLastCalledWith('ch2')
    expect(out).toBeUndefined()
    expect(result.current.activeConversation).toBeNull()

    await act(async () => { await result.current.joinChannel(null) })
    expect(chat.client.joinChannel).toHaveBeenCalledTimes(2)
  })

  it('leaving the open conversation goes back to the list; leaving another keeps it', async () => {
    const { result } = await connected()
    act(() => result.current.openConversation({ _id: 'ch1', type: 'channel' }))
    await act(async () => { await result.current.leaveConversation({ _id: 'other', type: 'channel' }) })
    expect(chat.client.leaveChannel).toHaveBeenCalledWith('other')
    expect(result.current.activeConversation).toMatchObject({ _id: 'ch1' })

    await act(async () => { await result.current.leaveConversation({ _id: 'ch1', type: 'channel' }) })
    expect(result.current.activeConversation).toBeNull()
  })

  it('leaving a group removes yourself from it', async () => {
    const { result } = await connected()
    act(() => result.current.openConversation({ _id: 'g-1', type: 'group' }))
    await act(async () => { await result.current.leaveConversation({ _id: 'g-1', type: 'group' }) })
    expect(chat.client.removeGroupMember).toHaveBeenCalledWith('g-1', 'badadib')
    expect(result.current.activeConversation).toBeNull()
  })

  it('a DM cannot be left, and missing ids are ignored', async () => {
    const { result } = await connected()
    await act(async () => {
      await result.current.leaveConversation({ _id: 'dm-1', type: 'dm' })
      await result.current.leaveConversation(null)
      await result.current.leaveChannel('')
      await result.current.leaveGroup(undefined)
    })
    expect(chat.client.leaveChannel).not.toHaveBeenCalled()
    expect(chat.client.removeGroupMember).not.toHaveBeenCalled()
  })

  it('a link queued to share is kept until the composer clears it', async () => {
    const { result } = await connected()
    act(() => result.current.setShareDraft('https://3speak.tv/watch?v=badadib/abc'))
    expect(result.current.shareDraft).toBe('https://3speak.tv/watch?v=badadib/abc')
    act(() => result.current.setShareDraft(null))
    expect(result.current.shareDraft).toBeNull()
  })

  it('closing the overlay closes it', async () => {
    const { result } = await connected()
    act(() => result.current.openOverlay())
    act(() => result.current.closeOverlay())
    expect(result.current.overlayOpen).toBe(false)
  })
})

describe('useChat', () => {
  it('outside the provider is a programming error', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => renderHook(() => useChat())).toThrow('useChat must be used inside <ChatProvider>')
  })
})
