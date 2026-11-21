// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import OwnWalletRoute from '../../../src/components/Wallet/OwnWalletRoute'
import { useAppStore } from '../../../src/lib/store'

// Shows where the router ended up, query and hash included.
function Where() {
  const { pathname, search, hash } = useLocation()
  return <div data-testid="where">{`${pathname}${search}${hash}`}</div>
}

function renderAt(url, openLoginModal = vi.fn()) {
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/wallet" element={<OwnWalletRoute openLoginModal={openLoginModal} />} />
        <Route path="/wallet/:user" element={<Where />} />
      </Routes>
    </MemoryRouter>
  )
  return openLoginModal
}

describe('OwnWalletRoute (/wallet with no name)', () => {
  beforeEach(() => {
    useAppStore.setState({ user: null, incubationHandle: null })
  })

  it("sends a signed-in user to their own wallet, keeping the #pro hash and the query", () => {
    useAppStore.setState({ user: 'badadib' })
    const openLogin = renderAt('/wallet?tab=activity#pro')
    expect(screen.getByTestId('where').textContent).toBe('/wallet/badadib?tab=activity#pro')
    expect(openLogin).not.toHaveBeenCalled()
  })

  it('opens the login once when signed out, and offers it again on the page', () => {
    const openLogin = renderAt('/wallet#pro')
    expect(openLogin).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Please log in first')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /Log in/ }))
    expect(openLogin).toHaveBeenCalledTimes(2)
  })

  it('goes on to the wallet by itself once a Hive account signs in', () => {
    renderAt('/wallet#pro')
    act(() => useAppStore.setState({ user: 'badadib' }))
    expect(screen.getByTestId('where').textContent).toBe('/wallet/badadib#pro')
  })

  it('an incubating account (no Hive wallet yet) is asked to log in, not sent anywhere', () => {
    useAppStore.setState({ user: null, incubationHandle: 'newbie' })
    const openLogin = renderAt('/wallet')
    expect(openLogin).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('where')).toBeNull()
  })
})
