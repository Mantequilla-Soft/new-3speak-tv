// The offline notice (components/OfflineBanner): nothing online; offline it
// says the downloads still play, and links to them unless you are on them.
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import React from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import '../../../src/i18n'

let items = []
vi.mock('../../../src/lib/podcastDownloads', () => ({ useDownloads: () => ({ items }) }))
let online = true
vi.mock('../../../src/hooks/useOnline', () => ({ default: () => online }))

const render = async (path) => {
  const { default: OfflineBanner } = await import('../../../src/components/OfflineBanner/OfflineBanner.jsx')
  return renderToString(<MemoryRouter initialEntries={[path]}><OfflineBanner /></MemoryRouter>)
}

afterEach(() => { items = []; online = true })

describe('the offline notice', () => {
  it('is not there online', async () => {
    expect(await render('/')).toBe('')
  })

  it('offline, says the downloads still play and links to them', async () => {
    online = false
    items = [{ id: 'a' }]
    const html = await render('/feeds')
    expect(html).toContain('Your downloads still play')
    expect(html).toContain('Open downloads')
  })

  it('has no link while you are on them', async () => {
    online = false
    items = [{ id: 'a' }]
    expect(await render('/audio?view=mine')).not.toContain('Open downloads')
    expect(await render('/audio?view=discover')).toContain('Open downloads')
  })

  it('without downloads, says how to listen offline', async () => {
    online = false
    expect(await render('/')).toContain('Download episodes to listen without a connection')
  })
})
