// @vitest-environment jsdom
// Settings → About → Hive RPC node (components/SettingsModal/HiveNodePicker):
// automatic, one of the known nodes, or the viewer's own; a node is checked
// before it is saved, then the page reloads.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from './_render.jsx'

const m = vi.hoisted(() => ({
  choice: null,
  checkNode: null,
  setNodeChoice: null,
}))
vi.mock('sonner', async () => (await import('./_render.jsx')).sonnerModule())
vi.mock('../../../src/utils/hiveNode', () => ({
  KNOWN_NODES: ['https://api.hive.blog', 'https://api.deathwing.me'],
  getHiveUrl: () => m.choice || 'https://api.hive.blog',
  getNodeChoice: () => m.choice,
  checkNode: (...a) => m.checkNode(...a),
  setNodeChoice: (...a) => m.setNodeChoice(...a),
}))

const { default: HiveNodePicker } = await import('../../../src/components/SettingsModal/HiveNodePicker.jsx')

const reload = vi.fn()
beforeEach(() => {
  m.choice = null
  m.checkNode = vi.fn(async (url) => ({ ok: url !== 'https://api.deathwing.me', ms: 120 }))
  m.setNodeChoice = vi.fn()
  reload.mockClear()
  Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, reload } })
})

async function openPicker(props = {}) {
  const r = renderWithProviders(<HiveNodePicker {...props} />)
  await r.user.click(screen.getByRole('button', { name: /Hive RPC node/ }))
  return r
}
const radio = (name) => screen.getByRole('radio', { name: new RegExp(name) })

describe('the node row', () => {
  it('shows the node in use and Auto, and passes taps on (the hidden unlock)', async () => {
    const onRowTap = vi.fn()
    await openPicker({ onRowTap })
    expect(screen.getByRole('button', { name: /Hive RPC node · Auto/ })).toHaveAttribute('aria-expanded', 'true')
    expect(onRowTap).toHaveBeenCalledTimes(1)
  })

  it('lists automatic and the known nodes with how fast each answered', async () => {
    await openPicker()
    expect(radio('Automatic')).toHaveAttribute('aria-checked', 'true')
    await waitFor(() => expect(radio('api.hive.blog')).toHaveTextContent('120 ms'))
    expect(radio('api.deathwing.me')).toHaveTextContent('Not answering')
  })
})

describe('choosing', () => {
  it('a known node that answers is saved and the page reloads', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { user } = await openPicker()
    await user.click(radio('api.hive.blog'))
    await waitFor(() => expect(m.setNodeChoice).toHaveBeenCalledWith('https://api.hive.blog'))
    vi.advanceTimersByTime(700)
    expect(reload).toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('a node that does not answer is refused', async () => {
    const { user } = await openPicker()
    await user.click(radio('api.deathwing.me'))
    expect(await screen.findByRole('alert')).toHaveTextContent(/did not answer/)
    expect(m.setNodeChoice).not.toHaveBeenCalled()
  })

  it('back to automatic from a picked node', async () => {
    m.choice = 'https://api.deathwing.me'
    const { user } = await openPicker()
    expect(screen.getByRole('button', { name: /Hive RPC node/ })).not.toHaveTextContent('Auto')
    expect(radio('api.deathwing.me')).toHaveAttribute('aria-checked', 'true')
    await user.click(radio('Automatic'))
    expect(m.setNodeChoice).toHaveBeenCalledWith(null)
  })

  it('their own node: must be https, is checked, then saved', async () => {
    const { user } = await openPicker()
    await user.click(radio('Your own node'))
    const input = screen.getByRole('textbox', { name: 'Your own node' })
    await user.clear(input)
    await user.type(input, 'http://node.example.com')
    await user.click(screen.getByRole('button', { name: 'Use' }))
    expect(screen.getByRole('alert')).toHaveTextContent('https://')
    expect(m.checkNode).not.toHaveBeenCalledWith('http://node.example.com')

    await user.clear(input)
    await user.type(input, 'https://node.example.com/')
    await user.click(screen.getByRole('button', { name: 'Use' }))
    await waitFor(() => expect(m.setNodeChoice).toHaveBeenCalledWith('https://node.example.com'))
    expect(m.checkNode).toHaveBeenCalledWith('https://node.example.com')
  })

  it('a saved own node shows as chosen, with its address filled in', async () => {
    m.choice = 'https://node.example.com'
    await openPicker()
    expect(radio('Your own node')).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('textbox', { name: 'Your own node' })).toHaveValue('https://node.example.com')
  })
})
