// The upload rule (components/OriginalContentNotice): original content only,
// copyrighted material must decline its payout. Owner 2026-11-12.
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from './_render.jsx'
import OriginalContentNotice from '../../../src/components/OriginalContentNotice/OriginalContentNotice.jsx'

describe('Original content notice', () => {
  it('states the rule and both ways to follow it', () => {
    renderWithProviders(<OriginalContentNotice />)
    expect(screen.getByText('Only upload content you made.')).toBeInTheDocument()
    expect(screen.getByText(/Copyrighted material must not earn rewards/)).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('sets the payout to declined from its button', async () => {
    const onDecline = vi.fn()
    const { user } = renderWithProviders(<OriginalContentNotice onDecline={onDecline} />)
    await user.click(screen.getByRole('button', { name: /Decline payout/ }))
    expect(onDecline).toHaveBeenCalledTimes(1)
  })

  it('shows the payout as declined once it is', () => {
    renderWithProviders(<OriginalContentNotice onDecline={() => {}} declined />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('Payout declined')).toBeInTheDocument()
  })
})
