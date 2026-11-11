import { Suspense, useEffect, useLayoutEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Icon } from '../v2/Icon'
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

const PEEK_GAP = 6
const PEEK_EDGE = 8

// Floating chat panel for tablet/desktop. Mounted once at the app root so it
// survives navigation: open a chat, keep browsing, the thread stays put.
//
// Opened with a click it docks bottom-right. A hover peek (ChatContext `peek`)
// hangs it under the top bar's chat button instead, so the mouse can reach it,
// and starts at the conversation list: an open thread marks its messages read,
// which a hover must never do. Typing in it (a message or a search) keeps it,
// and so does a click on the chat button; clicking around inside does not.
export default function ChatOverlay() {
  const { t } = useTranslation()
  const { overlayOpen, closeOverlay, peek, activeConversation, backToList } = useChat()
  const { pathname } = useLocation()
  // The full page is already showing chat; two copies would fight over the
  // same active conversation.
  const docked = overlayOpen && pathname !== '/chat'
  const peeking = !overlayOpen && peek.rendered && pathname !== '/chat'
  const visible = docked || peeking
  const [expanded, setExpanded] = useState(false)
  const [anchor, setAnchor] = useState(null)

  // Every open starts as the small panel.
  useEffect(() => {
    if (!overlayOpen && !peek.shown) setExpanded(false)
  }, [overlayOpen, peek.shown])

  // A peek starts at the list, and under the button.
  useLayoutEffect(() => {
    if (!peek.shown || overlayOpen) return
    if (!peek.open && activeConversation) backToList()
    const btn = document.querySelector('.chat-nav-btn')
    if (!btn) return
    const r = btn.getBoundingClientRect()
    setAnchor({ top: r.bottom + PEEK_GAP, right: Math.max(PEEK_EDGE, window.innerWidth - r.right) })
    // Only when a peek starts: a conversation opened inside it must stay open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peek.shown, overlayOpen])

  useEffect(() => {
    if (!visible) return
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      // Let an open emoji/GIF picker, lightbox, dialog (new room, channel
      // browser) or confirm bar take the first Escape.
      if (document.querySelector('.chat-lightbox, .chat-popover, .v2-dialog, .v2-confirmbar')) return
      // Fullscreen steps back to the panel before the panel closes.
      if (expanded) setExpanded(false)
      else closeOverlay()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [visible, expanded, closeOverlay])

  if (!visible) return null

  const asPeek = peeking && !expanded
  const className = [
    'chat-overlay',
    expanded && 'chat-overlay--expanded',
    asPeek && 'chat-overlay--peek',
    peeking && peek.leaving && 'chat-overlay--leaving',
  ].filter(Boolean).join(' ')

  return (
    <div
      className={className}
      role="dialog"
      aria-label={t('chat.button.label')}
      style={asPeek && anchor ? { top: anchor.top, right: anchor.right } : undefined}
      {...(peeking ? { ...peek.hoverProps, ...peek.typingProps } : {})}
    >
      <Suspense
        fallback={
          <div className="chat-overlay-loading">
            <Icon name="progress_activity" size={28} className="v2-spin" />
          </div>
        }
      >
        <ChatPanel overlay expanded={expanded} onToggleExpand={() => setExpanded((v) => !v)} />
      </Suspense>
    </div>
  )
}
