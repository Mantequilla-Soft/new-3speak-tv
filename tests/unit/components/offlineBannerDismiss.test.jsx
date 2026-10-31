// The offline notice goes once "Open downloads" was used, and comes back the
// next time the connection drops.
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import '../../../src/i18n'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
vi.mock('../../../src/lib/podcastDownloads', () => ({ useDownloads: () => ({ items: [{ id: 'a' }] }) }))
vi.mock('../../../src/lib/store', () => ({ useAppStore: (sel) => sel({ audioIsPlaying: false }) }))
let online = false
vi.mock('../../../src/hooks/useOnline', () => ({ default: () => online }))

describe('dismissing the offline notice', () => {
  it('hides after Open downloads, until the next time offline', async () => {
    const { default: OfflineBanner } = await import('../../../src/components/OfflineBanner/OfflineBanner.jsx')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const draw = () => act(() => { root.render(<MemoryRouter initialEntries={['/feeds']}><OfflineBanner /></MemoryRouter>) })
    draw()
    expect(host.querySelector('.offline-banner')).toBeTruthy()
    act(() => { host.querySelector('.offline-banner-link').click() })
    expect(host.querySelector('.offline-banner')).toBeNull()
    online = true; draw()
    online = false; draw()
    expect(host.querySelector('.offline-banner')).toBeTruthy()
    act(() => root.unmount())
  })
})
