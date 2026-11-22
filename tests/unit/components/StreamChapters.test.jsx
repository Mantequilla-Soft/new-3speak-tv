// @vitest-environment jsdom
// Chapters from a stream's highlights on the host's own VOD
// (components/openpods/StreamChapters): only for the host, filled into the edit dialog.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from './_render.jsx'

vi.mock('../../../src/context/HangoutContext', () => ({ useHangout: () => ({ sessionToken: 'tok' }) }))
vi.mock('../../../src/utils/hangoutsEndpoints', () => ({ findRoomEndpoint: async () => ({ api: 'https://live.3speak.tv' }) }))

const { default: StreamChapters } = await import('../../../src/components/openpods/StreamChapters.jsx')

let answer
beforeEach(() => {
  answer = { host: 'badadib', isHost: true, moments: [{ offsetSec: 600, reasons: ['chat'] }, { offsetSec: 1500, reasons: ['big_boost'] }], clips: [] }
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => answer })))
})
afterEach(() => vi.unstubAllGlobals())

describe('StreamChapters', () => {
  it('lists the chapters and hands them over on Use as chapters', async () => {
    const onUse = vi.fn()
    const { user } = renderWithProviders(<StreamChapters room="badadib-r1" duration={3600} onUse={onUse} />)
    expect(await screen.findByText('Chapters from your stream')).toBeInTheDocument()
    expect(screen.getByText('Chat lit up')).toBeInTheDocument()
    expect(screen.getByText('24:15')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Use as chapters/ }))
    expect(onUse).toHaveBeenCalledWith([{ start: 0, title: 'Start' }, { start: 555, title: 'Chat lit up' }, { start: 1455, title: 'Big boost' }])
  })

  it('nothing for someone who is not the host', async () => {
    answer = { ...answer, isHost: false, moments: [] }
    const { container } = renderWithProviders(<StreamChapters room="badadib-r1" duration={3600} onUse={() => {}} />)
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(container.querySelector('.stream-chapters')).toBeNull()
  })
})
