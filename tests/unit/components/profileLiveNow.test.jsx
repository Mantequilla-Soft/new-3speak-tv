// @vitest-environment jsdom
// A host's live stream on their profile (components/Userprofilepage/ProfileStreams):
// shown to every visitor, also for the hosts the feeds leave out (badadib,
// ashenadib, owner 2026-11-19).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from './_render.jsx'

const endpoints = vi.hoisted(() => ({ fetchAllEndpoints: vi.fn() }))
vi.mock('../../../src/utils/hangoutsEndpoints', async (orig) => ({ ...(await orig()), fetchAllEndpoints: endpoints.fetchAllEndpoints }))
const { useAppStore } = await import('../../../src/lib/store')
const { ProfileLiveNow } = await import('../../../src/components/Userprofilepage/ProfileStreams.jsx')

beforeEach(() => {
  endpoints.fetchAllEndpoints.mockResolvedValue([
    { name: 'badadib-live1', host: 'badadib', title: 'just a test', live: true },
    { name: 'someone-else', host: 'meno', title: 'other', live: true },
  ])
})

describe('Live now on a profile', () => {
  it('shows badadib\'s stream to another viewer, and only badadib\'s', async () => {
    useAppStore.setState({ user: 'tibfox', authenticated: true })
    renderWithProviders(<ProfileLiveNow user="badadib" />)
    expect(await screen.findByText('just a test')).toBeTruthy()
    expect(screen.getByRole('link', { name: /just a test/ }).getAttribute('href')).toBe('/watch/badadib-live1')
    expect(screen.queryByText('other')).toBeNull()
  })

  it('to a visitor who is not logged in too', async () => {
    useAppStore.setState({ user: null, authenticated: false })
    renderWithProviders(<ProfileLiveNow user="badadib" />)
    expect(await screen.findByText('Live now')).toBeTruthy()
  })
})
