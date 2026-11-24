// @vitest-environment jsdom
// Every upload paused (lib/uploadsPaused.jsx, VITE_UPLOADS_PAUSED): a way into an
// upload shows the "Uploads are paused" popup with the Discord link instead, and
// an upload page opened by its URL goes to Home.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { Routes, Route } from 'react-router-dom'
import { renderWithProviders } from './_render.jsx'

const m = vi.hoisted(() => ({ paused: true }))
vi.mock('../../../src/utils/config', async (importOriginal) => ({
  ...(await importOriginal()),
  get UPLOADS_PAUSED() { return m.paused },
}))

const { useSupportBlock } = await import('../../../src/lib/supportBlockStore')
const { blockIfUploadsPaused, uploadRoute } = await import('../../../src/lib/uploadsPaused.jsx')
const { default: SupportModal } = await import('../../../src/components/SupportModal/SupportModal.jsx')

beforeEach(() => {
  m.paused = true
  useSupportBlock.getState().hideSupportBlock()
})

describe('uploads paused', () => {
  it('stops an upload and says why, with the Discord link', async () => {
    expect(blockIfUploadsPaused()).toBe(true)
    renderWithProviders(<SupportModal />)
    expect(await screen.findByRole('dialog', { name: 'Uploads are paused' })).toBeInTheDocument()
    expect(screen.getByText(/Check our Discord for updates/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Discord/ })).toHaveAttribute('href', expect.stringContaining('discord.com/invite/'))
  })

  it('lets uploads through when not paused', () => {
    m.paused = false
    expect(blockIfUploadsPaused()).toBe(false)
    expect(useSupportBlock.getState().block).toBeNull()
  })

  it('sends an upload page opened by its URL to Home', async () => {
    renderWithProviders(
      <>
        <Routes>
          <Route path="/" element={<p>home</p>} />
          <Route path="/embed-studio" element={uploadRoute(<p>studio</p>)} />
        </Routes>
        <SupportModal />
      </>,
      { route: '/embed-studio' },
    )
    expect(await screen.findByText('home')).toBeInTheDocument()
    expect(screen.queryByText('studio')).not.toBeInTheDocument()
    expect(await screen.findByRole('dialog', { name: 'Uploads are paused' })).toBeInTheDocument()
  })
})
