// The one editor (components/common/Composer): every comment box and post field.
// Compact for comments with a button to the full editor (formatting toolbar),
// Ctrl+Enter posts, and a poll goes out as json_metadata fields for the host to
// spread into the comment. The toolbar's markdown edits are pure (format.js).
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useState } from 'react'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from './_render.jsx'

vi.mock('../../../src/lib/hiveRenderer', () => ({
  getHiveRenderer: async () => (md) => `<p>${md}</p>`,
  getPostBodyRenderer: async () => (md) => `<p>${md}</p>`,
}))
const error = vi.hoisted(() => vi.fn())
vi.mock('../../../src/utils/toast', () => ({ toastIn: () => ({ success: vi.fn(), error }) }))

const { useAppStore } = await import('../../../src/lib/store')
const { default: Composer } = await import('../../../src/components/common/Composer/Composer.jsx')
const { wrap, prefixLine, insertAt, link } = await import('../../../src/components/common/Composer/format.js')
const { countWords } = await import('../../../src/components/common/FocusWriter/focusWriterTools.js')

function Harness({ onSubmit, ...props }) {
  const [value, setValue] = useState('')
  return <Composer value={value} onChange={setValue} placeholder="Write" onSubmit={onSubmit} {...props} />
}

beforeEach(() => {
  error.mockReset()
  useAppStore.setState({ user: 'badadib', incubationHandle: null })
})

describe('format (the toolbar edits)', () => {
  it('wraps the selection, or puts the marks at the caret', () => {
    expect(wrap('a big cat', 2, 5, '**')).toEqual({ text: 'a **big** cat', caret: 9 })
    expect(wrap('ab', 1, 1, '<u>', '</u>')).toEqual({ text: 'a<u></u>b', caret: 4 })
  })
  it('starts the caret line with a prefix', () => {
    expect(prefixLine('one\ntwo', 5, '# ')).toEqual({ text: 'one\n# two', caret: 7 })
    expect(prefixLine('\nx', 0, '- ')).toEqual({ text: '- \nx', caret: 2 })
  })
  it('inserts and links', () => {
    expect(insertAt('ab', 1, 1, 'X')).toEqual({ text: 'aXb', caret: 2 })
    expect(link('see here', 4, 8, 'https://3speak.tv', 'link text').text).toBe('see [here](https://3speak.tv)')
    expect(link('', 0, 0, 'https://3speak.tv', 'link text').text).toBe('[link text](https://3speak.tv)')
  })
  it('counts words for focus mode', () => {
    expect(countWords('')).toBe(0)
    expect(countWords(' a  b\nc ')).toBe(3)
  })
})

describe('compact editor', () => {
  it('Ctrl+Enter posts the text with no extra metadata', async () => {
    const onSubmit = vi.fn().mockResolvedValue(true)
    const { user } = renderWithProviders(<Harness onSubmit={onSubmit} />)
    await user.type(screen.getByPlaceholderText('Write'), 'Nice video')
    await user.keyboard('{Control>}{Enter}{/Control}')
    expect(onSubmit).toHaveBeenCalledWith({ text: 'Nice video', meta: {} })
  })

  it('a poll goes out as our block plus the open-protocol fields, then closes', async () => {
    const onSubmit = vi.fn().mockResolvedValue(true)
    const { user } = renderWithProviders(<Harness onSubmit={onSubmit} polls />)
    await user.type(screen.getByPlaceholderText('Write'), 'Which one?')
    await user.click(screen.getByRole('button', { name: 'Add a poll' }))
    await user.type(screen.getByLabelText('Option 1'), 'Music')
    await user.type(screen.getByLabelText('Option 2'), 'Code')
    await user.click(screen.getByRole('button', { name: /Comment/ }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    const { meta } = onSubmit.mock.calls[0][0]
    expect(meta.poll.options).toEqual(['Music', 'Code'])
    expect(meta).toMatchObject({ content_type: 'poll', question: 'Which one?', choices: ['Music', 'Code'] })
    await waitFor(() => expect(screen.queryByLabelText('Option 1')).not.toBeInTheDocument())
  })

  it('an unfinished poll is refused and nothing is posted', async () => {
    const onSubmit = vi.fn()
    const { user } = renderWithProviders(<Harness onSubmit={onSubmit} polls />)
    await user.type(screen.getByPlaceholderText('Write'), 'Which one?')
    await user.click(screen.getByRole('button', { name: 'Add a poll' }))
    await user.type(screen.getByLabelText('Option 1'), 'Music')
    await user.click(screen.getByRole('button', { name: /Comment/ }))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalled()
  })

  it('a warm-up account gets no poll button', () => {
    useAppStore.setState({ user: null, incubationHandle: 'newbie' })
    renderWithProviders(<Harness onSubmit={vi.fn()} polls />)
    expect(screen.queryByRole('button', { name: 'Add a poll' })).not.toBeInTheDocument()
  })

  it('the full-editor button brings the formatting toolbar, and Bold wraps the selection', async () => {
    const { user } = renderWithProviders(<Harness onSubmit={vi.fn()} />)
    await user.type(screen.getByPlaceholderText('Write'), 'big')
    await user.click(screen.getByRole('button', { name: 'Full editor' }))
    expect(screen.getByRole('toolbar', { name: 'Formatting' })).toBeInTheDocument()
    const box = screen.getByPlaceholderText('Write')
    box.setSelectionRange(0, 3)
    await user.click(screen.getByRole('button', { name: /Bold/ }))
    await waitFor(() => expect(box).toHaveValue('**big**'))
    box.setSelectionRange(0, 7)
    await user.keyboard('{Control>}i{/Control}')
    await waitFor(() => expect(box).toHaveValue('***big***'))
    await user.click(screen.getByRole('button', { name: 'Compact editor' }))
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument()
  })
})

describe('full editor (post fields)', () => {
  it('opens with the toolbar and has no way back to compact', () => {
    renderWithProviders(<Harness mode="full" expandable={false} />)
    expect(screen.getByRole('toolbar', { name: 'Formatting' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Compact editor' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Focus mode' })).toBeInTheDocument()
  })
})

describe('Split View', () => {
  const widthOf = (w) => vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: w, height: 300, top: 0, left: 0, right: w, bottom: 300, x: 0, y: 0 })
  beforeEach(() => { window.innerWidth = 1000 })

  it('is offered when the editor spans at least 30% of the window', () => {
    const spy = widthOf(400)
    renderWithProviders(<Harness mode="full" expandable={false} />)
    expect(screen.getByRole('button', { name: 'Split View' })).toBeInTheDocument()
    spy.mockRestore()
  })

  it('is not offered in a narrow box: Editor Only and Preview Only', () => {
    const spy = widthOf(250)
    renderWithProviders(<Harness mode="full" expandable={false} />)
    expect(screen.queryByRole('button', { name: 'Split View' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Editor Only' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Preview Only' })).toBeInTheDocument()
    spy.mockRestore()
  })
})
