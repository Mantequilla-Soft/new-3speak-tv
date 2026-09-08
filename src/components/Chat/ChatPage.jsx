import { useState, useRef, useEffect, useMemo } from 'react'
import { ArrowLeft, Send, MessageCirclePlus, Loader2, MoreHorizontal, X, Users, Hash, LogOut } from 'lucide-react'
import {
  useConversations,
  useChatMessages,
  useTyping,
  useUnreadCount,
} from '@snapie/chat-client/react'
import { extractImageUrls } from '@snapie/chat-client'
import { getChatClient } from '../../lib/snapieChat'
import { toastIn } from '../../utils/toast';
import { useSearchParams } from 'react-router-dom'
import ChatComposerTools from './ChatComposerTools'
import EmojiTextInput from './EmojiTextInput'
import ChatLinkCard from './ChatLinkCard'
import ChatImageLightbox from './ChatImageLightbox'
import { parseChatLink, timeAgo } from './chatLinks'
import { useChat } from '../../context/ChatContext'
import { useServerUnread } from '../../hooks/useServerUnread'
import { useAppStore } from '../../lib/store'
import { EMBED_API_KEY } from '../../utils/config'
import { getAccounts } from '../../hive-api/hiveApi'
import './chat.scss'

// Every toast from this module is headed "Chat"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Chat');

const avatar = (name) => `https://images.hive.blog/u/${name}/avatar/small`

function convTitle(conv) {
  if (!conv) return ''
  if (conv.type === 'dm') return conv.peer || conv.name
  return conv.name
}

// Unsent draft text per conversation (so switching chats keeps each draft).
const draftStore = new Map()

// preview-3speak backend base (same as aioha.js uses).
const THREESPEAK_API = import.meta.env.VITE_THREESPEAK_API || '/api'

// Upload an image via the background @threespeak service; returns its URL.
async function uploadChatImage(file) {
  const res = await fetch(`${THREESPEAK_API}/upload-image`, {
    method: 'POST',
    headers: { 'Content-Type': file.type || 'image/png', 'X-API-Key': EMBED_API_KEY },
    body: file,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.url) throw new Error(data?.error || 'Upload failed')
  return data.url
}

// Image URLs in a message: SDK detection (by extension) PLUS known image hosts
// — the upload service returns images.hive.blog URLs without a file extension.
const IMG_HOST_RE = /https?:\/\/(?:images\.hive\.blog|files\.peakd\.com|[a-z0-9.-]+\.b-cdn\.net)\/[^\s)]+/gi
function findImageUrls(text) {
  const out = new Set(extractImageUrls(text))
  for (const m of String(text || '').match(IMG_HOST_RE) || []) out.add(m.replace(/[.,]+$/, ''))
  return [...out]
}

// Short preview of a quoted message for the composer banner.
function quoteSnippet(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim()
  return t.length > 140 ? t.slice(0, 140) + '…' : t
}

// Turn bare URLs in a text run into clickable links (open in a new tab). Image
// and recognized post links are already stripped/rendered before this runs, so
// what remains here are "other" links.
function linkify(str) {
  const parts = str.split(/(https?:\/\/[^\s]+)/g)
  return parts.map((part, i) => {
    if (/^https?:\/\//i.test(part)) {
      const href = part.replace(/[.,;:!?)]+$/, '')
      return (
        <a key={i} className="chat-msg-link" href={href} target="_blank" rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}>
          {part}
        </a>
      )
    }
    return part
  })
}

// Strip leading ">" markers from a line, returning its quote depth + remainder.
function lineDepth(line) {
  let depth = 0
  let rest = line
  while (/^>\s?/.test(rest)) { rest = rest.replace(/^>\s?/, ''); depth++ }
  return { depth, text: rest }
}

// Build nested quote blocks from depth-annotated lines (recurses one level per
// ">" so "> > x" renders as two stacked bars).
function buildNodes(lines, keyBase = 'n') {
  const nodes = []
  let i = 0
  while (i < lines.length) {
    if (lines[i].depth === 0) {
      const buf = []
      while (i < lines.length && lines[i].depth === 0) { buf.push(lines[i].text); i++ }
      const joined = buf.join('\n')
      if (joined.trim().length) nodes.push(<span className="chat-msg-text" key={`${keyBase}${nodes.length}`}>{linkify(joined)}</span>)
    } else {
      const group = []
      while (i < lines.length && lines[i].depth >= 1) { group.push({ depth: lines[i].depth - 1, text: lines[i].text }); i++ }
      const k = `${keyBase}${nodes.length}`
      nodes.push(<blockquote className="chat-quote" key={k}>{buildNodes(group, `${k}-`)}</blockquote>)
    }
  }
  return nodes
}

// Render message text, turning lines that start with ">" into (nested) quotes.
function renderMessageText(text) {
  return buildNodes(text.split('\n').map(lineDepth))
}

/** Shown when the client isn't authenticated to the Snapie chat backend yet. */
function ConnectGate() {
  const { connect, connecting, error, canConnect } = useChat()
  return (
    <div className="chat-gate">
      <div className="chat-gate-icon">
        <MessageCirclePlus size={44} />
      </div>
      <h3>Connect to 3Speak Chat</h3>
      <p>
        Chat is powered by Snapie. Connecting signs a one-time login challenge
        with your Hive posting key — no transaction, no cost.
      </p>
      {error && <p className="chat-gate-error">{error}</p>}
      <button
        type="button"
        className="chat-btn-primary"
        onClick={connect}
        disabled={connecting || !canConnect}
      >
        {connecting ? (
          <>
            <Loader2 size={16} className="chat-spin" /> Connecting…
          </>
        ) : (
          'Connect chat'
        )}
      </button>
      {!canConnect && (
        <p className="chat-gate-hint">
          Your current login can’t sign the chat challenge. Use Keychain,
          HiveAuth, PeakVault or Ledger.
        </p>
      )}
    </div>
  )
}

function NewDmForm() {
  const { openDmWith } = useChat()
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    const handle = value.trim().replace(/^@/, '').toLowerCase()
    if (!handle || busy) return
    setBusy(true)
    try {
      // Only let users start a DM with a real Hive account.
      const accounts = await getAccounts([handle])
      if (!accounts || accounts.length === 0) {
        toast.error(`@${handle} is not a Hive account.`)
        return
      }
      await openDmWith(handle)
      setValue('')
    } catch (err) {
      toast.error(err?.message || 'Could not open that conversation.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="chat-newdm" onSubmit={submit}>
      <span className="chat-newdm-at">@</span>
      <input
        type="text"
        placeholder="Message a Hive user…"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        spellCheck={false}
        autoCapitalize="none"
      />
      <button type="submit" disabled={!value.trim() || busy} aria-label="Start chat">
        {busy ? <Loader2 size={16} className="chat-spin" /> : <Send size={16} />}
      </button>
    </form>
  )
}

// Verify a single handle exists on Hive.
async function hiveAccountExists(handle) {
  const accounts = await getAccounts([handle])
  return (accounts || []).some((a) => a.name === handle)
}

// Create a private room (group). Mode is forced private for now — no
// public/private choice is surfaced. Collapsed to a button until opened.
// Members are entered as chips: type a handle, press space/enter/comma to
// verify it against Hive and add it; the × removes it.
function NewRoomForm() {
  const { createPrivateRoom } = useChat()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [memberInput, setMemberInput] = useState('')
  const [members, setMembers] = useState([]) // validated Hive handles
  const [checking, setChecking] = useState(false)
  const [busy, setBusy] = useState(false)

  const close = () => {
    setOpen(false)
    setName('')
    setMemberInput('')
    setMembers([])
  }

  // Validate a token against Hive and, if it exists, add it as a chip.
  const addMember = async (raw) => {
    const handle = String(raw || '').trim().replace(/^@/, '').toLowerCase()
    if (!handle) return
    if (members.includes(handle)) { setMemberInput(''); return }
    setChecking(true)
    try {
      if (!(await hiveAccountExists(handle))) {
        toast.error(`@${handle} is not a Hive account.`)
        return
      }
      setMembers((prev) => (prev.includes(handle) ? prev : [...prev, handle]))
      setMemberInput('')
    } catch (err) {
      toast.error(err?.message || 'Could not verify that account.')
    } finally {
      setChecking(false)
    }
  }

  const removeMember = (handle) =>
    setMembers((prev) => prev.filter((m) => m !== handle))

  const onMemberKeyDown = (e) => {
    if (e.key === ' ' || e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      if (memberInput.trim()) addMember(memberInput)
    } else if (e.key === 'Backspace' && !memberInput && members.length) {
      removeMember(members[members.length - 1])
    }
  }

  // Commit completed tokens on a typed/pasted separator; keep the trailing
  // fragment in the box.
  const onMemberChange = (e) => {
    const v = e.target.value
    if (/[\s,]/.test(v)) {
      const parts = v.split(/[\s,]+/)
      const tail = parts.pop()
      parts.filter(Boolean).forEach((p) => addMember(p))
      setMemberInput(tail)
    } else {
      setMemberInput(v)
    }
  }

  const submit = async (e) => {
    e.preventDefault()
    const roomName = name.trim()
    if (!roomName || busy) return
    setBusy(true)
    try {
      // Fold in any half-typed handle still in the box.
      const finalMembers = [...members]
      const tail = memberInput.trim().replace(/^@/, '').toLowerCase()
      if (tail && !finalMembers.includes(tail)) {
        if (!(await hiveAccountExists(tail))) {
          toast.error(`@${tail} is not a Hive account.`)
          return
        }
        finalMembers.push(tail)
      }
      await createPrivateRoom({ name: roomName, members: finalMembers })
      close()
    } catch (err) {
      toast.error(err?.message || 'Could not create the room.')
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button type="button" className="chat-newroom-toggle" onClick={() => setOpen(true)}>
        <Users size={16} /> New private room
      </button>
    )
  }

  return (
    <form className="chat-newroom" onSubmit={submit}>
      <input
        type="text"
        placeholder="Room name…"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus
      />
      <div className="chat-newroom-members">
        {members.map((m) => (
          <span key={m} className="chat-member-chip">
            @{m}
            <button type="button" onClick={() => removeMember(m)} aria-label={`Remove @${m}`}>
              <X size={12} />
            </button>
          </span>
        ))}
        <input
          type="text"
          placeholder={members.length ? 'Add more…' : 'Invite Hive users (optional)…'}
          value={memberInput}
          onChange={onMemberChange}
          onKeyDown={onMemberKeyDown}
          spellCheck={false}
          autoCapitalize="none"
        />
        {checking && <Loader2 size={14} className="chat-spin" />}
      </div>
      <div className="chat-newroom-actions">
        <button type="button" className="chat-newroom-cancel" onClick={close} disabled={busy}>
          Cancel
        </button>
        <button type="submit" disabled={!name.trim() || busy}>
          {busy ? <Loader2 size={16} className="chat-spin" /> : 'Create'}
        </button>
      </div>
    </form>
  )
}

// Groups live in a separate /groups collection that the /conversations feed
// doesn't include, so poll them ourselves and merge into the list — otherwise
// a room you were added to never shows up.
function useGroups() {
  const { client, ready } = useChat()
  const [groups, setGroups] = useState([])
  useEffect(() => {
    if (!ready) {
      setGroups([])
      return
    }
    let alive = true
    const load = async () => {
      try {
        const g = await client.getGroups()
        if (alive) setGroups(Array.isArray(g) ? g : [])
      } catch {
        /* ignore transient poll errors */
      }
    }
    load()
    const id = setInterval(load, 5000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [client, ready])
  return groups
}

// Browse & join public channels. Collapsed to a button until opened.
function BrowseChannels() {
  const { client, joinChannel } = useChat()
  const [open, setOpen] = useState(false)
  const [channels, setChannels] = useState([])
  const [loading, setLoading] = useState(false)
  const [joining, setJoining] = useState(null)

  useEffect(() => {
    if (!open) return
    let alive = true
    setLoading(true)
    client
      .getChannels()
      .then((c) => { if (alive) setChannels(Array.isArray(c) ? c : []) })
      .catch(() => { if (alive) setChannels([]) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [open, client])

  const join = async (ch) => {
    setJoining(ch._id)
    try {
      await joinChannel(ch) // joins, then opens the channel thread
    } catch (err) {
      toast.error(err?.message || 'Could not join that channel.')
    } finally {
      setJoining(null)
    }
  }

  if (!open) {
    return (
      <button type="button" className="chat-newroom-toggle" onClick={() => setOpen(true)}>
        <Hash size={16} /> Browse channels
      </button>
    )
  }

  return (
    <div className="chat-browse">
      <div className="chat-browse-head">
        <span>Public channels</span>
        <button type="button" onClick={() => setOpen(false)} aria-label="Close channel browser">
          <X size={14} />
        </button>
      </div>
      {loading && <div className="chat-empty">Loading channels…</div>}
      {!loading && channels.length === 0 && (
        <div className="chat-empty">No channels available.</div>
      )}
      <ul className="chat-browse-ul">
        {channels.map((ch) => (
          <li key={ch._id} className="chat-browse-row">
            <span className="chat-browse-name"># {ch.name}</span>
            <button type="button" onClick={() => join(ch)} disabled={joining === ch._id}>
              {joining === ch._id ? <Loader2 size={14} className="chat-spin" /> : 'Join'}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function ConversationList() {
  const { conversations, loading } = useConversations()
  const { openConversation, activeConversation, shareDraft } = useChat()
  // Per-conversation unread from the same snapshot that drives the nav badge.
  // The row dot used the server's conv.unread while the badge used a separate
  // count, so the two could disagree.
  // Counts come from the server on every check, never from a locally kept
  // tally that can drift (see useServerUnread). markRead still comes from the
  // SDK hook; we resync straight after using it.
  const { markRead } = useUnreadCount()
  const { unreadCount, byConversation, refresh: refreshUnread } = useServerUnread()
  const [clearing, setClearing] = useState(false)
  const groups = useGroups()

  // Merge polled groups in, deduped by id (a real /conversations entry — which
  // carries lastMessage/unread — wins over the bare group record).
  const merged = useMemo(() => {
    const byId = new Map()
    for (const c of conversations) byId.set(c._id, c)
    for (const g of groups) {
      if (!byId.has(g._id)) byId.set(g._id, { ...g, type: 'group' })
    }
    return Array.from(byId.values())
  }, [conversations, groups])

  // Show the button on ANY unread signal, not just the aggregate. The aggregate
  // can read 0 while rows still show unread (they fall back to the server's
  // per-conversation flag — see the list below), and gating on it alone made the
  // button disappear in exactly the stuck-count case it exists to fix.
  const hasUnread = useMemo(() => {
    if (unreadCount > 0) return true
    return merged.some((c) => (byConversation ? (byConversation[c._id] ?? 0) > 0 : !!c.unread))
  }, [unreadCount, merged, byConversation])

  // Mark every conversation the SERVER says is unread, not just the ones shown
  // in the list. That distinction is the point: marking on open only reaches
  // chats the user can see and click, so a count stuck on a conversation that
  // never appears in their list can never be cleared that way — which is why
  // it survived the earlier fix.
  //
  // byConversation is the server's own breakdown, so it includes those. There
  // is no bulk endpoint, so this is one POST /read per id, in small batches.
  async function markAllRead() {
    if (clearing) return
    setClearing(true)
    try {
      // Go through the raw client, NOT the hook. The hook's markRead returns
      // undefined either way, and client.markRead swallows its own errors and
      // returns null — so via the hook there is no way to tell a successful
      // clear from a failed one, and Promise.allSettled would report every
      // call as fulfilled regardless.
      const client = getChatClient()

      // Prefer the server's own breakdown: it can name conversations that are
      // NOT in the visible list, which is exactly where a stuck count hides.
      // But the server may return a total with no breakdown at all — in that
      // case fall back to every conversation we can see, otherwise there is
      // nothing to iterate and the button silently does nothing.
      let ids = Object.entries(byConversation || {})
        .filter(([, n]) => Number(n) > 0)
        .map(([id]) => id)
      const usedFallback = ids.length === 0
      if (usedFallback) ids = merged.map((c) => c._id).filter(Boolean)

      if (!ids.length) {
        toast.error('No conversations to clear. The count may be stuck server-side.')
        return
      }

      // client.markRead swallows its own errors and returns null, so a null
      // tells us nothing about WHY. Probe auth state around the calls to
      // separate "we are logged out" from "the server refused" — otherwise the
      // user just sees a generic failure and we are guessing.
      const authedBefore = client.isAuthenticated()
      let last = null
      let serverError = ''
      for (let i = 0; i < ids.length; i += 4) {
        const res = await Promise.all(
          ids.slice(i, i + 4).map((id) => client.markRead(id).catch(() => null))
        )
        for (const r of res) if (r) last = r
      }
      const authedAfter = client.isAuthenticated()

      // markRead swallows the server's error, so on total failure repeat ONE
      // call by hand purely to read the status and body back. Without this the
      // only signal is `null`, which is why this took several rounds to pin
      // down. TS `private` is compile-time only, so the token is reachable.
      if (!last && authedAfter) {
        try {
          const svc = client.service || {}
          const r = await fetch(`${svc.base}/read`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Snapie-Chat-Read-Mode': 'explicit',
              ...(svc.token ? { Authorization: `Bearer ${svc.token}` } : {})
            },
            body: JSON.stringify({ conversationId: ids[0] })
          })
          const body = await r.text()
          serverError = ` (HTTP ${r.status}: ${body.slice(0, 120)})`
        } catch (e) {
          serverError = ` (${e?.message || 'request failed'})`
        }
      }

      if (last && (last.total || 0) === 0) {
        toast.success('All caught up')
      } else if (last) {
        toast.error(
          `Still showing ${last.total} unread after clearing ${ids.length} chat${ids.length === 1 ? '' : 's'}.` +
          (usedFallback ? ' The server reports a count but no matching conversation.' : '')
        )
      } else if (!authedBefore) {
        toast.error('Chat is not signed in. Reconnect chat and try again.')
      } else if (!authedAfter) {
        // request() nulls the token on any 401 and rethrows, so one rejected
        // call silently disarms every call after it.
        toast.error('Chat session expired while clearing. Reconnect chat and try again.')
      } else {
        toast.error(
          `Server rejected all ${ids.length} request${ids.length === 1 ? '' : 's'}` +
          `${usedFallback ? ' (ids from the visible list)' : ' (ids from the server\'s own unread map)'}` +
          `${serverError}`
        )
      }
    } catch {
      toast.error('Could not mark everything as read')
    } finally {
      setClearing(false)
      refreshUnread()
    }
  }

  return (
    <div className="chat-list">
      {shareDraft && (
        <div className="chat-share-banner">Choose a chat to send to</div>
      )}
      <NewDmForm />
      <NewRoomForm />
      <BrowseChannels />
      {hasUnread && (
        <button
          type="button"
          className="chat-mark-all-read"
          onClick={markAllRead}
          disabled={clearing}
        >
          {clearing
            ? 'Marking as read…'
            : `Mark all as read${unreadCount > 0 ? ` (${unreadCount})` : ''}`}
        </button>
      )}
      {loading && merged.length === 0 && (
        <div className="chat-empty">Loading conversations…</div>
      )}
      {!loading && merged.length === 0 && (
        <div className="chat-empty">
          No conversations yet. Start one above by entering a Hive username.
        </div>
      )}
      <ul className="chat-conv-ul">
        {merged.map((conv) => {
          const title = convTitle(conv)
          const isDm = conv.type === 'dm'
          const active = activeConversation?._id === conv._id
          // Fall back to the server flag until the first snapshot lands, so dots
          // do not blink off on load.
          const unread = byConversation
            ? (byConversation[conv._id] ?? 0) > 0
            : !!conv.unread
          return (
            <li
              key={conv._id}
              className={`chat-conv-row${unread ? ' unread' : ''}${active ? ' active' : ''}`}
              onClick={() => openConversation(conv)}
            >
              <img
                className="chat-conv-avatar"
                src={isDm ? avatar(title) : avatar(conv.owner || 'spknetwork')}
                alt=""
                onError={(e) => {
                  e.currentTarget.style.visibility = 'hidden'
                }}
              />
              <div className="chat-conv-meta">
                <div className="chat-conv-name">
                  {isDm ? `@${title}` : `# ${title}`}
                </div>
                {conv.lastMessage && (
                  <div className="chat-conv-last">
                    {conv.lastMessage.sender
                      ? `${conv.lastMessage.sender}: `
                      : ''}
                    {conv.lastMessage.content}
                  </div>
                )}
              </div>
              {unread && <span className="chat-conv-dot" />}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// Leave the current room/channel from the thread header (DMs can't be left).
function LeaveButton({ conv }) {
  const { leaveConversation, backToList } = useChat()
  const [busy, setBusy] = useState(false)
  const kind = conv.type === 'group' ? 'room' : 'channel'
  const leave = async () => {
    if (!window.confirm(`Leave this ${kind}?`)) return
    setBusy(true)
    try {
      await leaveConversation(conv)
      backToList()
    } catch (err) {
      toast.error(err?.message || `Could not leave the ${kind}.`)
    } finally {
      setBusy(false)
    }
  }
  return (
    <button
      type="button"
      className="chat-thread-leave"
      onClick={leave}
      disabled={busy}
      title={`Leave ${kind}`}
    >
      {busy ? <Loader2 size={15} className="chat-spin" /> : <LogOut size={16} />}
      <span>Leave</span>
    </button>
  )
}

function Thread({ conv }) {
  const me = useAppStore((s) => s.user)
  const { backToList, shareDraft, setShareDraft } = useChat()
  const { messages, loading, error, sendMessage, editMessage } = useChatMessages(
    conv._id,
    conv.type
  )
  const { typingUsers, setTyping } = useTyping(conv._id)
  const { markRead } = useUnreadCount()

  // Tell the server this conversation has been seen. Nothing did this before,
  // so the count only ever went UP — including for chats where YOU sent the
  // last message, which is how you could sit on a badge of 1 with no unread
  // chat anywhere. Re-runs as messages arrive so a chat you are already
  // looking at does not start counting again.
  useEffect(() => {
    if (!conv?._id) return
    markRead(conv._id).catch(() => { /* non-fatal: badge clears on next open */ })
  }, [conv?._id, messages.length, markRead])
  // Draft is seeded from (and saved to) a per-conversation store, so switching
  // chats shows that chat's own unsent text and restores it on return.
  const [draft, setDraft] = useState(() => draftStore.get(conv._id) || '')
  const [menuFor, setMenuFor] = useState(null)
  const [menuDir, setMenuDir] = useState('up')
  const [quoteTarget, setQuoteTarget] = useState(null)
  const [editTarget, setEditTarget] = useState(null)
  const [lightboxUrl, setLightboxUrl] = useState(null)
  const [attachments, setAttachments] = useState([]) // {id, status, url, previewUrl}

  // Pasted images → upload via the background service; show as removable thumbs.
  const handlePasteFiles = (files) => {
    files.forEach((file) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
      const previewUrl = URL.createObjectURL(file)
      setAttachments((a) => [...a, { id, status: 'uploading', previewUrl }])
      uploadChatImage(file)
        .then((url) => setAttachments((a) => a.map((x) => (x.id === id ? { ...x, status: 'done', url } : x))))
        .catch(() => setAttachments((a) => a.map((x) => (x.id === id ? { ...x, status: 'error' } : x))))
    })
  }
  const removeAttachment = (id) => setAttachments((a) => {
    const x = a.find((i) => i.id === id)
    if (x?.previewUrl) URL.revokeObjectURL(x.previewUrl)
    return a.filter((i) => i.id !== id)
  })
  const scrollRef = useRef(null)
  const inputRef = useRef(null)

  // setDraft + persist (accepts a value or an updater fn).
  const updateDraft = (arg) => {
    setDraft((prev) => {
      const next = typeof arg === 'function' ? arg(prev) : arg
      if (next) draftStore.set(conv._id, next)
      else draftStore.delete(conv._id)
      return next
    })
  }

  // When this conversation opens with queued text (Share link / Forward),
  // prefill the composer with it once, then clear the queued draft.
  useEffect(() => {
    if (shareDraft) {
      updateDraft((cur) => (cur ? `${shareDraft}\n${cur}` : shareDraft))
      setShareDraft(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conv._id])

  // Auto-scroll to the newest message.
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length, typingUsers.length])

  const send = async () => {
    // Edit mode: save the new content over the existing message instead of
    // sending a new one. The SDK has no real delete — "Delete" is a soft edit.
    if (editTarget) {
      const body = draft.trim()
      if (!body) return
      const target = editTarget
      updateDraft('')
      setEditTarget(null)
      setTyping(false)
      try {
        await editMessage(target._id, body)
      } catch (err) {
        toast.error(err?.message || 'Could not edit the message.')
      }
      return
    }
    const parts = []
    if (quoteTarget) {
      parts.push(String(quoteTarget.content || '').split('\n').map((l) => '> ' + l).join('\n'))
    }
    const body = draft.trim()
    if (body) parts.push(body)
    const imageUrls = attachments.filter((a) => a.status === 'done').map((a) => a.url)
    parts.push(...imageUrls)
    const content = parts.join('\n')
    if (!content) return
    updateDraft('')
    setQuoteTarget(null)
    attachments.forEach((a) => a.previewUrl && URL.revokeObjectURL(a.previewUrl))
    setAttachments([])
    setTyping(false)
    await sendMessage(content)
  }
  const submit = (e) => { e.preventDefault(); send() }

  // Quote a message — shown as a preview above the composer; prepended on send.
  const startQuote = (m) => {
    setEditTarget(null)
    setQuoteTarget(m)
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  // Edit one of your own messages — load its raw content into the composer and
  // switch the composer into "edit" mode (send saves over the original).
  const startEdit = (m) => {
    setQuoteTarget(null)
    setEditTarget(m)
    updateDraft(m.content || '')
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  // Soft delete — the SDK has no real delete, so replace the body with a marker.
  const deleteMessage = async (m) => {
    if (!window.confirm('Delete this message? It will be replaced with “[deleted]”.')) return
    if (editTarget?._id === m._id) { setEditTarget(null); updateDraft('') }
    try {
      await editMessage(m._id, '[deleted]')
    } catch (err) {
      toast.error(err?.message || 'Could not delete the message.')
    }
  }

  // Forward a message: queue it (quoted, with original sender + time) and go to
  // the chat list to pick a target — the composer there gets prefilled.
  const forwardMessage = (m) => {
    const ago = m.createdAt ? ` · ${timeAgo(m.createdAt)}` : ''
    const header = `> Forwarded from @${m.sender}${ago}`
    const body = String(m.content || '').split('\n').map((l) => '> ' + l).join('\n')
    setShareDraft(`${header}\n${body}`)
    backToList()
  }

  // Toggle the per-message action menu, opening it toward whichever side has
  // more room inside the (clipping) messages scroll area so it isn't cropped.
  const toggleMenu = (e, id) => {
    if (menuFor === id) { setMenuFor(null); return }
    const btn = e.currentTarget.getBoundingClientRect()
    const cont = scrollRef.current?.getBoundingClientRect()
    const above = cont ? btn.top - cont.top : btn.top
    const below = cont ? cont.bottom - btn.bottom : window.innerHeight - btn.bottom
    setMenuDir(below >= above ? 'down' : 'up')
    setMenuFor(id)
  }

  // Close the per-message action menu on any outside click.
  useEffect(() => {
    if (!menuFor) return
    const close = () => setMenuFor(null)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [menuFor])

  const others = typingUsers.filter((u) => u !== me)
  const isDm = conv.type === 'dm'
  const title = convTitle(conv)

  return (
    <div className="chat-thread">
      <header className="chat-thread-header">
        <button
          type="button"
          className="chat-icon-btn chat-thread-back"
          onClick={backToList}
          aria-label="Back to conversations"
        >
          <ArrowLeft size={20} />
        </button>
        <img className="chat-thread-avatar" src={avatar(isDm ? title : conv.owner || 'spknetwork')} alt="" />
        <span className="chat-thread-title">{isDm ? `@${title}` : `# ${title}`}</span>
        {!isDm && <LeaveButton conv={conv} />}
      </header>

      <div className="chat-messages" ref={scrollRef}>
        {loading && <div className="chat-empty">Loading messages…</div>}
        {error && <div className="chat-gate-error">{error}</div>}
        {!loading && messages.length === 0 && (
          <div className="chat-empty">No messages yet — say hi 👋</div>
        )}
        {messages.map((m) => {
          const mine = m.sender === me
          // Snapie embeds images as plain-text URLs in the content — pull them
          // out to render inline, and drop them from the displayed text.
          const images = findImageUrls(m.content)
          let text = m.content || ''
          for (const url of images) text = text.split(url).join('')
          // A 3Speak/Hive link (post/comment/profile/community) → rich card;
          // drop its URL from the text.
          const postLink = parseChatLink(text)
          if (postLink) text = text.split(postLink.url).join('')
          text = text.trim()
          const isDeleted = text === '[deleted]'
          const hasBubble = !!text || images.length > 0
          const imageOnly = !text && images.length > 0
          return (
            <div key={m._id} className={`chat-msg${mine ? ' mine' : ''}`}>
              {!mine && conv.type !== 'dm' && (
                <span className="chat-msg-sender">@{m.sender}</span>
              )}
              <div className="chat-msg-row">
                <div className="chat-msg-content">
                  {hasBubble && (
                    <div className={`chat-msg-bubble${imageOnly ? ' image-only' : ''}${isDeleted ? ' chat-msg-deleted' : ''}`}>
                      {text && renderMessageText(text)}
                      {images.map((url) => (
                        <button
                          key={url}
                          type="button"
                          className="chat-image-btn"
                          onClick={(e) => { e.stopPropagation(); setLightboxUrl(url) }}
                        >
                          <img className="chat-msg-image" src={url} alt="" loading="lazy" />
                        </button>
                      ))}
                    </div>
                  )}
                  {postLink && <ChatLinkCard link={postLink} />}
                  {m.createdAt && (
                    <span className="chat-msg-time" title={new Date(m.createdAt).toLocaleString()}>
                      {timeAgo(m.createdAt)}{m.editedAt ? ' · edited' : ''}
                    </span>
                  )}
                </div>
                <div className="chat-msg-actions">
                  <button
                    type="button"
                    className="chat-msg-menu-btn"
                    aria-label="Message actions"
                    onClick={(e) => { e.stopPropagation(); toggleMenu(e, m._id) }}
                  >
                    <MoreHorizontal size={15} />
                  </button>
                  {menuFor === m._id && (
                    <div className={`chat-msg-menu chat-msg-menu--${menuDir}`}>
                      <button type="button" onClick={(e) => { e.stopPropagation(); startQuote(m); setMenuFor(null) }}>
                        Quote
                      </button>
                      <button type="button" onClick={(e) => { e.stopPropagation(); forwardMessage(m); setMenuFor(null) }}>
                        Forward
                      </button>
                      {mine && (
                        <>
                          <button type="button" onClick={(e) => { e.stopPropagation(); startEdit(m); setMenuFor(null) }}>
                            Edit
                          </button>
                          <button type="button" className="chat-msg-menu-danger" onClick={(e) => { e.stopPropagation(); setMenuFor(null); deleteMessage(m) }}>
                            Delete
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        })}
        {others.length > 0 && (
          <div className="chat-typing">
            {others.join(', ')} {others.length === 1 ? 'is' : 'are'} typing…
          </div>
        )}
      </div>

      <form className="chat-composer" onSubmit={submit}>
        {editTarget && (
          <div className="chat-quote-preview chat-edit-preview">
            <div className="chat-quote-preview-main">
              <span className="chat-quote-preview-label">Editing message</span>
              <blockquote className="chat-quote chat-quote-preview-text">{quoteSnippet(editTarget.content)}</blockquote>
            </div>
            <button type="button" className="chat-quote-preview-close" aria-label="Cancel edit" onClick={() => { setEditTarget(null); updateDraft('') }}>
              <X size={16} />
            </button>
          </div>
        )}
        {quoteTarget && (
          <div className="chat-quote-preview">
            <div className="chat-quote-preview-main">
              <span className="chat-quote-preview-label">Quoting @{quoteTarget.sender}</span>
              <blockquote className="chat-quote chat-quote-preview-text">{quoteSnippet(quoteTarget.content)}</blockquote>
            </div>
            <button type="button" className="chat-quote-preview-close" aria-label="Cancel quote" onClick={() => setQuoteTarget(null)}>
              <X size={16} />
            </button>
          </div>
        )}
        {attachments.length > 0 && (
          <div className="chat-attachments">
            {attachments.map((a) => (
              <div key={a.id} className={`chat-attachment chat-attachment-${a.status}`}>
                <img src={a.url || a.previewUrl} alt="" />
                {a.status === 'uploading' && (
                  <span className="chat-attachment-overlay"><Loader2 size={18} className="chat-spin" /></span>
                )}
                {a.status === 'error' && <span className="chat-attachment-overlay chat-attachment-err">!</span>}
                <button type="button" className="chat-attachment-x" aria-label="Remove image" onClick={() => removeAttachment(a.id)}>
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="chat-composer-row">
          <ChatComposerTools
            onPickEmoji={(e) => updateDraft((d) => d + e)}
            onPickGif={(url) => { sendMessage(url) }}
          />
          <EmojiTextInput
            className="chat-msg-input"
            placeholder="Type a message…"
            value={draft}
            onChange={(v) => { updateDraft(v); setTyping(v.length > 0) }}
            onSubmit={send}
            onPasteFiles={handlePasteFiles}
            inputRef={inputRef}
          />
          <button
            type="submit"
            disabled={
              attachments.some((a) => a.status === 'uploading') ||
              (!draft.trim() && !quoteTarget && !attachments.some((a) => a.status === 'done'))
            }
            aria-label="Send"
          >
            <Send size={18} />
          </button>
        </div>
      </form>

      <ChatImageLightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />
    </div>
  )
}

export default function ChatPage() {
  const { ready, connecting, activeConversation, openDmWith, shareDraft } = useChat()
  const authenticated = useAppStore((s) => s.authenticated)
  const [searchParams, setSearchParams] = useSearchParams()

  // Deep link: /chat?dm=<username> (e.g. the "Write message" profile button)
  // opens that DM once chat is connected, then drops the param.
  useEffect(() => {
    const dm = searchParams.get('dm')
    if (!ready || !dm) return
    openDmWith(dm).catch(() => {})
    const next = new URLSearchParams(searchParams)
    next.delete('dm')
    setSearchParams(next, { replace: true })
  }, [ready, searchParams, openDmWith, setSearchParams])

  if (!authenticated) {
    return (
      <div className="chat-page">
        <div className="chat-gate">
          <div className="chat-gate-icon">
            <MessageCirclePlus size={44} />
          </div>
          <h3>Log in to use chat</h3>
          <p>Sign in with your Hive account to send and receive messages.</p>
        </div>
      </div>
    )
  }

  if (!ready) {
    // While the silent background connect runs, show a spinner rather than the
    // gate — the gate only appears if auto-connect couldn't establish a session.
    return (
      <div className="chat-page">
        {connecting ? (
          <div className="chat-gate">
            <Loader2 size={40} className="chat-spin" />
            <p>Connecting to chat…</p>
          </div>
        ) : (
          <ConnectGate />
        )}
      </div>
    )
  }

  // `has-active` drives the mobile single-pane swap (list vs thread).
  return (
    <div className={`chat-page two-pane${activeConversation ? ' has-active' : ''}`}>
      <div className="chat-page-sidebar">
        <ConversationList />
      </div>
      <div className="chat-page-main">
        {activeConversation ? (
          <Thread key={activeConversation._id} conv={activeConversation} />
        ) : (
          <div className="chat-empty chat-page-placeholder">
            {shareDraft ? 'Choose a chat to send to.' : 'Select a conversation, or start a new one.'}
          </div>
        )}
      </div>
    </div>
  )
}
