import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X, ExternalLink } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/** Full-screen viewer for a chat image, with close + open-in-new-tab buttons. */
export default function ChatImageLightbox({ url, onClose }) {
  const { t } = useTranslation()
  useEffect(() => {
    if (!url) return
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [url, onClose])

  if (!url) return null

  return createPortal(
    <div className="chat-lightbox" onClick={onClose}>
      <div className="chat-lightbox-bar" onClick={(e) => e.stopPropagation()}>
        <a
          className="chat-lightbox-btn"
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          title={t('chat.lightbox.openInNewTab')}
          aria-label={t('chat.lightbox.openInNewTab')}
        >
          <ExternalLink size={20} />
        </a>
        <button className="chat-lightbox-btn" onClick={onClose} title={t('common.actions.close')} aria-label={t('common.actions.close')}>
          <X size={22} />
        </button>
      </div>
      <img className="chat-lightbox-img" src={url} alt="" onClick={(e) => e.stopPropagation()} />
    </div>,
    document.body
  )
}
