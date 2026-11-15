// @vitest-environment jsdom
// A verified podcast feed in the linked profiles list (AddSocialLink_modal) has a
// button straight to its episodes in the importer; other platforms do not.
import { describe, it, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from './_render.jsx'

vi.mock('sonner', async () => (await import('./_render.jsx')).sonnerModule())
vi.mock('../../../src/hive-api/aioha', async () => (await import('./_render.jsx')).aiohaModule())
vi.mock('../../../src/utils/config', async (importOriginal) => ({ ...(await importOriginal()), VIDEO_IMPORT_ENABLED: true }))
vi.mock('../../../src/utils/socialVerifier', async (importOriginal) => ({
  ...(await importOriginal()),
  getHash: vi.fn(async () => '084f0bc86786a3b8378e2c0b3cb01aec'),
  getLinks: vi.fn(async () => [
    { platform: 'rss', platform_username: 'https://testfeed.okinoko.io/feed.xml', verified: true },
    { platform: 'tiktok', platform_username: 'someone', verified: true },
  ]),
}))

const { default: AddSocialLink } = await import('../../../src/components/modal/AddSocialLink_modal.jsx')

describe('linked podcast feed', () => {
  it('links to the Podcast tab of the importer and lets Settings close', async () => {
    const onNavigate = vi.fn()
    const { user } = renderWithProviders(<AddSocialLink isOpen inline hiveUsername="badadib" onClose={() => {}} onNavigate={onNavigate} />)
    const btn = await screen.findByRole('link', { name: 'Import episodes' })
    expect(btn).toHaveAttribute('href', '/import?platform=rss')
    expect(screen.getAllByRole('link', { name: 'Import episodes' })).toHaveLength(1)
    await user.click(btn)
    expect(onNavigate).toHaveBeenCalled()
  })
})
