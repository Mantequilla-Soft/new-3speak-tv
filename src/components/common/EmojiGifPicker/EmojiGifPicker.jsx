import { useState, useRef, useEffect, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../../v2/Icon'
import { Segmented } from '../../v2/ui'
import { useTranslation } from 'react-i18next'
import EmojiPicker from '../LazyEmojiPicker'
import { useAppStore } from '../../../lib/store'
import useGiphySearch, { normalizeGifUrl } from '../../../hooks/useGiphySearch'
import { usePortalDoc } from '../../../utils/portalDocument'
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
 *  - portal      render the popover over the page (fixed, next to the buttons)
 *                instead of inside the wrapper: for composers inside a box that
 *                clips its overflow (the audio player's comment box)
 *  - disabled    hide/disable the buttons
 *  - className   extra classes on the wrapper
 */
export default function EmojiGifPicker({
  onPickEmoji,
  onPickGif,
  align = 'left',
  openDirection = 'up',
  disabled = false,
  portal = false,
  className = '',
}) {
  const doc = usePortalDoc()
  const { t } = useTranslation()
  const [open, setOpen] = useState(null) // 'emoji' | 'gif' | null
  const wrapRef = useRef(null)
  const popRef = useRef(null)
  const [anchor, setAnchor] = useState(null) // portal mode, wider screens: fixed position
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
    const onDoc = (e) => {
      if (wrapRef.current?.contains(e.target) || popRef.current?.contains(e.target)) return
      setOpen(null)
    }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(null) }
    doc.addEventListener('mousedown', onDoc)
    doc.addEventListener('keydown', onKey)
    return () => { doc.removeEventListener('mousedown', onDoc); doc.removeEventListener('keydown', onKey) }
  }, [open, doc])

  // Portal mode on wider screens: next to the buttons, on the side with more
  // room, inside the window. Phones keep the bottom sheet from the stylesheet.
  useLayoutEffect(() => {
    if (!portal || !open || isPhone() || !wrapRef.current) { setAnchor(null); return }
    const win = doc.defaultView || window
    const place = () => {
      const r = wrapRef.current.getBoundingClientRect()
      const w = popRef.current?.offsetWidth || 360
      const left = Math.min(Math.max(8, align === 'right' ? r.right - w : r.left), win.innerWidth - w - 8)
      const above = r.top - 16
      const below = win.innerHeight - r.bottom - 16
      setAnchor(above >= below
        ? { left, bottom: win.innerHeight - r.top + 8, maxHeight: above }
        : { left, top: r.bottom + 8, maxHeight: below })
    }
    place()
    win.addEventListener('resize', place)
    return () => win.removeEventListener('resize', place)
  }, [portal, open, align, doc])

  const pickGif = (g) => {
    const url = normalizeGifUrl(g)
    if (url) { onPickGif?.(url); setOpen(null) }
  }

  if (disabled) return null

  const popClass = `egp-popover egp-${align} egp-open-${openDirection}${viewport?.kb ? ' egp-above-kb' : ''}${portal ? ' egp-portal' : ''}`
  const popStyle = viewport
    ? { '--egp-kb': `${viewport.kb}px`, '--egp-vh': `${viewport.h}px` }
    : portal ? (anchor
      ? { left: anchor.left, top: anchor.top, bottom: anchor.bottom, maxHeight: anchor.maxHeight }
      : { left: -9999, top: 0, visibility: 'hidden' }) // measured first, then placed
      : undefined
  // Room for the picker under the 48px Emoji / GIF head and the frame's padding.
  const emojiHeight = viewport
    ? Math.max(200, Math.min(340, viewport.h - 80))
    : anchor ? Math.max(200, Math.min(340, anchor.maxHeight - 64)) : 340
  // Portal mode: the popover goes into the body of the document the composer is
  // in (the page, or the audio player's pop-out window).
  const place = (node) => (portal ? createPortal(node, doc.body) : node)
  // Emoji / GIF as one picker with a segmented head (design 19e): either button
  // opens it on its own kind, the head switches between them.
  const head = (
    <div className="egp-head">
      <Segmented
        size={32}
        block={false}
        value={open}
        onChange={(k) => setOpen(k)}
        options={[{ value: 'emoji', label: t('app.emojiGif.emoji') }, { value: 'gif', label: 'GIF' }]}
      />
    </div>
  )

  return (
    <div className={`egp-tools ${className}`} ref={wrapRef}>
      <button
        type="button"
        className={`egp-btn${open === 'emoji' ? ' active' : ''}`}
        onClick={() => toggle('emoji')}
        aria-label={t('app.emojiGif.emoji')}
        title={t('app.emojiGif.emoji')}
      >
        <Icon name="mood" size={20} />
      </button>
      <button
        type="button"
        className={`egp-btn egp-gif-btn${open === 'gif' ? ' active' : ''}`}
        onClick={() => toggle('gif')}
        aria-label="GIF"
        title="GIF"
      >
        <Icon name="gif_box" size={20} />
      </button>

      {open === 'emoji' && place(
        <div ref={popRef} className={`${popClass} egp-emoji-popover`} style={popStyle}>
          {head}
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

      {open === 'gif' && place(
        <div ref={popRef} className={`${popClass} egp-gif-popover`} style={popStyle}>
          {head}
          <input
            className="egp-gif-search"
            type="text"
            placeholder={t('app.emojiGif.searchGifs')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          <div className="egp-gif-grid">
            {loading && <div className="egp-gif-loading"><Icon name="progress_activity" size={20} className="v2-spin" /></div>}
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
