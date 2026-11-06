// The HiveAuth "approve on your phone" overlay (src/context/HiveAuthContext.jsx):
// the provider hands its show/hide callbacks to the wallet helper, shows a modal
// while a signature is pending, takes them back on unmount, and the hook refuses
// to work outside it. Also the AppProviders passthrough (src/context/Providers.jsx).
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, renderHook, act } from '@testing-library/react'

const aioha = vi.hoisted(() => ({ setHiveAuthCallbacks: vi.fn() }))
vi.mock('../../../src/hive-api/aioha', () => aioha)
vi.mock('react-i18next', () => {
  const t = (key) => key
  return { useTranslation: () => ({ t }) }
})

const { HiveAuthProvider, useHiveAuth } = await import('../../../src/context/HiveAuthContext.jsx')
const { AppProviders } = await import('../../../src/context/Providers.jsx')

const wrapper = ({ children }) => <HiveAuthProvider>{children}</HiveAuthProvider>

beforeEach(() => { aioha.setHiveAuthCallbacks.mockClear() })

describe('the waiting overlay', () => {
  it('is hidden until a signature is pending', () => {
    render(<HiveAuthProvider><p>page</p></HiveAuthProvider>)
    expect(screen.getByText('page')).toBeInTheDocument()
    expect(screen.queryByText('misc.hiveAuth.title')).not.toBeInTheDocument()
  })

  it('shows the given message while waiting and disappears when hidden', () => {
    const { result } = renderHook(() => useHiveAuth(), { wrapper })
    act(() => result.current.showWaiting('Approve the vote in HiveAuth'))
    expect(result.current.isWaiting).toBe(true)
    expect(screen.getByText('misc.hiveAuth.title')).toBeInTheDocument()
    expect(screen.getByText('Approve the vote in HiveAuth')).toBeInTheDocument()
    expect(screen.getByText('misc.hiveAuth.hint')).toBeInTheDocument()

    act(() => result.current.hideWaiting())
    expect(result.current).toMatchObject({ isWaiting: false, waitingMessage: '' })
    expect(screen.queryByText('misc.hiveAuth.title')).not.toBeInTheDocument()
  })

  it('falls back to the generic waiting text when no message is given', () => {
    const { result } = renderHook(() => useHiveAuth(), { wrapper })
    act(() => result.current.showWaiting())
    expect(result.current.waitingMessage).toBe('misc.hiveAuth.waiting')
  })
})

describe('the wallet helper callbacks', () => {
  it('are registered on mount, so aioha can open and close the overlay itself', () => {
    const { result } = renderHook(() => useHiveAuth(), { wrapper })
    expect(aioha.setHiveAuthCallbacks).toHaveBeenCalledTimes(1)
    const [onWaiting, onComplete] = aioha.setHiveAuthCallbacks.mock.calls[0]
    act(() => onWaiting('Sign in HiveAuth'))
    expect(result.current.waitingMessage).toBe('Sign in HiveAuth')
    act(() => onComplete())
    expect(result.current.isWaiting).toBe(false)
  })

  it('are cleared on unmount, so nothing calls into a dead tree', () => {
    const { unmount } = render(<HiveAuthProvider />)
    unmount()
    expect(aioha.setHiveAuthCallbacks).toHaveBeenLastCalledWith(null, null)
  })
})

describe('useHiveAuth', () => {
  it('outside the provider is a programming error', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => renderHook(() => useHiveAuth())).toThrow('useHiveAuth must be used within a HiveAuthProvider')
  })
})

describe('AppProviders', () => {
  it('renders its children unchanged', () => {
    render(<AppProviders><span>inside</span></AppProviders>)
    expect(screen.getByText('inside')).toBeInTheDocument()
  })
})
