import { useCallback, useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { useChat } from '../../context/ChatContext'
import { isPhoneWidth } from '../../hooks/useOpenChat'

// The newest message we already opened the chat for. Stored so that closing
// the chat and reloading does not throw the same message at the user again:
// only a message that arrived after it reopens the chat.
const SEEN_KEY = 'chat-autoopen-last'
// Same cadence as the nav badge (useServerUnread).
const POLL_MS = 20000

function readSeen() {
  try { return localStorage.getItem(SEEN_KEY) } catch { return null }
}
function writeSeen(id) {
  try { localStorage.setItem(SEEN_KEY, id) } catch { /* private mode: reopen next time, harmless */ }
}

const createdAt = (conv) => new Date(conv?.lastMessage?.createdAt || 0).getTime()

const NON_TEXT_INPUTS = new Set(['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'color', 'file', 'image'])

// Somebody typing (a comment, the uploader, search) or watching fullscreen is
// busy. The panel would land on top of what they are doing, so it waits until
// they stop and opens on the next check.
function userIsBusy() {
  if (document.fullscreenElement) return true
  const el = document.activeElement
  if (!el || el === document.body) return false
  if (el.isContentEditable) return true
  if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true
  if (el.tagName === 'INPUT') return !NON_TEXT_INPUTS.has(String(el.type || 'text').toLowerCase())
  return false
}

// Opens the chat panel, straight into the conversation with the newest unread
// message: when someone arrives with one waiting, and when one comes in while
// the page is open.
//
// Desktop only. Phones get the full /chat page instead of a panel, and taking
// over the whole screen uninvited is not "showing" a message.
//
// It never takes focus: opening a thread does not focus the composer, so
// whatever the person was doing keeps the keyboard. It never switches what an
// open chat is showing, and it leaves the /chat page and the share flow alone.
export default function ChatAutoOpen() {
  const { client, ready, openConversation, openOverlay, overlayOpen, shareDraft } = useChat()
  const { pathname } = useLocation()

  // The poll outlives renders, so it reads the current state through a ref
  // instead of the values its closure was created with.
  const live = useRef({ overlayOpen, shareDraft, pathname })
  useEffect(() => {
    live.current = { overlayOpen, shareDraft, pathname }
  }, [overlayOpen, shareDraft, pathname])
  const inFlight = useRef(false)

  const check = useCallback(async () => {
    if (inFlight.current) return
    const blocked = () => {
      const { overlayOpen: open, shareDraft: sharing, pathname: path } = live.current
      return open || !!sharing || path === '/chat' || isPhoneWidth() || userIsBusy()
    }
    if (blocked()) return
    inFlight.current = true
    try {
      // The cheap question first; the conversation list only when it matters.
      const unread = await client.getUnread()
      if (!(Number(unread?.unread ?? unread?.total ?? 0) > 0)) return
      const conversations = await client.getConversations()
      const target = (conversations || [])
        .filter((c) => (c.unreadCount || 0) > 0 && c.lastMessage?._id)
        .sort((a, b) => createdAt(b) - createdAt(a))[0]
      if (!target || target.lastMessage._id === readSeen()) return
      // The world may have moved during the two requests.
      if (blocked()) return
      writeSeen(target.lastMessage._id)
      openConversation(target)
      openOverlay()
    } catch {
      // Offline or chat backend down: the next check tries again.
    } finally {
      inFlight.current = false
    }
  }, [client, openConversation, openOverlay])

  useEffect(() => {
    if (!ready) return
    check()
    const id = setInterval(check, POLL_MS)
    window.addEventListener('focus', check)
    return () => {
      clearInterval(id)
      window.removeEventListener('focus', check)
    }
  }, [ready, check])

  return null
}
