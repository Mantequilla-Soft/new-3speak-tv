// Helpers for inserting emoji / GIF markdown into a controlled textarea|input
// from an emoji/GIF picker. Insertion happens at the caret (falling back to
// append) and, for textareas, re-runs the auto-grow the onChange handlers use.

// Markdown for an inline GIF. On its own lines so the Hive renderer treats it as
// an image block. `![gif](url)` renders on 3Speak, Hive.blog, PeakD, etc.
export function gifMarkdown(url) {
  return `\n![gif](${url})\n`
}

/**
 * Insert `snippet` at the caret of `el` (a textarea/input), updating controlled
 * state through `setValue`. If `el` is missing, appends to the end.
 * `setValue` receives the full next string.
 */
export function insertAtCursor(el, value, snippet, setValue) {
  const v = value || ''
  if (!el || typeof el.selectionStart !== 'number') {
    setValue(v + snippet)
    return
  }
  const start = el.selectionStart
  const end = el.selectionEnd ?? start
  const next = v.slice(0, start) + snippet + v.slice(end)
  setValue(next)
  // Phones: focusing the field brings the keyboard back up over the picker
  // after every emoji, so leave the focus where it is there.
  const phone = typeof window !== 'undefined' && !!window.matchMedia?.('(max-width: 767px)').matches
  requestAnimationFrame(() => {
    try {
      if (!phone) el.focus()
      const pos = start + snippet.length
      if (!phone || document.activeElement === el) el.setSelectionRange(pos, pos)
      if (el.tagName === 'TEXTAREA') {
        el.style.height = 'auto'
        el.style.height = el.scrollHeight + 'px'
      }
    } catch { /* element may have unmounted */ }
  })
}
