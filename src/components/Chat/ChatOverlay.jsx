import { Suspense, useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useChat } from '../../context/ChatContext'
import { useTranslation } from 'react-i18next'
import lazyRoute from '../../utils/lazyRoute'
import './ChatOverlay.scss'

// The chat module (SDK hooks, composer, pickers) only loads once the panel is
// first opened, same as the /chat page.
const ChatPanel = lazyRoute(
  () => import('./ChatPage').then((m) => ({ default: m.ChatPanel })),
  './components/Chat/ChatPage#ChatPanel'
)

// Floating chat panel for tablet/desktop. Mounted once at the app root so it
// survives navigation: open a chat, keep browsing, the thread stays put.
export default function ChatOverlay() {
  const { t } = useTranslation()
  const { overlayOpen, closeOverlay } = useChat()
  const { pathname } = useLocation()
  // The full page is already showing chat; two copies would fight over the
  // same active conversation.
  const visible = overlayOpen && pathname !== '/chat'
  const [expanded, setExpanded] = useState(false)

  // Every open starts as the small panel.
  useEffect(() => {
    if (!overlayOpen) setExpanded(false)
  }, [overlayOpen])

  useEffect(() => {
    if (!visible) return
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      // Let an open emoji/GIF picker or lightbox take the first Escape.
      if (document.querySelector('.chat-lightbox, .chat-popover')) return
      // Fullscreen steps back to the panel before the panel closes.
      if (expanded) setExpanded(false)
      else closeOverlay()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [visible, expanded, closeOverlay])

  if (!visible) return null

  return (
    <div
      className={`chat-overlay${expanded ? ' chat-overlay--expanded' : ''}`}
      role="dialog"
      aria-label={t('chat.button.label')}
    >
      <Suspense
        fallback={
          <div className="chat-overlay-loading">
            <Loader2 size={28} className="chat-overlay-spin" />
          </div>
        }
      >
        <ChatPanel overlay expanded={expanded} onToggleExpand={() => setExpanded((v) => !v)} />
      </Suspense>
    </div>
  )
}
