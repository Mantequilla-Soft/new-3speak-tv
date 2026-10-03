import { useState, useRef, useEffect, useCallback } from 'react'
import { Smile, Loader2 } from 'lucide-react'
import EmojiPicker from 'emoji-picker-react'
import { useAppStore } from '../../lib/store'
import { useTranslation } from 'react-i18next'

// Giphy API key — set VITE_GIPHY_API_KEY per environment (it's a client-side
// key, baked into the bundle). Without it, GIF search returns nothing.
const GIPHY_KEY = import.meta.env.VITE_GIPHY_API_KEY || ''

export default function ChatComposerTools({ onPickEmoji, onPickGif }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(null) // 'emoji' | 'gif' | null
  const [query, setQuery] = useState('')
  const [gifs, setGifs] = useState([])
  const [loading, setLoading] = useState(false)
  const wrapRef = useRef(null)
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
      <button
        type="button"
        className={`chat-tool-btn${open === 'emoji' ? ' active' : ''}`}
        onClick={() => setOpen(open === 'emoji' ? null : 'emoji')}
        aria-label={t('chat.tools.emoji')}
        title={t('chat.tools.emoji')}
      >
        <Smile size={20} />
      </button>
      <button
        type="button"
        className={`chat-tool-btn chat-tool-gif${open === 'gif' ? ' active' : ''}`}
        onClick={() => setOpen(open === 'gif' ? null : 'gif')}
        aria-label="GIF"
        title="GIF"
      >
        GIF
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
            className="chat-gif-search"
            type="text"
            placeholder={t('chat.tools.searchGifs')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          <div className="chat-gif-grid">
            {loading && <div className="chat-gif-loading"><Loader2 size={20} className="chat-spin" /></div>}
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
