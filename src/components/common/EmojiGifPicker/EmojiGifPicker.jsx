import { useState, useRef, useEffect } from 'react'
import { Smile, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import EmojiPicker from 'emoji-picker-react'
import { useAppStore } from '../../../lib/store'
import useGiphySearch, { normalizeGifUrl } from '../../../hooks/useGiphySearch'
import './EmojiGifPicker.scss'

const PHONE = '(max-width: 767px)'
const isPhone = () => typeof window !== 'undefined' && !!window.matchMedia?.(PHONE).matches

const isTextField = (el) => !!el && (
  el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.isContentEditable
)

// What is still visible of the screen: the height of the visual viewport and how
// far the on-screen keyboard reaches up over the layout viewport (which is what
// position:fixed hangs off, so a bottom sheet would otherwise sit behind it).
const readViewport = () => {
  const vv = window.visualViewport
  if (!vv) return { kb: 0, h: window.innerHeight }
  return { kb: Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)), h: Math.round(vv.height) }
}

/**
 * Emoji + GIF picker for comment/reply composers — the same experience as the
 * chat composer (emoji-picker-react + Giphy). Insertion is delegated to the
 * parent so it can drop the value into its own draft at the caret.
 *
 * Props:
 *  - onPickEmoji(emojiChar)  → insert an emoji
 *  - onPickGif(gifUrl)       → insert a GIF (plain `.gif` URL, ready for markdown)
 *  - align       'left' | 'right'  horizontal anchor of the popover (default 'left')
 *  - openDirection 'up' | 'down'   vertical direction the popover opens (default 'up')
 *  - disabled    hide/disable the buttons
 *  - className   extra classes on the wrapper
 */
export default function EmojiGifPicker({
  onPickEmoji,
  onPickGif,
  align = 'left',
  openDirection = 'up',
  disabled = false,
  className = '',
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(null) // 'emoji' | 'gif' | null
  const wrapRef = useRef(null)
  const appTheme = useAppStore((s) => s.theme)
  const { query, setQuery, gifs, loading } = useGiphySearch(open === 'gif')
  const [viewport, setViewport] = useState(null) // phones only, while open

  // Phones: keep the bottom sheet above the keyboard and inside what is visible.
  useEffect(() => {
    if (!open || !isPhone()) { setViewport(null); return }
    const update = () => setViewport(readViewport())
    update()
    const vv = window.visualViewport
    vv?.addEventListener('resize', update)
    vv?.addEventListener('scroll', update)
    window.addEventListener('resize', update)
    return () => {
      vv?.removeEventListener('resize', update)
      vv?.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [open])

  const toggle = (kind) => {
    const next = open === kind ? null : kind
    // Phones: emoji replace the keyboard, like a native emoji keyboard. iOS keeps
    // the composer focused when a button is tapped, so drop the focus by hand.
    if (next === 'emoji' && isPhone() && isTextField(document.activeElement)) document.activeElement.blur()
    setOpen(next)
  }

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return
    const onDoc = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(null) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(null) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open])

  const pickGif = (g) => {
    const url = normalizeGifUrl(g)
    if (url) { onPickGif?.(url); setOpen(null) }
  }

  if (disabled) return null

  const popClass = `egp-popover egp-${align} egp-open-${openDirection}${viewport?.kb ? ' egp-above-kb' : ''}`
  const popStyle = viewport ? { '--egp-kb': `${viewport.kb}px`, '--egp-vh': `${viewport.h}px` } : undefined
  const emojiHeight = viewport ? Math.max(200, Math.min(380, viewport.h - 24)) : 380

  return (
    <div className={`egp-tools ${className}`} ref={wrapRef}>
      <button
        type="button"
        className={`egp-btn${open === 'emoji' ? ' active' : ''}`}
        onClick={() => toggle('emoji')}
        aria-label={t('app.emojiGif.emoji')}
        title={t('app.emojiGif.emoji')}
      >
        <Smile size={18} />
      </button>
      <button
        type="button"
        className={`egp-btn egp-gif-btn${open === 'gif' ? ' active' : ''}`}
        onClick={() => toggle('gif')}
        aria-label="GIF"
        title="GIF"
      >
        GIF
      </button>

      {open === 'emoji' && (
        <div className={`${popClass} egp-emoji-popover`} style={popStyle}>
          <EmojiPicker
            onEmojiClick={(d) => onPickEmoji?.(d.emoji)}
            theme={appTheme === 'light' ? 'light' : 'dark'}
            lazyLoadEmojis
            width="100%"
            height={emojiHeight}
            previewConfig={{ showPreview: false }}
            searchPlaceholder={t('app.emojiGif.searchEmoji')}
          />
        </div>
      )}

      {open === 'gif' && (
        <div className={`${popClass} egp-gif-popover`} style={popStyle}>
          <input
            className="egp-gif-search"
            type="text"
            placeholder={t('app.emojiGif.searchGifs')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          <div className="egp-gif-grid">
            {loading && <div className="egp-gif-loading"><Loader2 size={20} className="egp-spin" /></div>}
            {!loading && gifs.length === 0 && <div className="egp-gif-empty">{t('app.emojiGif.noGifs')}</div>}
            {!loading && gifs.map((g) => (
              <button key={g.id} type="button" className="egp-gif-item" onClick={() => pickGif(g)}>
                <img src={g.images?.fixed_height?.url || g.images?.fixed_height_small?.url} alt={g.title || 'gif'} loading="lazy" />
              </button>
            ))}
          </div>
          <div className="egp-gif-attribution">{t('app.emojiGif.poweredBy')}</div>
        </div>
      )}
    </div>
  )
}
