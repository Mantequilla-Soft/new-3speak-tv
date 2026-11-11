// @vitest-environment jsdom
// The "what's new" popup (components/Changelog/ChangelogModal.jsx). It opens for
// someone who upgraded (store.appUpdatedFrom) with every entry newer than the
// version they had, grouped by the part of 3Speak it changes. Closing it records
// the version as seen. A landing page (/advertise) holds it back until they leave.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, screen, within } from '@testing-library/react'
import { useNavigate } from 'react-router-dom'
import { renderWithProviders } from './_render.jsx'

vi.mock('../../../src/hive-api/aioha', async () => (await import('./_render.jsx')).aiohaModule())
vi.mock('../../../src/version', () => ({ APP_VERSION: '2.1.0' }))
// A fixed changelog, so the test does not change every time an entry is added.
vi.mock('../../../src/changelog', () => {
  const CHANGELOG = [
    { version: '2.1.0', category: 'audio', date: '2026-11-04', summary: 'Audio queue remembers its order.' },
    { version: '2.0.10', category: 'mystery', summary: 'An entry with an unknown category.' },
    { version: '2.0.9', category: 'audio', date: '2026-11-03', summary: 'Sleep timer fades out.' },
    { version: '2.0.8', category: 'shorts', date: '2026-10-22', summary: 'Shorts show when they were posted.' },
    { version: '2.0.6', category: 'tips', date: '2026-10-01', summary: 'Lightning tips.' },
    { version: '2.0.5', category: 'chat', date: '2026-09-30', summary: 'Chat reactions.' },
    { version: '2.0.4', category: 'watch', date: '2026-09-29', summary: 'Theatre mode.' },
    { version: '2.0.3', category: 'home', date: '2026-09-28', summary: 'Card sizes.' },
  ]
  const cmp = (a, b) => {
    const pa = a.split('.').map(Number); const pb = b.split('.').map(Number)
    for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] > pb[i] ? 1 : -1
    return 0
  }
  const changelogSince = (v) => (v ? CHANGELOG.filter((e) => cmp(e.version, v) > 0) : [])
  const known = ['audio', 'shorts', 'tips', 'chat', 'watch', 'home', 'general']
  const groupChangelog = (entries) => {
    const groups = new Map()
    for (const e of entries) {
      const key = known.includes(e.category) ? e.category : 'general'
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(e)
    }
    return [...groups].map(([category, list]) => ({ category, entries: list }))
  }
  return { CHANGELOG, changelogSince, groupChangelog, CHANGELOG_CATEGORIES: known }
})

const { useAppStore } = await import('../../../src/lib/store')
const { default: ChangelogModal } = await import('../../../src/components/Changelog/ChangelogModal.jsx')
const { APP_VERSION_STORAGE_KEY } = await import('../../../src/utils/appVersion')

function GoHome() {
  const navigate = useNavigate()
  return <button type="button" onClick={() => navigate('/')}>Leave landing page</button>
}

function show(from, opts) {
  act(() => useAppStore.setState({ appUpdatedFrom: from }))
  return renderWithProviders(<><ChangelogModal /><GoHome /></>, opts)
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-05T12:00:00Z'))
  localStorage.setItem(APP_VERSION_STORAGE_KEY, '2.0.8')
  useAppStore.setState({ appUpdatedFrom: null, theme: 'light' })
})
afterEach(() => {
  vi.useRealTimers()
  localStorage.clear()
  document.body.style.overflow = ''
})

describe("the what's new popup", () => {
  it('stays closed for someone who did not upgrade', () => {
    show(null)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows only the changes newer than the version they had, under the current version', () => {
    show('2.0.8')
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('heading', { name: 'We shipped an update!' })).toBeInTheDocument()
    expect(within(dialog).getByText("Here's what's new in v2.1.0")).toBeInTheDocument()
    expect(within(dialog).getByText('Audio queue remembers its order.')).toBeInTheDocument()
    expect(within(dialog).getByText('Sleep timer fades out.')).toBeInTheDocument()
    expect(within(dialog).getByText('An entry with an unknown category.')).toBeInTheDocument()
    expect(within(dialog).queryByText('Shorts show when they were posted.')).not.toBeInTheDocument()
  })

  it('groups the changes by area, newest area first, with a count per group', () => {
    show('2.0.8')
    const heads = screen.getAllByRole('button', { expanded: true })
    // The text a reader sees: the Material Symbols glyphs are ligature text.
    const visible = (b) => [...b.querySelectorAll('.changelog-group-name, .changelog-group-count')].map((el) => el.textContent).join('')
    expect(heads.map(visible)).toEqual(['Audio2', 'All of 3Speak1'])
    const audio = screen.getByRole('button', { name: /^Audio/ })
    const panel = document.getElementById(audio.getAttribute('aria-controls'))
    expect(within(panel).getAllByText(/^v2\./).map((n) => n.textContent)).toEqual(['v2.1.0', 'v2.0.9'])
  })

  it('says how long ago each change shipped, and nothing for an undated one', () => {
    show('2.0.8')
    expect(screen.getByText('yesterday')).toBeInTheDocument()
    const undated = screen.getByText('An entry with an unknown category.').closest('.changelog-entry')
    expect(within(undated).getByText('v2.0.10')).toBeInTheDocument()
    expect(undated.querySelector('.changelog-entry-date')).toBeNull()
  })

  it('after a long absence opens only the newest group, and the others open on a click', async () => {
    const { user } = show('2.0.0')
    expect(screen.getByRole('button', { name: /^Audio/ })).toHaveAttribute('aria-expanded', 'true')
    const shorts = screen.getByRole('button', { name: /^Shorts/ })
    expect(shorts).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Shorts show when they were posted.')).not.toBeInTheDocument()

    await user.click(shorts)
    expect(shorts).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Shorts show when they were posted.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^Audio/ }))
    expect(screen.queryByText('Sleep timer fades out.')).not.toBeInTheDocument()
  })

  it('locks the page behind it and gives the scroll back once closed', async () => {
    const { user } = show('2.0.8')
    expect(document.body.style.overflow).toBe('hidden')
    await user.click(screen.getByRole('button', { name: 'Got it' }))
    expect(document.body.style.overflow).toBe('')
  })

  it.each([['Got it'], ['Close']])('"%s" closes it and records the version as seen', async (name) => {
    const { user } = show('2.0.8')
    await user.click(screen.getByRole('button', { name }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(localStorage.getItem(APP_VERSION_STORAGE_KEY)).toBe('2.1.0')
    expect(useAppStore.getState().appUpdatedFrom).toBeNull()
  })

  it('links to the source code in a new tab', () => {
    show('2.0.8')
    const link = screen.getByRole('link', { name: 'Read the code' })
    expect(link).toHaveAttribute('target', '_blank')
    expect(link.getAttribute('rel')).toContain('noopener')
  })

  it('shows the dark logo in the dark theme', () => {
    act(() => useAppStore.setState({ theme: 'dark' }))
    show('2.0.8')
    expect(screen.getByRole('img', { name: '3Speak' }).getAttribute('src')).toMatch(/3S_logodark/)
  })

  it('an upgrade without any entry for it just records the version, without a popup', () => {
    show('2.1.0')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(localStorage.getItem(APP_VERSION_STORAGE_KEY)).toBe('2.1.0')
    expect(useAppStore.getState().appUpdatedFrom).toBeNull()
  })

  it('waits on the /advertise landing page and appears once the visitor moves on', async () => {
    const { user } = show('2.0.8', { route: '/advertise/creators' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(document.body.style.overflow).toBe('')
    expect(localStorage.getItem(APP_VERSION_STORAGE_KEY)).toBe('2.0.8')

    await user.click(screen.getByRole('button', { name: 'Leave landing page' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  // BUG: the dialog is aria-modal but has no accessible name; the heading is not
  // tied to it with aria-labelledby (ChangelogModal.jsx:118).
  it('BUG: the dialog is named after its heading', () => {
    show('2.0.8')
    expect(screen.getByRole('dialog', { name: 'We shipped an update!' })).toBeInTheDocument()
  })

  // BUG: Escape does nothing; the popup covers the whole page and can only be
  // closed with the mouse or by tabbing to a button (ChangelogModal.jsx:116-171).
  it('BUG: closes on Escape and still records the version', async () => {
    const { user } = show('2.0.8')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(localStorage.getItem(APP_VERSION_STORAGE_KEY)).toBe('2.1.0')
  })
})
