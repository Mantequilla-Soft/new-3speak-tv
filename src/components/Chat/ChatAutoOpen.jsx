import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useChat } from '../../context/ChatContext'
import { isPhoneWidth } from '../../hooks/useOpenChat'

// The newest message we already opened the chat for. Stored so that closing
// the chat and reloading does not throw the same message at the user again:
// only a message that arrived after it reopens the chat.
const SEEN_KEY = 'chat-autoopen-last'

function readSeen() {
  try { return localStorage.getItem(SEEN_KEY) } catch { return null }
}
function writeSeen(id) {
  try { localStorage.setItem(SEEN_KEY, id) } catch { /* private mode: reopen next time, harmless */ }
}

const createdAt = (conv) => new Date(conv?.lastMessage?.createdAt || 0).getTime()

// Opens chat on arrival when there is something new in it, straight into the
// conversation that has the newest unread message. Once per page load, after
// chat has connected; never while sharing into chat.
//
// Phones get the full /chat page instead of a panel, so there it only happens
// on the home page: opening a shared video link must show the video, not
// navigate away from it.
export default function ChatAutoOpen() {
  const { client, ready, openConversation, openOverlay, overlayOpen, shareDraft } = useChat()
  const { pathname, search } = useLocation()
  const navigate = useNavigate()
  const doneRef = useRef(false)

  useEffect(() => {
    if (!ready || doneRef.current) return
    // Claimed synchronously and never released: StrictMode runs this effect
    // twice in development, and a cancel-on-cleanup would make the first run
    // give up while the second skipped, so the chat would never open.
    doneRef.current = true
    ;(async () => {
      let conversations
      try {
        conversations = await client.getConversations()
      } catch {
        return // offline or chat backend down: the badge will catch up later
      }
      const target = (conversations || [])
        .filter((c) => (c.unreadCount || 0) > 0 && c.lastMessage?._id)
        .sort((a, b) => createdAt(b) - createdAt(a))[0]
      if (!target || target.lastMessage._id === readSeen()) return
      if (shareDraft || overlayOpen) return

      const onChatPage = pathname === '/chat'
      // A /chat?dm= deep link (the profile "Message" button) already names the
      // conversation to show; switching to another one would undo the click.
      if (onChatPage && new URLSearchParams(search).has('dm')) return
      const phone = isPhoneWidth()
      if (phone && !onChatPage && pathname !== '/') return

      writeSeen(target.lastMessage._id)
      openConversation(target)
      if (onChatPage) return
      if (phone) navigate('/chat')
      else openOverlay()
    })()
    // Deliberately keyed on `ready` only: this is an on-arrival decision, and
    // re-running it on navigation would reopen chat on every page change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready])

  return null
}
