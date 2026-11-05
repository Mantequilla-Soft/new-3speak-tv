// The signed-in user's profile (src/hooks/getUserDetails.js, useGetMyQuery): read
// from Hive for the account in localStorage, in the `{ profile }` shape the old
// GraphQL query had; nothing is fetched for a logged-out visitor.
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createElement } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const profiles = vi.hoisted(() => ({ fetch: null }))
vi.mock('../../../src/lib/videoData', () => ({ fetchHiveProfile: (...a) => profiles.fetch(...a) }))

const { useGetMyQuery } = await import('../../../src/hooks/getUserDetails.js')

const mount = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }) => createElement(QueryClientProvider, { client }, children)
  return renderHook(() => useGetMyQuery(), { wrapper })
}

beforeEach(() => {
  localStorage.clear()
  profiles.fetch = vi.fn(async (user) => ({ name: user, metadata: { profile: { name: 'Alice' } } }))
})

describe('useGetMyQuery', () => {
  it('loads the stored account\'s Hive profile as { profile }', async () => {
    localStorage.setItem('user_id', 'alice')
    const { result } = mount()
    expect(result.current).toBeUndefined()
    await waitFor(() => expect(result.current).toEqual({ profile: { name: 'alice', metadata: { profile: { name: 'Alice' } } } }))
    expect(profiles.fetch).toHaveBeenCalledWith('alice')
  })

  it('fetches nothing for a logged-out visitor', async () => {
    const { result } = mount()
    await new Promise((r) => setTimeout(r, 0))
    expect(result.current).toBeUndefined()
    expect(profiles.fetch).not.toHaveBeenCalled()
  })

  it('a failed lookup leaves no profile', async () => {
    localStorage.setItem('user_id', 'alice')
    profiles.fetch.mockRejectedValue(new Error('timeout'))
    const { result } = mount()
    await waitFor(() => expect(profiles.fetch).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 0))
    expect(result.current).toBeUndefined()
  })
})
