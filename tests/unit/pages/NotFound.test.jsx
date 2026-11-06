// @vitest-environment jsdom
// The 404 page (page/NotFound.jsx). Unknown URLs answer 200 (the server cannot
// tell them from Hive-style links), so the page itself tells search engines not
// to index it, and offers the way back home.
import { describe, it, expect } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '../components/_render.jsx'

const { default: NotFound } = await import('../../../src/page/NotFound.jsx')

describe('the page-not-found page', () => {
  it('says the page does not exist', () => {
    renderWithProviders(<NotFound />, { route: '/no/such/page' })
    expect(screen.getByRole('img', { name: '404' })).toBeInTheDocument()
    expect(screen.getByText('SORRY! PAGE NOT FOUND')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Unfortunately, the page you are looking for is not available.' })).toBeInTheDocument()
  })

  it('asks search engines not to index it', async () => {
    renderWithProviders(<NotFound />, { route: '/no/such/page' })
    await waitFor(() => expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute('content', 'noindex'))
  })

  it('takes the visitor back to the home page', async () => {
    const { user } = renderWithProviders(<NotFound />, { route: '/no/such/page' })
    await user.click(screen.getByRole('button', { name: 'GO TO HOME PAGE' }))
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/)
  })

  // BUG: "Go to home page" is a <button> inside a <Link> (NotFound.jsx:22-24):
  // two nested interactive controls, which HTML does not allow. Keyboard users
  // tab through two stops for one action and screen readers announce both.
  it('BUG: the way home is a single control', () => {
    renderWithProviders(<NotFound />, { route: '/no/such/page' })
    const controls = [...screen.queryAllByRole('link'), ...screen.queryAllByRole('button')]
      .filter((el) => /home page/i.test(el.textContent))
    expect(controls).toHaveLength(1)
  })
})
