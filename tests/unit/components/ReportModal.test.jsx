// @vitest-environment jsdom
// Reporting a video, comment or account (components/modal/ReportModal.jsx): the
// reasons fit what is reported, a reason is required, a signed-in member sends
// it with optional details, and the browser remembers what it already reported.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, screen, waitFor, within } from '@testing-library/react'
import { renderWithProviders, toastMessages } from './_render.jsx'

vi.mock('sonner', async () => (await import('./_render.jsx')).sonnerModule())
vi.mock('../../../src/hive-api/aioha', async () => (await import('./_render.jsx')).aiohaModule())
vi.mock('../../../src/utils/config', async (importOriginal) => ({
  ...(await importOriginal()),
  REPORT_API_URL: 'https://reports.example',
  REPORT_API_SECRET: 'test-report-key',
}))

const { toast } = await import('sonner')
const { useAppStore } = await import('../../../src/lib/store')
const { default: ReportModal, isReported } = await import('../../../src/components/modal/ReportModal.jsx')

let fetchMock
function mount(props = {}) {
  const onClose = vi.fn()
  const r = renderWithProviders(
    <ReportModal isOpen onClose={onClose} type="video" target={{ author: 'badadib', permlink: 'lake-day' }} {...props} />,
  )
  return { ...r, onClose }
}
// The reasons are radio tiles (design 07c/43b) in a group named "Reason".
const reasonGroup = () => screen.getByRole('radiogroup', { name: 'Reason' })
const reasonNames = () => within(reasonGroup()).getAllByRole('radio').map((o) => o.textContent)
const pick = (user, name) => user.click(within(reasonGroup()).getByRole('radio', { name }))
const submit = () => screen.getByRole('button', { name: 'Submit Report' })

beforeEach(() => {
  fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }))
  vi.stubGlobal('fetch', fetchMock)
  useAppStore.setState({ user: 'listener' })
})
afterEach(() => localStorage.clear())

describe('the report window', () => {
  it('renders nothing while closed', () => {
    mount({ isOpen: false })
    expect(screen.queryByRole('heading', { name: /Report/ })).not.toBeInTheDocument()
  })

  it('names what is reported and offers the video reasons', () => {
    mount()
    expect(screen.getByRole('heading', { name: 'Report Video' })).toBeInTheDocument()
    expect(screen.getByText('@badadib / lake-day')).toBeInTheDocument()
    expect(reasonNames()).toEqual(['Spam or misleading', 'Harassment or bullying', 'Hate speech', 'Violent or graphic content', 'Sexual content', 'Copyright infringement', 'Scam or fraud', 'Other'])
  })

  it.each([
    ['comment', 'Report Comment', ['Spam', 'Harassment or bullying', 'Hate speech', 'Impersonation', 'Other']],
    ['user', 'Report User', ['Spam account', 'Harassment or bullying', 'Hate speech', 'Impersonation', 'Scam or fraud', 'Other']],
  ])('a %s gets its own title and reasons', (type, title, reasons) => {
    mount({ type })
    expect(screen.getByRole('heading', { name: title })).toBeInTheDocument()
    expect(reasonNames()).toEqual(reasons)
  })

  it('cannot be sent without a reason', () => {
    mount()
    expect(submit()).toBeDisabled()
  })

  it('sends the report with its details, remembers it, confirms and closes', async () => {
    const { user, onClose } = mount()
    await pick(user, 'Copyright infringement')
    await user.type(screen.getByPlaceholderText('Provide more context...'), '  My song, used without asking  ')
    await user.click(submit())
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://reports.example/report')
    expect(init.method).toBe('POST')
    expect(init.headers['X-Api-Secret']).toBe('test-report-key')
    expect(JSON.parse(init.body)).toEqual({ object_id: 'badadib/lake-day', object_type: 'post', reason: 'copyright', comment: 'My song, used without asking' })
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(toastMessages(toast.success)).toContain('Report submitted. Thank you.')
    expect(isReported('post', 'badadib/lake-day')).toBe(true)
  })

  it('reports an account by its name alone, without empty details', async () => {
    const { user } = mount({ type: 'user', target: { author: 'badadib' } })
    expect(screen.getByText('@badadib')).toBeInTheDocument()
    await pick(user, 'Impersonation')
    await user.click(submit())
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ object_id: 'badadib', object_type: 'user', reason: 'impersonation' })
    await waitFor(() => expect(isReported('user', 'badadib')).toBe(true))
  })

  it('asks a visitor to log in instead of sending anything', async () => {
    act(() => useAppStore.setState({ user: null }))
    const { user, onClose } = mount()
    await pick(user, 'Spam or misleading')
    await user.click(submit())
    expect(toastMessages(toast.error)).toEqual(['You must be logged in to report'])
    expect(fetchMock).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('stays open and says so when the report is refused', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({ error: 'Too many reports' }) })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { user, onClose } = mount()
    await pick(user, 'Spam or misleading')
    await user.click(submit())
    await waitFor(() => expect(toastMessages(toast.error)).toEqual(['Failed to submit report']))
    expect(onClose).not.toHaveBeenCalled()
    expect(isReported('post', 'badadib/lake-day')).toBe(false)
    expect(submit()).toBeEnabled()
  })

  it('says "Submitting..." while the report is on its way', async () => {
    let finish
    fetchMock.mockReturnValueOnce(new Promise((r) => { finish = r }))
    const { user } = mount()
    await pick(user, 'Spam or misleading')
    await user.click(submit())
    expect(screen.getByRole('button', { name: 'Submitting...' })).toBeDisabled()
    await act(async () => finish({ ok: true, json: async () => ({}) }))
  })

  it('closing forgets the half-filled form', async () => {
    const { user, onClose } = mount()
    await pick(user, 'Spam or misleading')
    expect(within(reasonGroup()).getByRole('radio', { name: 'Spam or misleading' })).toHaveAttribute('aria-checked', 'true')
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(within(reasonGroup()).getAllByRole('radio').filter((r) => r.getAttribute('aria-checked') === 'true')).toEqual([])
  })

  it('closes from a click on the backdrop, not from one inside', async () => {
    const { user, onClose } = mount()
    await user.click(screen.getByRole('heading', { name: 'Report Video' }))
    expect(onClose).not.toHaveBeenCalled()
    await user.click(document.querySelector('.report-modal-overlay'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  // BUG: "Reason" and "Additional details" are bare <label>s with no htmlFor
  // (ReportModal.jsx:156 and :168), so the select and the text box have no
  // accessible name; and the window is a plain <div> overlay with no
  // role="dialog" and no Escape key (:145-146).
  it('BUG: the fields are labelled and the window is a dialog Escape closes', async () => {
    const { user, onClose } = mount()
    expect(reasonGroup()).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Additional details (optional)' })).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Report Video' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })
})

describe('isReported', () => {
  it('reads what this browser reported before', () => {
    localStorage.setItem('reported_comment_badadib/c1', '1')
    expect(isReported('comment', 'badadib/c1')).toBe(true)
    expect(isReported('comment', 'badadib/c2')).toBe(false)
  })
})
