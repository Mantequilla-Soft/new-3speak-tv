// The shared dialog hook (src/hooks/useDialog.js): role, aria-modal and a name
// from the header title, and Escape closing only the newest open dialog.
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import useDialog from '../../../src/hooks/useDialog'

function Box({ title, onClose, active, children }) {
  const dialog = useDialog(onClose, { active })
  return (
    <div {...dialog.props}>
      <h2 id={dialog.titleId}>{title}</h2>
      {children}
    </div>
  )
}

describe('useDialog', () => {
  it('names the dialog after its title and closes it on Escape', async () => {
    const onClose = vi.fn()
    render(<Box title="Report Video" onClose={onClose} />)
    expect(screen.getByRole('dialog', { name: 'Report Video' })).toHaveAttribute('aria-modal', 'true')
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes only the newest of two open dialogs, then the one under it', async () => {
    const outer = vi.fn()
    const inner = vi.fn()
    const { rerender } = render(<Box title="Outer" onClose={outer}><Box title="Inner" onClose={inner} /></Box>)
    await userEvent.keyboard('{Escape}')
    expect(inner).toHaveBeenCalledTimes(1)
    expect(outer).not.toHaveBeenCalled()
    rerender(<Box title="Outer" onClose={outer} />)
    await userEvent.keyboard('{Escape}')
    expect(outer).toHaveBeenCalledTimes(1)
  })

  it('leaves Escape alone while inactive, already handled, or with nothing to close', async () => {
    const onClose = vi.fn()
    const { rerender } = render(<Box title="Hidden" onClose={onClose} active={false} />)
    await userEvent.keyboard('{Escape}')
    expect(onClose).not.toHaveBeenCalled()

    rerender(<Box title="Shown" onClose={onClose}><input aria-label="field" onKeyDown={(e) => e.preventDefault()} /></Box>)
    await userEvent.click(screen.getByLabelText('field'))
    await userEvent.keyboard('{Escape}')
    expect(onClose).not.toHaveBeenCalled()

    rerender(<Box title="Forced" />)
    await userEvent.keyboard('{Escape}')
    expect(screen.getByRole('dialog', { name: 'Forced' })).toBeInTheDocument()
  })
})
