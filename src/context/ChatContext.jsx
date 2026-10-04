import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from 'react'
import { ChatProvider as SdkChatProvider } from '@snapie/chat-client/react'
import { useAppStore } from '../lib/store'
import { t } from '../i18n'
import {
  getChatClient,
  authenticateChat,
  authenticateWarmupChat,
  canSignChatChallenge,
  isWarmupChatId,
} from '../lib/snapieChat'

const ChatUIContext = createContext(null)

// Stand-in "username" for the auth flow while a warm-up user signs in: their
// chat id (`~<id>`) is only known once Snapie answers.
const WARMUP = '~warmup'

export function useChat() {
  const ctx = useContext(ChatUIContext)
  if (!ctx) throw new Error('useChat must be used inside <ChatProvider>')
  return ctx
}

export function ChatProvider({ children }) {
  const client = useMemo(() => getChatClient(), [])
  const user = useAppStore((s) => s.user)
  const authenticated = useAppStore((s) => s.authenticated)
  const incubationHandle = useAppStore((s) => s.incubationHandle)
  // A warm-up user (ButrAuth, no Hive account) chats as `~<id>`, signed in
  // through their ButrAuth session rather than a Hive signature.
  const warmup = !!authenticated && !user && !!incubationHandle

  // Does the client's token belong to whoever is logged in now?
  const tokenIsMine = useCallback(() => {
    if (!client.isAuthenticated()) return false
    return warmup ? isWarmupChatId(client.getUsername()) : client.getUsername() === user
  }, [client, user, warmup])

  // `ready` = the SDK client holds a valid token for the current user.
  const [ready, setReady] = useState(() => tokenIsMine())
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState(null)

  // The conversation currently open in the thread view (null = list view).
  const [activeConversation, setActiveConversation] = useState(null)

  // A link queued to share into a chat (from the Share → "Send in chat" flow).
  // The thread composer prefills with it when a conversation is opened, then
  // clears it via setShareDraft(null).
  const [shareDraft, setShareDraft] = useState(null)

  // Desktop/tablet overlay panel (phones use the /chat page instead, see
  // useOpenChat). `pendingDm` is a DM to open once the client is ready, for
  // entry points like the profile "Message" button that fire before connect.
  const [overlayOpen, setOverlayOpen] = useState(false)
  const [pendingDm, setPendingDm] = useState(null)

  // Username we've already auto-attempted, so the silent background connect
  // fires once per login (not on every render).
  const autoTriedRef = useRef(null)

  // Core auth runner. `allowClientFallback` decides whether a failed background
  // (@threespeak) sign may fall back to a wallet signature (which can pop a
  // dialog) — true for the manual "Connect" button, false for auto-connect.
  const runAuthenticate = useCallback(async (uname, { allowClientFallback }) => {
    setConnecting(true)
    if (allowClientFallback) setError(null)
    try {
      if (uname === WARMUP) await authenticateWarmupChat()
      else await authenticateChat(uname, { allowClientFallback })
      setReady(true)
      return true
    } catch (e) {
      // Silent auto attempts don't surface an error (expected when the user
      // hasn't granted @threespeak and can't sign client-side).
      if (allowClientFallback) setError(e?.message || t('misc.chat.connectFailed'))
      setReady(false)
      return false
    } finally {
      setConnecting(false)
    }
  }, [])

  // Keep chat auth in sync with login state, and auto-connect silently (no
  // wallet popup) the first time we see a logged-in user without a token.
  useEffect(() => {
    const loggedInAs = authenticated ? (user || (warmup ? WARMUP : null)) : null
    if (!loggedInAs) {
      if (client.isAuthenticated()) client.logout()
      setReady(false)
      setError(null)
      setActiveConversation(null)
      setOverlayOpen(false)
      setPendingDm(null)
      autoTriedRef.current = null
      return
    }
    if (tokenIsMine()) {
      setReady(true)
      return
    }
    // No token for this user (or a stale one) — drop it and try a silent
    // background @threespeak connect once.
    if (client.isAuthenticated()) client.logout()
    setReady(false)
    setActiveConversation(null)
    if (autoTriedRef.current !== loggedInAs) {
      autoTriedRef.current = loggedInAs
      runAuthenticate(loggedInAs, { allowClientFallback: false })
    }
  }, [client, user, authenticated, warmup, tokenIsMine, runAuthenticate])

  // Manual connect (from the fallback gate): may use a wallet signature.
  const connect = useCallback(async () => {
    if (warmup) return runAuthenticate(WARMUP, { allowClientFallback: false })
    if (!authenticated || !user) {
      setError(t('misc.chat.loginFirst'))
      return false
    }
    return runAuthenticate(user, { allowClientFallback: true })
  }, [authenticated, user, warmup, runAuthenticate])

  const openConversation = useCallback((conv) => {
    setActiveConversation(conv)
  }, [])
  const backToList = useCallback(() => setActiveConversation(null), [])

  // Open (or resume) a DM with a Hive user and switch to its thread.
  const openDmWith = useCallback(
    async (targetUser) => {
      const handle = String(targetUser || '').trim().replace(/^@/, '').toLowerCase()
      if (!handle) return
      const conv = await client.openDm(handle)
      // openDm returns a minimal conversation (often just `_id`) — without
      // `type`/`peer` the thread loads the wrong endpoint and the header is
      // blank. Normalize it so it behaves like a list conversation.
      const full = {
        ...conv,
        type: conv?.type || 'dm',
        peer: conv?.peer || handle,
        name: conv?.name || handle,
      }
      setActiveConversation(full)
      return full
    },
    [client]
  )

  // Create a PRIVATE room (a group) and open it. Mode is forced private for
  // now — we deliberately don't surface a public/private choice yet. Returns
  // the new conversation.
  const createPrivateRoom = useCallback(
    async ({ name, description = '', members = [] } = {}) => {
      const roomName = String(name || '').trim()
      if (!roomName) throw new Error(t('misc.chat.roomNameRequired'))
      const cleanMembers = (members || [])
        .map((m) => String(m || '').trim().replace(/^@/, '').toLowerCase())
        .filter(Boolean)
      const channel = await client.createGroup({
        name: roomName,
        description: String(description || '').trim(),
        isPublic: false,
        members: cleanMembers,
      })
      // Belt-and-suspenders: some backends ignore the create-time `members`
      // payload, so explicitly add each invitee. Ignore per-member errors
      // (e.g. "already a member") so one bad add doesn't fail the whole room.
      let finalChannel = channel
      for (const m of cleanMembers) {
        try {
          finalChannel = (await client.addGroupMember(channel._id, m)) || finalChannel
        } catch { /* already a member / not supported — ignore */ }
      }
      // createGroup resolves to a Channel; normalize to a group Conversation so
      // the thread view loads the right endpoint and shows a proper header.
      const conv = {
        ...finalChannel,
        type: 'group',
        name: finalChannel?.name || roomName,
      }
      setActiveConversation(conv)
      return conv
    },
    [client]
  )

  // Join a public channel, then open it. Accepts a channel object (preferred,
  // so we can open it after) or a bare channel id.
  const joinChannel = useCallback(
    async (channelOrId) => {
      const id = typeof channelOrId === 'string' ? channelOrId : channelOrId?._id
      if (!id) return
      await client.joinChannel(id)
      if (channelOrId && typeof channelOrId === 'object') {
        const conv = { ...channelOrId, type: 'channel', name: channelOrId.name }
        setActiveConversation(conv)
        return conv
      }
    },
    [client]
  )

  // Leave a channel. If it's the one currently open, drop back to the list.
  const leaveChannel = useCallback(
    async (channelOrId) => {
      const id = typeof channelOrId === 'string' ? channelOrId : channelOrId?._id
      if (!id) return
      await client.leaveChannel(id)
      setActiveConversation((cur) => (cur && cur._id === id ? null : cur))
    },
    [client]
  )

  // Leave a group = remove yourself from its members (the SDK has no group
  // "leave" endpoint). If it's the one currently open, drop back to the list.
  const leaveGroup = useCallback(
    async (groupOrId) => {
      const id = typeof groupOrId === 'string' ? groupOrId : groupOrId?._id
      if (!id || !user) return
      await client.removeGroupMember(id, user)
      setActiveConversation((cur) => (cur && cur._id === id ? null : cur))
    },
    [client, user]
  )

  // Leave whatever a conversation is — dispatch by type (dm can't be left).
  const leaveConversation = useCallback(
    async (conv) => {
      if (!conv || conv.type === 'dm') return
      if (conv.type === 'group') return leaveGroup(conv)
      return leaveChannel(conv)
    },
    [leaveGroup, leaveChannel]
  )

  const openOverlay = useCallback(({ dm } = {}) => {
    if (dm) setPendingDm(String(dm).trim().replace(/^@/, '').toLowerCase())
    setOverlayOpen(true)
  }, [])
  const closeOverlay = useCallback(() => setOverlayOpen(false), [])

  // Open a queued DM as soon as the client can.
  useEffect(() => {
    if (!ready || !pendingDm) return
    const handle = pendingDm
    setPendingDm(null)
    openDmWith(handle).catch(() => {})
  }, [ready, pendingDm, openDmWith])

  const value = useMemo(
    () => ({
      client,
      ready,
      connecting,
      error,
      warmup,
      // Who "me" is in chat: the Hive name, or `~<id>` for a warm-up user.
      chatUser: ready ? client.getUsername() : null,
      canConnect: warmup || canSignChatChallenge(),
      connect,
      activeConversation,
      openConversation,
      backToList,
      openDmWith,
      createPrivateRoom,
      joinChannel,
      leaveChannel,
      leaveGroup,
      leaveConversation,
      shareDraft,
      setShareDraft,
      overlayOpen,
      openOverlay,
      closeOverlay,
    }),
    [
      warmup,
      overlayOpen,
      openOverlay,
      closeOverlay,
      client,
      ready,
      connecting,
      error,
      connect,
      shareDraft,
      activeConversation,
      openConversation,
      backToList,
      openDmWith,
      createPrivateRoom,
      joinChannel,
      leaveChannel,
      leaveGroup,
      leaveConversation,
    ]
  )

  return (
    <ChatUIContext.Provider value={value}>
      <SdkChatProvider client={client}>{children}</SdkChatProvider>
    </ChatUIContext.Provider>
  )
}
