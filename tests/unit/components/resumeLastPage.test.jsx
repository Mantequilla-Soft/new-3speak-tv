// @vitest-environment jsdom
// "Continue where I left off" (components/ResumeLastPage.jsx + lib/lastPage.js):
// remembers the page while the setting is on and opens the app there again.
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route, Link, useLocation } from 'react-router-dom'
import ResumeLastPage from '../../../src/components/ResumeLastPage'
import { useAppStore } from '../../../src/lib/store'
import { readLastPage, rememberablePath, saveLastPage } from '../../../src/lib/lastPage'

function Where() {
  const loc = useLocation()
  return <p data-testid="where">{`${loc.pathname}${loc.search}${loc.hash}`}</p>
}

function openApp(at = '/') {
  return render(
    <MemoryRouter initialEntries={[at]}>
      <ResumeLastPage />
      <Where />
      <Routes>
        <Route path="*" element={<Link to="/t/music">music</Link>} />
      </Routes>
    </MemoryRouter>,
  )
}
const where = () => screen.getByTestId('where').textContent

beforeEach(() => {
  localStorage.clear()
  useAppStore.setState({ resumeLastPage: false })
})

describe('lib/lastPage', () => {
  it('remembers path, query and hash, but not sign-in, embeds or upload steps', () => {
    expect(rememberablePath({ pathname: '/watch', search: '?v=badadib/abc', hash: '#c' })).toBe('/watch?v=badadib/abc#c')
    for (const p of ['/login', '/auth/callback', '/callback', '/embed/badadib/abc', '/studio/details', '/invite/x', '//evil.example']) {
      expect(rememberablePath({ pathname: p })).toBeNull()
    }
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

describe('ResumeLastPage', () => {
  it('does nothing while off and forgets a page saved before', () => {
    localStorage.setItem('last-page', '/p/badadib')
    openApp('/')
    expect(where()).toBe('/')
    expect(localStorage.getItem('last-page')).toBeNull()
  })

  it('while on, saves every page and opens the app on the last one', async () => {
    useAppStore.setState({ resumeLastPage: true })
    const first = openApp('/p/badadib')
    expect(localStorage.getItem('last-page')).toBe('/p/badadib')
    await act(async () => { screen.getByText('music').click() })
    expect(localStorage.getItem('last-page')).toBe('/t/music')
    first.unmount()

    openApp('/')
    expect(where()).toBe('/t/music')
  })

  it('a link the app is opened with wins over the saved page', () => {
    useAppStore.setState({ resumeLastPage: true })
    localStorage.setItem('last-page', '/t/music')
    openApp('/watch?v=badadib/abc')
    expect(where()).toBe('/watch?v=badadib/abc')
    expect(localStorage.getItem('last-page')).toBe('/watch?v=badadib/abc')
  })

  it('with nothing saved yet, the app stays on Home', () => {
    useAppStore.setState({ resumeLastPage: true })
    openApp('/')
    expect(where()).toBe('/')
  })
})
