// @vitest-environment jsdom
// "Continue where I left off": lib/lastPage.js remembers the page and, before the
// router mounts, sends an app opened on Home there (resumeOnStart);
// components/ResumeLastPage records each page while the setting is on;
// components/RouteFallback shows a spinner while the resumed page loads.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route, Link } from 'react-router-dom'
import ResumeLastPage from '../../../src/components/ResumeLastPage'
import RouteFallback, { fallbackShowing } from '../../../src/components/RouteFallback'
import { useAppStore } from '../../../src/lib/store'
import {
  readLastPage, rememberablePath, saveLastPage, resumeOnStart, isResuming, endResume, markNotFound,
} from '../../../src/lib/lastPage'

const setting = (on) => localStorage.setItem('user-store', JSON.stringify({ version: 5, state: { resumeLastPage: on } }))

beforeEach(() => {
  localStorage.clear()
  endResume()
  window.history.replaceState(null, '', '/')
  useAppStore.setState({ resumeLastPage: false })
})
afterEach(() => { vi.useRealTimers() })

describe('lib/lastPage', () => {
  it('never comes back to /settings (it only opens the Settings dialog over Home)', () => {
    expect(rememberablePath({ pathname: '/settings' })).toBeNull()
    expect(rememberablePath({ pathname: '/settingsx' })).toBe('/settingsx')
  })

  it('forgets a page that showed the 404 and never saves it again (issue #579)', () => {
    saveLastPage({ pathname: '/no-such-page' })
    expect(readLastPage()).toBe('/no-such-page')
    expect(markNotFound({ pathname: '/no-such-page' })).toBe(false)
    expect(readLastPage()).toBeNull()
    saveLastPage({ pathname: '/no-such-page', search: '?x=1' })
    expect(readLastPage()).toBeNull()
    saveLastPage({ pathname: '/@badadib/videos' })
    expect(readLastPage()).toBe('/@badadib/videos')
  })

  it('says when the 404 is the page the visit was resumed to, so it can go Home', () => {
    setting(true)
    localStorage.setItem('last-page', '/gone-page?tab=x')
    expect(resumeOnStart(window)).toBe('/gone-page?tab=x')
    saveLastPage({ pathname: '/gone-page', search: '?tab=x' })
    expect(markNotFound({ pathname: '/gone-page', search: '?tab=x' })).toBe(true)
    expect(readLastPage()).toBeNull()
    // Only once: a later 404 in the same visit is just a 404.
    expect(markNotFound({ pathname: '/gone-page', search: '?tab=x' })).toBe(false)
  })

  it('a 404 later in the visit is not the resumed page', () => {
    setting(true)
    localStorage.setItem('last-page', '/@badadib/videos')
    resumeOnStart(window)
    saveLastPage({ pathname: '/@badadib/videos' })
    saveLastPage({ pathname: '/typo-page' })
    expect(markNotFound({ pathname: '/typo-page' })).toBe(false)
  })

  it('remembers path, query and hash, but not sign-in, embeds or upload steps', () => {
    expect(rememberablePath({ pathname: '/watch', search: '?v=badadib/abc', hash: '#c' })).toBe('/watch?v=badadib/abc#c')
    for (const p of ['/login', '/auth/callback', '/callback', '/embed/badadib/abc', '/studio/details', '/invite/x', '//evil.example']) {
      expect(rememberablePath({ pathname: p })).toBeNull()
    }
  })

  it('does not come back to an upload or to publishing a stream recording (their state is in memory)', () => {
    for (const p of ['/upload', '/upload/details', '/openpods/publish']) {
      expect(rememberablePath({ pathname: p, search: '?room=x' })).toBeNull()
    }
    expect(rememberablePath({ pathname: '/openpods' })).toBe('/openpods')
    expect(rememberablePath({ pathname: '/uploads-guide' })).toBe('/uploads-guide')
  })

  it('does not come back to a live stream, watching or hosting, and keeps the page before it', () => {
    for (const p of ['/watch/badadib-svfcoyx', '/l/badadib-svfcoyx', '/openpods/badadib-svfcoyx']) {
      expect(rememberablePath({ pathname: p })).toBeNull()
    }
    // A video's watch page and the live hubs are still remembered.
    expect(rememberablePath({ pathname: '/watch', search: '?v=badadib/abc' })).toBe('/watch?v=badadib/abc')
    expect(rememberablePath({ pathname: '/live' })).toBe('/live')
    saveLastPage({ pathname: '/@badadib/videos' })
    saveLastPage({ pathname: '/watch/badadib-svfcoyx' })
    expect(readLastPage()).toBe('/@badadib/videos')
  })

  it('treats Home, a skipped page or blocked storage as nothing to resume', () => {
    expect(readLastPage()).toBeNull()
    saveLastPage({ pathname: '/' })
    expect(readLastPage()).toBeNull()
    localStorage.setItem('last-page', '/login?next=x')
    expect(readLastPage()).toBeNull()
    saveLastPage({ pathname: '/p/badadib', search: '' })
    expect(readLastPage()).toBe('/p/badadib')
  })
})

describe('resumeOnStart (before the router mounts)', () => {
  it('opened on Home with the setting on: stands on the saved page, Home behind it', () => {
    setting(true)
    localStorage.setItem('last-page', '/t/music')
    const before = window.history.length
    expect(resumeOnStart()).toBe('/t/music')
    expect(window.location.pathname).toBe('/t/music')
    expect(window.history.length).toBe(before + 1)
    expect(isResuming()).toBe(true)
  })

  it('stays on Home when the browser refuses the jump, instead of throwing before React starts', () => {
    setting(true)
    localStorage.setItem('last-page', '/t/music')
    const win = {
      location: { pathname: '/', search: '', hash: '' },
      history: { pushState: vi.fn(() => { throw new Error('SecurityError') }) },
    }
    expect(() => resumeOnStart(win)).not.toThrow()
    expect(resumeOnStart(win)).toBeNull()
    expect(isResuming()).toBe(false)
  })

  it('does nothing with the setting off, nothing saved, or a link the app was opened with', () => {
    setting(false)
    localStorage.setItem('last-page', '/t/music')
    expect(resumeOnStart()).toBeNull()

    setting(true)
    window.history.replaceState(null, '', '/?ref=x')
    expect(resumeOnStart()).toBeNull()
    window.history.replaceState(null, '', '/watch?v=badadib/abc')
    expect(resumeOnStart()).toBeNull()

    window.history.replaceState(null, '', '/')
    localStorage.removeItem('last-page')
    expect(resumeOnStart()).toBeNull()
    expect(window.location.pathname).toBe('/')
    expect(isResuming()).toBe(false)
  })
})

describe('ResumeLastPage', () => {
  function app(at) {
    return render(
      <MemoryRouter initialEntries={[at]}>
        <ResumeLastPage />
        <Routes><Route path="*" element={<Link to="/t/music">music</Link>} /></Routes>
      </MemoryRouter>,
    )
  }

  it('does nothing while off and forgets a page saved before', () => {
    localStorage.setItem('last-page', '/p/badadib')
    app('/')
    expect(localStorage.getItem('last-page')).toBeNull()
  })

  it('while on, saves every page', async () => {
    useAppStore.setState({ resumeLastPage: true })
    app('/p/badadib')
    expect(localStorage.getItem('last-page')).toBe('/p/badadib')
    await act(async () => { screen.getByText('music').click() })
    expect(localStorage.getItem('last-page')).toBe('/t/music')
  })

  it('ends the resume when the page rendered without a route fallback', () => {
    setting(true)
    localStorage.setItem('last-page', '/t/music')
    resumeOnStart()
    app('/t/music')
    expect(isResuming()).toBe(false)
  })
})

describe('RouteFallback', () => {
  it('a page still loading shows a spinner, and the Powered by Hive footer hides meanwhile', async () => {
    render(<RouteFallback />)
    expect(screen.getByRole('status', { name: /Loading/ })).toHaveClass('route-loading')
    const { readFileSync } = await import('node:fs')
    const css = readFileSync(`${process.cwd()}/src/App.css`, 'utf8')
    expect(css).toMatch(/body:has\(\.route-suspense-fallback\) \.site-hive-footer \{\s*display: none;/)
  })

  it('a spinner over the shell while the resumed page loads, then never again', () => {
    vi.useFakeTimers()
    setting(true)
    localStorage.setItem('last-page', '/t/music')
    resumeOnStart()
    const { unmount } = render(<RouteFallback />)
    expect(fallbackShowing()).toBe(true)
    expect(screen.getByRole('status', { name: /Loading/ })).toBeInTheDocument()
    unmount()
    act(() => { vi.advanceTimersByTime(100) })
    expect(isResuming()).toBe(false)

    // Afterwards only the plain loading spinner, not the veil.
    render(<RouteFallback />)
    expect(screen.getByRole('status', { name: /Loading/ })).toHaveClass('route-loading')
    expect(document.querySelector('.route-resume-veil')).toBeNull()
  })
})
