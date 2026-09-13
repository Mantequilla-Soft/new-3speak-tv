import { NavLink } from 'react-router-dom'
import { MessageCircle } from 'lucide-react'
import { useServerUnread } from '../../hooks/useServerUnread'
import { useChat } from '../../context/ChatContext'
import { useAppStore } from '../../lib/store'
import './ChatButton.scss'

// Split out so the unread subscription only mounts once chat is connected —
// the SDK hook keys its subscription on the client, not on auth state, so we
// remount it (via conditional render) when `ready` flips.
function UnreadDot() {
  // Server-truth, never a locally accumulated number (see useServerUnread).
  const { unreadCount } = useServerUnread()
  if (!unreadCount) return null
  return (
    <span className="chat-nav-badge" aria-hidden="true">
      {unreadCount > 9 ? '9+' : unreadCount}
    </span>
  )
}

export default function ChatButton() {
  const { ready } = useChat()
  const incubationHandle = useAppStore((s) => s.incubationHandle)

  // Chat is a Hive-account feature end to end: Snapie authenticates it with a
  // posting-key signMessage challenge, so there is nothing to sign for someone
  // who has no account yet and no off-chain equivalent to divert to. Offering
  // the button anyway just walks them into a signing error.
  if (incubationHandle) return null

  return (
    <NavLink
      to="/chat"
      className={({ isActive }) => `chat-nav-btn${isActive ? ' open' : ''}`}
      aria-label="Chat"
      title="Chat"
    >
      <MessageCircle size={21} />
      {ready && <UnreadDot />}
    </NavLink>
  )
}
