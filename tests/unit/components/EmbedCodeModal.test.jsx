// @vitest-environment jsdom
// "Embed on a website" for an audio or a playlist (components/Embed/EmbedCodeModal.jsx).
// Anything can open it with openEmbedCode(); the one host in the app shows it.
// The snippet follows the chosen size, the copy button puts it on the clipboard,
// and a denied clipboard selects the code so it can be copied by hand.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, screen, within } from '@testing-library/react'
import { renderWithProviders, stubClipboard, toastMessages } from './_render.jsx'

vi.mock('sonner', async () => (await import('./_render.jsx')).sonnerModule())
const { toast } = await import('sonner')
const { default: EmbedCodeHost, openEmbedCode } = await import('../../../src/components/Embed/EmbedCodeModal.jsx')

function open(target) {
  act(() => openEmbedCode(target))
}

let clipboard
let user
beforeEach(() => {
  ({ user } = renderWithProviders(<EmbedCodeHost />))
})
afterEach(() => {
  act(() => openEmbedCode(null))
  clipboard?.restore()
  clipboard = null
})

describe('the embed dialog for an audio', () => {
  it('stays hidden until something asks for it', () => {
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('ignores a request without an id', () => {
    open({ kind: 'audio', title: 'No id' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('opens as a named dialog with the full-size snippet selected', () => {
    open({ kind: 'audio', id: 'my-audio', title: 'Morning show' })
    const dialog = screen.getByRole('dialog', { name: 'Embed this audio' })
    expect(within(dialog).getByText('Paste this into any website or blog post.')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'With title' })).toHaveAttribute('aria-pressed', 'true')
    const code = within(dialog).getByRole('textbox', { name: 'Embed code' })
    expect(code.value).toContain('src="https://audio.3speak.tv/play?a=my-audio&mode=full&iframe=1"')
    expect(code.value).toContain('height="180"')
    expect(code.value).toContain('title="Morning show"')
    expect(within(dialog).getByRole('button', { name: /copy embed code/i })).toHaveTextContent('Full width, 180 px tall')
  })

  it('rebuilds the snippet for the size picked', async () => {
    open({ kind: 'audio', id: 'my-audio', title: 'Morning show' })
    await user.click(screen.getByRole('button', { name: 'Minimal' }))
    expect(screen.getByRole('button', { name: 'Minimal' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'With title' })).toHaveAttribute('aria-pressed', 'false')
    const code = screen.getByRole('textbox', { name: 'Embed code' })
    expect(code.value).toContain('mode=minimal')
    expect(code.value).toContain('height="80"')
    expect(screen.getByRole('button', { name: /copy embed code/i })).toHaveTextContent('80 px tall')
  })

  it('escapes a title that would break out of the HTML attribute', () => {
    open({ kind: 'audio', id: 'a1', title: 'Tom & "Jerry" <live>' })
    expect(screen.getByRole('textbox', { name: 'Embed code' }).value)
      .toContain('title="Tom &amp; &quot;Jerry&quot; &lt;live&gt;"')
  })

  it('copies the snippet shown and confirms it', async () => {
    clipboard = stubClipboard()
    open({ kind: 'audio', id: 'my-audio', title: 'Morning show' })
    await user.click(screen.getByRole('button', { name: 'Compact' }))
    await user.click(screen.getByRole('button', { name: /copy embed code/i }))
    expect(clipboard.writeText).toHaveBeenCalledWith(screen.getByRole('textbox', { name: 'Embed code' }).value)
    expect(clipboard.writeText.mock.calls[0][0]).toContain('mode=compact')
    expect(toastMessages(toast.success)).toContain('Embed code copied')
  })

  it('selects the code for copying by hand when the clipboard is refused', async () => {
    clipboard = stubClipboard({ fail: true })
    open({ kind: 'audio', id: 'my-audio' })
    await user.click(screen.getByRole('button', { name: /copy embed code/i }))
    const code = screen.getByRole('textbox', { name: 'Embed code' })
    expect(code).toHaveFocus()
    expect(code.selectionStart).toBe(0)
    expect(code.selectionEnd).toBe(code.value.length)
    expect(toastMessages(toast.info)).toContain('Press Ctrl/Cmd + C to copy the selected code')
  })

  it('closes from its X and from a click on the backdrop, not from a click inside', async () => {
    open({ kind: 'audio', id: 'my-audio' })
    await user.click(screen.getByRole('textbox', { name: 'Embed code' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    open({ kind: 'audio', id: 'my-audio' })
    await user.click(screen.getByRole('dialog').parentElement)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('starts on the default size again every time it opens', async () => {
    open({ kind: 'audio', id: 'my-audio' })
    await user.click(screen.getByRole('button', { name: 'Minimal' }))
    await user.click(screen.getByRole('button', { name: 'Close' }))
    open({ kind: 'audio', id: 'my-audio' })
    expect(screen.getByRole('button', { name: 'With title' })).toHaveAttribute('aria-pressed', 'true')
  })

  // BUG: the dialog has no keyboard way out. It listens for no Escape key, so a
  // keyboard or screen reader user has to tab to the X (EmbedCodeModal.jsx:67-118).
  it('BUG: closes on Escape like every other dialog', async () => {
    open({ kind: 'audio', id: 'my-audio' })
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('the embed dialog for a playlist', () => {
  it('offers the playlist heights and a snippet that plays every track', async () => {
    open({ kind: 'playlist', id: 'pl-42', title: 'Daily Voice' })
    const dialog = screen.getByRole('dialog', { name: 'Embed this playlist' })
    expect(within(dialog).getByText(/plays every audio track of the playlist/i)).toBeInTheDocument()
    const sizes = within(within(dialog).getByRole('group', { name: 'Embed size' })).getAllByRole('button')
    expect(sizes.map((b) => b.textContent)).toEqual(['480 px', '360 px', '640 px'])
    const code = within(dialog).getByRole('textbox', { name: 'Embed code' })
    expect(code.value).toContain('play?list=pl-42&iframe=1')
    expect(code.value).toContain('height="480"')

    await user.click(within(dialog).getByRole('button', { name: '640 px' }))
    expect(code.value).toContain('height="640"')
    expect(code.value).toContain('title="Daily Voice"')
  })
})
