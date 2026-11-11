import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Icon } from '../v2/Icon'
import { timeAgo } from './chatLinks'

/**
 * Full-screen viewer for a chat image (19e): who sent it and when on the left
 * of the top bar, open-in-new-tab and close on the right, the image below.
 * `sender` and `createdAt` are optional.
 */
export default function ChatImageLightbox({ url, sender, createdAt, onClose }) {
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
        {sender && (
          <div className="chat-lightbox-who">
            <img src={`/img/u/${sender}/avatar/small`} alt="" onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} />
            <div>
              <b>@{sender}</b>
              {createdAt && <span title={new Date(createdAt).toLocaleString()}>{timeAgo(createdAt)}</span>}
            </div>
          </div>
        )}
        <a
          className="chat-lightbox-btn"
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          title={t('chat.lightbox.openInNewTab')}
          aria-label={t('chat.lightbox.openInNewTab')}
        >
          <Icon name="open_in_new" size={22} />
        </a>
        <button type="button" className="chat-lightbox-btn" onClick={onClose} title={t('common.actions.close')} aria-label={t('common.actions.close')}>
          <Icon name="close" size={24} />
        </button>
      </div>
      <div className="chat-lightbox-stage">
        <img className="chat-lightbox-img" src={url} alt="" onClick={(e) => e.stopPropagation()} />
      </div>
    </div>,
    document.body
  )
}
