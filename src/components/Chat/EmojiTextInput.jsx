import { useRef, useState, useCallback, useEffect } from 'react'
import { emojiSuggestions, convertClosedShortcode, insertPickedEmoji } from '../../lib/emojiShortcodes'

/**
 * Multiline chat composer with inline `:shortcode:` emoji support.
 *  - Enter sends (desktop); Shift+Enter and touch-Enter insert a newline
 *  - typing ":" opens an emoji typeahead (↑/↓ move, Enter/Tab insert, Esc close)
 *  - typing a closing ":" (":fire:") converts to the emoji inline
 * The shortcode rules live in lib/emojiShortcodes.js (shared with the comment boxes).
 */
export default function EmojiTextInput({ value, onChange, onSubmit, onPasteFiles, placeholder, className, inputRef }) {
  const internalRef = useRef(null)
  const ref = inputRef || internalRef
  const [ta, setTa] = useState(null) // { items: [{emoji,name}], index }

  // Auto-grow the textarea to fit its content (capped).
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 140) + 'px'
  }, [value, ref])

  const refreshTypeahead = useCallback((val, cursor) => {
    const items = emojiSuggestions(val, cursor)
    setTa(items ? { items, index: 0 } : null)
  }, [])

  const apply = useCallback((emojiChar) => {
    const el = ref.current
    const cursor = el ? el.selectionStart : value.length
    const picked = insertPickedEmoji(value, cursor, emojiChar)
    setTa(null)
    if (!picked) return
    onChange(picked.value)
    requestAnimationFrame(() => {
      if (ref.current) { ref.current.focus(); ref.current.setSelectionRange(picked.cursor, picked.cursor) }
    })
  }, [value, onChange, ref])

  const handleChange = (e) => {
    const val = e.target.value
    const cursor = e.target.selectionStart
    // Auto-convert a just-completed ":word:" at the cursor → emoji.
    const converted = convertClosedShortcode(val, cursor)
    if (converted) {
      onChange(converted.value)
      setTa(null)
      requestAnimationFrame(() => {
        if (ref.current) { ref.current.focus(); ref.current.setSelectionRange(converted.cursor, converted.cursor) }
      })
      return
    }
    onChange(val)
    refreshTypeahead(val, cursor)
  }

  const handleKeyDown = (e) => {
    if (ta) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setTa((t) => ({ ...t, index: (t.index + 1) % t.items.length })) }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setTa((t) => ({ ...t, index: (t.index - 1 + t.items.length) % t.items.length })) }
      else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); apply(ta.items[ta.index].emoji) }
      else if (e.key === 'Escape') { e.preventDefault(); setTa(null) }
      return
    }
    // Enter sends on devices with a physical keyboard; Shift+Enter and
    // touch-Enter insert a newline (multiline messages).
    const isTouch = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)')?.matches
    if (e.key === 'Enter' && !e.shiftKey && !isTouch) {
      e.preventDefault()
      onSubmit?.()
    }
  }

  const handlePaste = (e) => {
    const items = e.clipboardData?.items
    if (!items || !onPasteFiles) return
    const files = []
    for (const it of items) {
      if (it.type && it.type.startsWith('image/')) {
        const f = it.getAsFile()
        if (f) files.push(f)
      }
    }
    if (files.length) { e.preventDefault(); onPasteFiles(files) }
  }

  return (
    <div className="chat-emoji-input">
      <textarea
        ref={ref}
        rows={1}
        className={className}
        placeholder={placeholder}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onBlur={() => setTimeout(() => setTa(null), 120)}
      />
      {ta && (
        <ul className="chat-typeahead" role="listbox">
          {ta.items.map((it, i) => (
            <li
              key={it.name + i}
              className={`chat-typeahead-item${i === ta.index ? ' active' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); apply(it.emoji) }}
              onMouseEnter={() => setTa((t) => ({ ...t, index: i }))}
            >
              <span className="chat-typeahead-emoji">{it.emoji}</span>
              <span className="chat-typeahead-name">:{it.name}:</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
