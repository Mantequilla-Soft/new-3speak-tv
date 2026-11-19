// @vitest-environment jsdom
// The stream template editor (components/openpods/StreamTemplates.jsx): four
// tabs over one form (Details, Audience, Boosts, Recording), nothing typed is
// lost between them, and the Boosts tab sets the template's boost goal.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { renderWithProviders, stubMatchMedia } from './_render.jsx'

const TPL = {
  id: 't1', name: 'Morning show', slug: 'morning-show', title: 'Live from the garden', description: '', thumbnail: '', tags: [],
  language: 'en', visibility: 'public',
  boost: { enabled: true, minBoostUsd: 0.5, creatorPayoutAccount: 'badadib', goal: { title: 'coffee', targetHbd: 5, position: 'top-right' } },
  recording: { publishVod: true, allowClips: false }, announce: { enabled: false, community: 'hive-181335', beneficiaries: [] },
}
const api = vi.hoisted(() => ({ updateTemplate: vi.fn(), listTemplates: vi.fn() }))
vi.mock('../../../src/utils/streamTemplates', async (orig) => ({
  ...(await orig()),
  listTemplates: api.listTemplates,
  updateTemplate: api.updateTemplate,
  getTemplateStatus: vi.fn(async () => ({ state: 'idle' })),
}))
vi.mock('../../../src/components/studio/MarkdownComposer', () => ({ default: ({ value, onChange }) => <textarea aria-label="description" value={value} onChange={(e) => onChange(e.target.value)} /> }))
vi.mock('../../../src/components/openpods/AnnounceOptions', () => ({ default: () => <div data-testid="announce-options" /> }))
vi.mock('../../../src/utils/postingAuthority', () => ({ hasThreespeakPostingAuth: vi.fn(async () => true), addThreespeakToPostingAuth: vi.fn(), waitForThreespeakPostingAuth: vi.fn() }))

const { StreamTemplatesPanel } = await import('../../../src/components/openpods/StreamTemplates.jsx')

beforeEach(() => {
  stubMatchMedia(false)
  api.listTemplates.mockResolvedValue({ templates: [TPL], whipBase: 'https://live.example/whip', chatOverlayKey: 'k' })
  api.updateTemplate.mockImplementation(async (token, id, input) => ({ template: { ...TPL, ...input } }))
})

async function openEditor() {
  renderWithProviders(<StreamTemplatesPanel token="tok" user="badadib" isPremium />)
  fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
  return screen.findByRole('tab', { name: 'Details' })
}

describe('the template editor', () => {
  it('has four tabs, and what was typed on one survives a trip to another', async () => {
    await openEditor()
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Details', 'Audience', 'Boosts', 'Recording'])
    const title = screen.getByDisplayValue('Live from the garden')
    fireEvent.change(title, { target: { value: 'Evening show' } })
    fireEvent.click(screen.getByRole('tab', { name: 'Audience' }))
    expect(screen.getByRole('radiogroup', { name: 'Who can find it?' })).toBeVisible()
    fireEvent.click(screen.getByRole('tab', { name: 'Details' }))
    expect(screen.getByDisplayValue('Evening show')).toBeTruthy()
  })

  it('sets the boost goal on the Boosts tab and saves it', async () => {
    await openEditor()
    fireEvent.click(screen.getByRole('tab', { name: 'Boosts' }))
    expect(screen.getByDisplayValue('coffee')).toBeTruthy()
    fireEvent.change(screen.getByDisplayValue('5'), { target: { value: '12.5' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Where viewers see it' }), { target: { value: 'bottom-left' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api.updateTemplate).toHaveBeenCalled())
    expect(api.updateTemplate.mock.calls[0][2].boost.goal).toEqual({ title: 'coffee', targetHbd: 12.5, position: 'bottom-left' })
  })

  it('a missing title sends you back to Details', async () => {
    await openEditor()
    fireEvent.change(screen.getByDisplayValue('Live from the garden'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('tab', { name: 'Recording' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Details' }).getAttribute('aria-selected')).toBe('true'))
    expect(api.updateTemplate).not.toHaveBeenCalled()
  })
})
