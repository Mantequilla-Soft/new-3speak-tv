import { useState, useRef, useEffect, useCallback } from 'react'
import EmojiPicker from 'emoji-picker-react'
import { useAppStore } from '../../lib/store'
import { useTranslation } from 'react-i18next'
import { Icon } from '../v2/Icon'

// Giphy API key — set VITE_GIPHY_API_KEY per environment (it's a client-side
// key, baked into the bundle). Without it, GIF search returns nothing.
const GIPHY_KEY = import.meta.env.VITE_GIPHY_API_KEY || ''

// onPickImages (optional): an "add image" tool that hands picked files to the
// same upload path as pasting an image into the composer.
export default function ChatComposerTools({ onPickEmoji, onPickGif, onPickImages }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(null) // 'emoji' | 'gif' | null
  const [query, setQuery] = useState('')
  const [gifs, setGifs] = useState([])
  const [loading, setLoading] = useState(false)
  const wrapRef = useRef(null)
  const fileRef = useRef(null)
  const reqRef = useRef(0)
  const appTheme = useAppStore((s) => s.theme)

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return
    const onDoc = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(null) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(null) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open])

  const loadGifs = useCallback(async (q) => {
    const id = ++reqRef.current // ignore responses that arrive out of order
    setLoading(true)
    try {
      const endpoint = q.trim()
        ? `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_KEY}&q=${encodeURIComponent(q.trim())}&limit=24&rating=pg-13`
        : `https://api.giphy.com/v1/gifs/trending?api_key=${GIPHY_KEY}&limit=24&rating=pg-13`
      const res = await fetch(endpoint)
      const data = await res.json()
      if (id !== reqRef.current) return // a newer request superseded this one
      setGifs(Array.isArray(data?.data) ? data.data : [])
    } catch {
      if (id === reqRef.current) setGifs([])
    } finally {
      if (id === reqRef.current) setLoading(false)
    }
  }, [])

  // Single source of truth: load trending on open (query empty), debounce search
  // as the query changes. The reqRef guard above prevents an earlier (trending)
  // response from overwriting a later (search) one.
  useEffect(() => {
    if (open !== 'gif') return
    const timer = setTimeout(() => loadGifs(query), query.trim() ? 350 : 0)
    return () => clearTimeout(timer)
  }, [open, query, loadGifs])

  const pickGif = (g) => {
    const url = g?.images?.fixed_height?.url || g?.images?.original?.url
    if (url) {
      // Drop Giphy's query string so the URL ends in `.gif` (renders inline).
      onPickGif(url.split('?')[0])
      setOpen(null)
    }
  }

  return (
    <div className="chat-tools" ref={wrapRef}>
      {onPickImages && (
        <>
          <button
            type="button"
            className="chat-tool-btn"
            onClick={() => fileRef.current?.click()}
            aria-label={t('chat.tools.image')}
            title={t('chat.tools.image')}
          >
            <Icon name="image" size={20} />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              const files = [...(e.target.files || [])].filter((f) => f.type.startsWith('image/'))
              e.target.value = ''
              if (files.length) onPickImages(files)
            }}
          />
        </>
      )}
      <button
        type="button"
        className={`chat-tool-btn chat-tool-gif${open === 'gif' ? ' active' : ''}`}
        onClick={() => setOpen(open === 'gif' ? null : 'gif')}
        aria-label="GIF"
        aria-expanded={open === 'gif'}
        title="GIF"
      >
        <Icon name="gif_box" size={20} />
      </button>
      <button
        type="button"
        className={`chat-tool-btn${open === 'emoji' ? ' active' : ''}`}
        onClick={() => setOpen(open === 'emoji' ? null : 'emoji')}
        aria-label={t('chat.tools.emoji')}
        aria-expanded={open === 'emoji'}
        title={t('chat.tools.emoji')}
      >
        <Icon name="mood" size={20} />
      </button>

      {open === 'emoji' && (
        <div className="chat-popover chat-emoji-popover">
          <EmojiPicker
            onEmojiClick={(d) => onPickEmoji(d.emoji)}
            theme={appTheme === 'light' ? 'light' : 'dark'}
            lazyLoadEmojis
            width="100%"
            height={420}
            previewConfig={{ showPreview: false }}
            searchPlaceholder={t('chat.tools.searchEmoji')}
          />
        </div>
      )}

      {open === 'gif' && (
        <div className="chat-popover chat-gif-popover">
          <input
            className="chat-gif-search v2-input"
            type="text"
            placeholder={t('chat.tools.searchGifs')}
            aria-label={t('chat.tools.searchGifs')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          <div className="chat-gif-grid">
            {loading && <div className="chat-gif-loading"><Icon name="progress_activity" size={20} className="v2-spin" /></div>}
            {!loading && gifs.length === 0 && <div className="chat-gif-empty">{t('chat.tools.noGifs')}</div>}
            {!loading && gifs.map((g) => (
              <button key={g.id} type="button" className="chat-gif-item" onClick={() => pickGif(g)}>
                <img src={g.images?.fixed_height?.url || g.images?.fixed_height_small?.url} alt={g.title || 'gif'} loading="lazy" />
              </button>
            ))}
          </div>
          <div className="chat-gif-attribution">{t('chat.tools.poweredByGiphy')}</div>
        </div>
      )}
    </div>
  )
}
