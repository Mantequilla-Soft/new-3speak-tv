// @vitest-environment jsdom
// /automations (page/Automations.jsx) and its editor (components/Automations/AutomationEditor.jsx):
// the closed-beta gate, the list with its switches, deleting, and the editor's
// save and test buttons. The server is a stand-in (lib/automations), and so is
// the designer itself: jsdom cannot lay out its SVG, and it is not ours to test.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { createRequire } from 'node:module'
import { renderWithProviders } from '../components/_render.jsx'

vi.mock('../../../src/hive-api/aioha', async () => (await import('../components/_render.jsx')).aiohaModule())
vi.mock('../../../src/utils/postingAuthority', () => ({ addThreespeakToPostingAuth: vi.fn(async () => {}), waitForThreespeakPostingAuth: vi.fn(async () => true) }))
const api = {
  getAutomations: vi.fn(),
  createAutomation: vi.fn(),
  updateAutomation: vi.fn(),
  deleteAutomation: vi.fn(async () => ({ ok: true })),
  getAutomationRuns: vi.fn(async () => ({ runs: [] })),
  testAutomation: vi.fn(),
  skipProCheck: vi.fn(async () => ({ ok: true, proSkipped: true })),
  restoreProCheck: vi.fn(async () => ({ ok: true, proSkipped: false })),
}
vi.mock('../../../src/lib/automations', () => api)
vi.mock('sequential-workflow-designer-react', () => ({
  wrapDefinition: (value, isValid) => ({ value, isValid }),
  SequentialWorkflowDesigner: ({ definition }) => <div data-testid="designer" data-event={definition.value.properties.event} data-steps={definition.value.sequence.length} />,
  useRootEditor: () => ({}),
  useStepEditor: () => ({}),
}))
vi.mock('sequential-workflow-designer', () => ({ StepsDesignerExtension: { create: () => ({}) } }))

const { useAppStore } = await import('../../../src/lib/store')
const { default: Automations } = await import('../../../src/page/Automations.jsx')

const require = createRequire(import.meta.url)
const catalog = JSON.parse(JSON.stringify(require('../../../server/automation-catalog.cjs').publicCatalog()))
const snapStep = { id: 's1', componentType: 'task', type: 'post_snap', name: 'Post a snap', properties: { text: '{title} {url}', tags: [] } }
const wf = (id, name, enabled, extra = {}) => ({
  id, name, enabled, enabledAt: null, createdAt: '2026-11-19T10:00:00Z', updatedAt: '2026-11-19T10:00:00Z', lastRun: null, problem: null,
  definition: { properties: { event: 'video_published' }, sequence: [snapStep] }, ...extra,
})
const data = (over = {}) => ({ catalog, grant: true, intervalMin: 5, maxWorkflows: 10, workflows: [wf('aaaaaaaaaaaa', 'Share my videos', true), wf('bbbbbbbbbbbb', 'Episodes', false)], ...over })
const page = (route = '/automations') => renderWithProviders(<Automations />, { route, path: '/automations/:id?' })

beforeEach(() => {
  for (const f of Object.values(api)) f.mockClear()
  api.getAutomations.mockImplementation(async () => data())
  useAppStore.setState({ user: 'badadib', authenticated: true })
})

describe('the closed beta', () => {
  it('shows nothing of it to an account outside the beta, and never asks the server', async () => {
    useAppStore.setState({ user: 'someoneelse', authenticated: true })
    page()
    expect(await screen.findByText('Not available')).toBeTruthy()
    expect(api.getAutomations).not.toHaveBeenCalled()
  })

  it('offers Pro when the server says the account is not Pro', async () => {
    api.getAutomations.mockRejectedValueOnce(Object.assign(new Error('pro'), { status: 403, code: 'pro_required' }))
    page()
    expect(await screen.findByText('A 3Speak Pro feature')).toBeTruthy()
    expect(screen.getByRole('link', { name: /Get 3Speak Pro/ }).getAttribute('href')).toBe('/wallet/badadib#pro')
  })
})

describe('the Pro check for testers', () => {
  it('lets a tester without Pro skip it, and says so on the list with a way back', async () => {
    api.getAutomations.mockRejectedValueOnce(Object.assign(new Error('pro'), { status: 403, code: 'pro_required', canSkip: true }))
    api.getAutomations.mockImplementation(async () => data({ proSkipped: true }))
    page()
    fireEvent.click(await screen.findByRole('button', { name: 'Skip the Pro check (tester)' }))
    await waitFor(() => expect(api.skipProCheck).toHaveBeenCalled())
    expect(await screen.findByText(/Tester mode: the Pro check is skipped/)).toBeTruthy()
    expect(screen.getByText('Share my videos')).toBeTruthy()

    api.getAutomations.mockRejectedValueOnce(Object.assign(new Error('pro'), { status: 403, code: 'pro_required', canSkip: true }))
    fireEvent.click(screen.getByRole('button', { name: 'Use the Pro check again' }))
    await waitFor(() => expect(api.restoreProCheck).toHaveBeenCalled())
    expect(await screen.findByText('A 3Speak Pro feature')).toBeTruthy()
  })

  it('offers no skip when the server does not', async () => {
    api.getAutomations.mockRejectedValueOnce(Object.assign(new Error('pro'), { status: 403, code: 'pro_required', canSkip: false }))
    page()
    await screen.findByText('A 3Speak Pro feature')
    expect(screen.queryByRole('button', { name: /Skip the Pro check/ })).toBeNull()
  })
})

describe('the list', () => {
  it('shows each automation with its event, steps and switch', async () => {
    page()
    expect(await screen.findByText('Share my videos')).toBeTruthy()
    expect(screen.getAllByText('I publish a video')).toHaveLength(2)
    expect(screen.getAllByText('1 step')).toHaveLength(2)
    expect(screen.getAllByRole('switch').map((s) => s.getAttribute('aria-checked'))).toEqual(['true', 'false'])
  })

  it('switches one on through the server', async () => {
    api.updateAutomation.mockImplementation(async (id, body) => ({ workflow: wf(id, 'Episodes', body.enabled) }))
    page()
    await screen.findByText('Episodes')
    fireEvent.click(screen.getAllByRole('switch')[1])
    await waitFor(() => expect(api.updateAutomation).toHaveBeenCalledWith('bbbbbbbbbbbb', { enabled: true }))
    await waitFor(() => expect(screen.getAllByRole('switch')[1].getAttribute('aria-checked')).toBe('true'))
  })

  it('asks for the posting permission when 3Speak may not publish yet', async () => {
    api.getAutomations.mockImplementation(async () => data({ grant: false }))
    page()
    expect(await screen.findByText(/Allow 3Speak to publish on your account first/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Allow 3Speak to publish' })).toBeTruthy()
  })

  it('deletes after asking', async () => {
    page()
    await screen.findByText('Share my videos')
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0])
    expect(await screen.findByText('Delete "Share my videos"?')).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' }).at(-1))
    await waitFor(() => expect(api.deleteAutomation).toHaveBeenCalledWith('aaaaaaaaaaaa'))
    await waitFor(() => expect(screen.queryByText('Share my videos')).toBeNull())
  })

  it('has an empty state that leads to the starters', async () => {
    api.getAutomations.mockImplementation(async () => data({ workflows: [] }))
    page()
    expect(await screen.findByText('No automations yet')).toBeTruthy()
  })
})

describe('the editor', () => {
  it('starts a new automation from a starter and saves it', async () => {
    api.createAutomation.mockImplementation(async (body) => ({ workflow: { ...wf('cccccccccccc', body.name, false), definition: body.definition } }))
    page('/automations/new')
    fireEvent.click(await screen.findByRole('radio', { name: /Snap every new video/ }))
    const designer = await screen.findByTestId('designer')
    expect(designer.getAttribute('data-event')).toBe('video_published')
    expect(designer.getAttribute('data-steps')).toBe('1')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api.createAutomation).toHaveBeenCalled())
    expect(api.createAutomation.mock.calls[0][0]).toMatchObject({ name: 'Snap every new video', enabled: false, definition: { properties: { event: 'video_published' } } })
  })

  it('shows what the server refused, in words', async () => {
    api.updateAutomation.mockRejectedValueOnce(Object.assign(new Error('x'), { status: 400, code: 'task_not_for_event', stepId: 's1' }))
    page('/automations/aaaaaaaaaaaa')
    await screen.findByTestId('designer')
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Renamed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText(/a Short needs a video/)).toBeTruthy()
  })

  it('test-runs and shows what each step would do', async () => {
    api.testAutomation.mockResolvedValueOnce({
      sample: false, status: 'done', post: { author: 'badadib', permlink: 'cats', title: 'My cats', url: 'https://3speak.tv/watch?v=badadib/cats' },
      steps: { s1: { status: 'done', result: { would: 'post_snap', text: 'My cats https://3speak.tv/watch?v=badadib/cats' } } },
    })
    page('/automations/aaaaaaaaaaaa')
    await screen.findByTestId('designer')
    fireEvent.click(screen.getByRole('button', { name: 'Test' }))
    expect(await screen.findByText('Test run')).toBeTruthy()
    expect(screen.getByText('My cats https://3speak.tv/watch?v=badadib/cats')).toBeTruthy()
    expect(screen.getByText(/Nothing was posted/)).toBeTruthy()
    expect(api.testAutomation.mock.calls[0][0].sequence[0].id).toBe('s1')
  })

  it('offers the templates by group, also from inside the editor', async () => {
    page('/automations/new')
    expect(await screen.findByRole('radiogroup', { name: 'Tips, boosts and power ups' })).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: /Start empty/ }))
    const designer = await screen.findByTestId('designer')
    expect(designer.getAttribute('data-steps')).toBe('0')

    fireEvent.click(screen.getByRole('button', { name: 'Templates' }))
    fireEvent.click(await screen.findByRole('radio', { name: /Thank everyone who tips/ }))
    await waitFor(() => expect(screen.getByTestId('designer').getAttribute('data-event')).toBe('tip_received'))
    expect(screen.getByTestId('designer').getAttribute('data-steps')).toBe('1')
    // An unnamed automation takes the template's name.
    expect(screen.getByRole('textbox', { name: 'Name' }).value).toBe('Thank everyone who tips')
  })

  it('says when an automation is gone', async () => {
    page('/automations/zzzzzzzzzzzz')
    expect(await screen.findByText(/does not exist/)).toBeTruthy()
  })
})
