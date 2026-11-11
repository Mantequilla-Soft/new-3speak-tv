import { useLocation } from 'react-router-dom'
import { Icon } from '../v2/Icon'
import { useServerUnread } from '../../hooks/useServerUnread'
import { useChat } from '../../context/ChatContext'
import { useOpenChat, isPhoneWidth } from '../../hooks/useOpenChat'
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
  const { ready, warmup, overlayOpen, closeOverlay, peek } = useChat()
  const openChat = useOpenChat()
  const { pathname } = useLocation()
  const onChatPage = pathname === '/chat'
  const isOpen = onChatPage || overlayOpen

  // Warm-up users (no Hive account) sign in to chat through their ButrAuth
  // session. Until that has worked, e.g. while the chat server has not switched
  // it on, the button would only lead to a dead end, so it stays hidden.
  if (warmup && !ready) return null

  // Hover peek (ChatContext): only where a click would open the panel, i.e. not
  // on phones (they go to /chat), not on /chat, not while the panel is open.
  const canPeek = !onChatPage && !overlayOpen && !isPhoneWidth()
  const onClick = () => {
    // A peek on screen: the click keeps it where it is (or closes a kept one).
    if (peek.shown) { peek.toggle(); return }
    if (overlayOpen && !onChatPage) closeOverlay()
    else openChat()
  }

  return (
    // A toggle for the overlay on wider screens, a link to /chat on phones
    // (useOpenChat picks).
    <button
      type="button"
      className={`chat-nav-btn${isOpen || peek.shown ? ' open' : ''}`}
      aria-label={t('chat.button.label')}
      aria-expanded={!onChatPage ? overlayOpen || peek.shown : undefined}
      title={t('chat.button.label')}
      onClick={onClick}
      {...(canPeek || peek.rendered ? peek.hoverProps : {})}
    >
      <MessageCircle size={21} />
      {ready && <UnreadDot />}
    </button>
  )
}
