// "Add a collaborator" on the upload details (embed-studio/CollabModal): Hive
// suggestions while typing, the split with its preview, and a name that is not
// a Hive account, or the creator, is refused. Hive is a stand-in.
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from './_render.jsx'

const h = vi.hoisted(() => ({ lookup: vi.fn(), valid: vi.fn() }))
vi.mock('../../../src/utils/hiveNode', async (orig) => ({ ...(await orig()), getHiveClient: () => ({ call: h.lookup }) }))
vi.mock('../../../src/hive-api/api', () => ({ isAccountValid: h.valid }))

const { default: CollabModal } = await import('../../../src/components/embed-studio/CollabModal.jsx')

beforeEach(() => {
  h.lookup.mockReset().mockResolvedValue(['fan', 'fanatic'])
  h.valid.mockReset().mockResolvedValue(true)
})

describe('collab modal', () => {
  it('picks a suggested account and a 25 % split', async () => {
    const onSave = vi.fn()
    const onClose = vi.fn()
    const { user } = renderWithProviders(<CollabModal open onClose={onClose} onSave={onSave} user="badadib" creatorPercent={89} />)
    await user.type(screen.getByLabelText('Co-creator'), 'fa')
    await user.click(await screen.findByRole('button', { name: '@fanatic' }))
    await user.click(screen.getByRole('tab', { name: '25%' }))
    expect(screen.getByText('@fanatic gets 22.25% of the payout, you keep 66.75%.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ account: 'fanatic', split: 25 }))
    expect(onClose).toHaveBeenCalled()
  })

  it('a picked account closes the list and shows its avatar; Edit brings the field back', async () => {
    const { user } = renderWithProviders(<CollabModal open onClose={vi.fn()} onSave={vi.fn()} user="badadib" />)
    await user.type(screen.getByLabelText('Co-creator'), 'fa')
    await user.click(await screen.findByRole('button', { name: '@fanatic' }))
    expect(screen.queryByRole('list', { name: /suggest/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '@fan' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Co-creator')).not.toBeInTheDocument()
    expect(screen.getByText('@fanatic')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.getByLabelText('Co-creator')).toHaveValue('fanatic')
  })

  it('asks Hive for 20 matches, keeps only names starting with the text, and offers the exact one too', async () => {
    h.lookup.mockResolvedValue(['fan', 'fanatic', 'fbx'])
    const { user } = renderWithProviders(<CollabModal open onClose={vi.fn()} onSave={vi.fn()} user="badadib" />)
    await user.type(screen.getByLabelText('Co-creator'), 'fan')
    expect(await screen.findByRole('button', { name: '@fan' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '@fanatic' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '@fbx' })).not.toBeInTheDocument()
    expect(h.lookup).toHaveBeenLastCalledWith('condenser_api', 'lookup_accounts', ['fan', 20])
  })

  it('refuses the creator and an unknown account', async () => {
    const onSave = vi.fn()
    const { user } = renderWithProviders(<CollabModal open onClose={vi.fn()} onSave={onSave} user="badadib" />)
    await user.type(screen.getByLabelText('Co-creator'), 'badadib')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('You cannot collaborate with yourself.')).toBeInTheDocument()
    await user.clear(screen.getByLabelText('Co-creator'))
    h.valid.mockResolvedValue(false)
    await user.type(screen.getByLabelText('Co-creator'), 'nobody')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('@nobody is not a Hive account.')).toBeInTheDocument()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('Remove clears a saved collaborator', async () => {
    const onSave = vi.fn()
    const { user } = renderWithProviders(<CollabModal open onClose={vi.fn()} onSave={onSave} value={{ account: 'fan', split: 50 }} user="badadib" />)
    await user.click(screen.getByRole('button', { name: 'Remove' }))
    expect(onSave).toHaveBeenCalledWith(null)
  })
})
