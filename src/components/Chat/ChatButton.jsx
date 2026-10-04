import { useLocation } from 'react-router-dom'
import { MessageCircle } from 'lucide-react'
import { useServerUnread } from '../../hooks/useServerUnread'
import { useChat } from '../../context/ChatContext'
import { useOpenChat } from '../../hooks/useOpenChat'
import './ChatButton.scss'
import { useTranslation } from 'react-i18next'

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
  const { t } = useTranslation()
  const { ready, warmup, overlayOpen, closeOverlay } = useChat()
  const openChat = useOpenChat()
  const { pathname } = useLocation()
  const onChatPage = pathname === '/chat'
  const isOpen = onChatPage || overlayOpen

  // Warm-up users (no Hive account) sign in to chat through their ButrAuth
  // session. Until that has worked, e.g. while the chat server has not switched
  // it on, the button would only lead to a dead end, so it stays hidden.
  if (warmup && !ready) return null

  return (
    // A toggle for the overlay on wider screens, a link to /chat on phones
    // (useOpenChat picks).
    <button
      type="button"
      className={`chat-nav-btn${isOpen ? ' open' : ''}`}
      aria-label={t('chat.button.label')}
      aria-expanded={!onChatPage ? overlayOpen : undefined}
      title={t('chat.button.label')}
      onClick={() => (overlayOpen && !onChatPage ? closeOverlay() : openChat())}
    >
      <MessageCircle size={21} />
      {ready && <UnreadDot />}
    </button>
  )
}
