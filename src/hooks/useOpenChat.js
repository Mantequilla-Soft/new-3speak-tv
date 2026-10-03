import { useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useChat } from '../context/ChatContext'

// Same cut as mixins.scss `respond(phone)`.
const PHONE_QUERY = '(max-width: 767px)'

export function isPhoneWidth() {
  return typeof window !== 'undefined' && window.matchMedia?.(PHONE_QUERY).matches
}

// One way into chat for every entry point. Wider screens get the overlay panel
// so whatever is on the page (a video, a feed) stays put; phones get the /chat
// page, where a floating panel would just be a worse full screen.
export function useOpenChat() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { openOverlay } = useChat()

  return useCallback(({ dm } = {}) => {
    if (isPhoneWidth() || pathname === '/chat') {
      navigate(dm ? `/chat?dm=${encodeURIComponent(dm)}` : '/chat')
      return
    }
    openOverlay({ dm })
  }, [navigate, pathname, openOverlay])
}
