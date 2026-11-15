// The feedback popup (components/ReviewModal): a screenshot can ride along with
// the global feedback, picked from a file or pasted. It is shrunk in the browser
// (utils/shrinkScreenshot, mocked here) and sent as a data URL with the review.
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from './_render.jsx'

const post = vi.hoisted(() => vi.fn())
vi.mock('axios', async (importOriginal) => {
  const real = await importOriginal()
  return { ...real, default: { ...real.default, post } }
})
const success = vi.hoisted(() => vi.fn())
const error = vi.hoisted(() => vi.fn())
vi.mock('../../../src/utils/toast', () => ({ toastIn: () => ({ success, error }) }))
const shrinkScreenshot = vi.hoisted(() => vi.fn())
vi.mock('../../../src/utils/shrinkScreenshot', () => ({ shrinkScreenshot }))

const { default: ReviewModal } = await import('../../../src/components/ReviewModal/ReviewModal.jsx')

const SHOT = 'data:image/jpeg;base64,/9j/AAAA'
const png = () => new File(['x'], 'shot.png', { type: 'image/png' })
const fileInput = () => document.getElementById('review-shot')

async function rateAndSend(user) {
  await user.click(screen.getByRole('button', { name: '4 stars' }))
  await user.click(screen.getByRole('button', { name: /Send feedback/ }))
}

describe('Feedback popup: screenshot', () => {
  beforeEach(() => {
    post.mockReset().mockResolvedValue({ data: { ok: true } })
    shrinkScreenshot.mockReset().mockResolvedValue(SHOT)
  })

  it('a picked file is shown, and sent with the review', async () => {
    const onClose = vi.fn()
    const { user } = renderWithProviders(<ReviewModal area="global" onClose={onClose} />)
    expect(screen.getByRole('button', { name: /Attach a screenshot/ })).toBeInTheDocument()
    expect(screen.getByText('Only the 3Speak team sees it. You can also paste an image here.')).toBeInTheDocument()

    const file = png()
    await user.upload(fileInput(), file)
    expect(shrinkScreenshot).toHaveBeenCalledWith(file)
    expect(await screen.findByRole('img', { name: 'Your screenshot' })).toHaveAttribute('src', SHOT)

    await rateAndSend(user)
    await waitFor(() => expect(post).toHaveBeenCalled())
    expect(post.mock.calls[0][1]).toMatchObject({ area: 'global', stars: 4, screenshot: SHOT })
    expect(onClose).toHaveBeenCalled()
  })

  it('without one, no screenshot field is sent', async () => {
    const { user } = renderWithProviders(<ReviewModal area="global" onClose={() => {}} />)
    await rateAndSend(user)
    await waitFor(() => expect(post).toHaveBeenCalled())
    expect(post.mock.calls[0][1]).not.toHaveProperty('screenshot')
  })

  it('the remove button takes it off again', async () => {
    const { user } = renderWithProviders(<ReviewModal area="global" onClose={() => {}} />)
    await user.upload(fileInput(), png())
    await user.click(await screen.findByRole('button', { name: 'Remove screenshot' }))
    expect(screen.queryByRole('img', { name: 'Your screenshot' })).not.toBeInTheDocument()
    await rateAndSend(user)
    await waitFor(() => expect(post).toHaveBeenCalled())
    expect(post.mock.calls[0][1]).not.toHaveProperty('screenshot')
  })

  it('a pasted image becomes the screenshot; pasted text is left alone', async () => {
    renderWithProviders(<ReviewModal area="global" onClose={() => {}} />)
    const note = screen.getByRole('textbox')
    const file = png()

    fireEvent.paste(note, { clipboardData: { items: [{ kind: 'string', type: 'text/plain', getAsFile: () => null }] } })
    expect(shrinkScreenshot).not.toHaveBeenCalled()

    fireEvent.paste(note, { clipboardData: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }] } })
    expect(shrinkScreenshot).toHaveBeenCalledWith(file)
    expect(await screen.findByRole('img', { name: 'Your screenshot' })).toBeInTheDocument()
  })

  it.each([
    ['tooBig', 'That image is too large. Please try a smaller one.'],
    ['unreadable', 'That file is not an image we can read.'],
  ])('a %s file says so and attaches nothing', async (code, message) => {
    shrinkScreenshot.mockRejectedValue(Object.assign(new Error(code), { code }))
    const { user } = renderWithProviders(<ReviewModal area="global" onClose={() => {}} />)
    await user.upload(fileInput(), png())
    await waitFor(() => expect(error).toHaveBeenCalledWith(message))
    expect(screen.queryByRole('img', { name: 'Your screenshot' })).not.toBeInTheDocument()
  })

  it('is offered on the global feedback only, unless asked for', () => {
    const { unmount } = renderWithProviders(<ReviewModal area="upload" onClose={() => {}} />)
    expect(screen.queryByRole('button', { name: /Attach a screenshot/ })).not.toBeInTheDocument()
    unmount()
    renderWithProviders(<ReviewModal area="stream" allowScreenshot onClose={() => {}} />)
    expect(screen.getByRole('button', { name: /Attach a screenshot/ })).toBeInTheDocument()
  })
})
