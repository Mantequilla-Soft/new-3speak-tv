// @vitest-environment jsdom
// ModalHeader closes its window on Escape (src/components/ModalHeader/ModalHeader.jsx),
// unless closeOnEscape={false} or it sits inside a useDialog box, which owns the key.
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ModalHeader from '../../../src/components/ModalHeader/ModalHeader.jsx'
import useDialog from '../../../src/hooks/useDialog.js'

function DialogBox({ onClose, children }) {
  const dialog = useDialog(onClose)
  return <div {...dialog.props}><ModalHeader title="Box" titleId={dialog.titleId} onClose={onClose} />{children}</div>
}

describe('ModalHeader and Escape', () => {
  it('Escape runs onClose, the same as the X', async () => {
    const onClose = vi.fn()
    render(<div><ModalHeader title="Tip" onClose={onClose} /><input aria-label="Amount" /></div>)
    await userEvent.click(screen.getByLabelText('Amount'))
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('leaves Escape alone with closeOnEscape={false} or without onClose', async () => {
    const onClose = vi.fn()
    render(<><ModalHeader title="Editor" onClose={onClose} closeOnEscape={false} /><ModalHeader title="Prompt" /></>)
    await userEvent.keyboard('{Escape}')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('inside a useDialog box, the box closes once (the header does not close it a second time)', async () => {
    const onClose = vi.fn()
    render(<DialogBox onClose={onClose} />)
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes only the topmost window: a header window opened over another', async () => {
    const under = vi.fn()
    const over = vi.fn()
    render(<><div><ModalHeader title="Under" onClose={under} /></div><div><ModalHeader title="Over" onClose={over} /></div></>)
    await userEvent.keyboard('{Escape}')
    expect(over).toHaveBeenCalledTimes(1)
    expect(under).not.toHaveBeenCalled()
  })

  it('a header window over a useDialog box closes first, then the box', async () => {
    const box = vi.fn()
    const over = vi.fn()
    const { rerender } = render(<><DialogBox onClose={box} /><div><ModalHeader title="Over" onClose={over} /></div></>)
    await userEvent.keyboard('{Escape}')
    expect(over).toHaveBeenCalledTimes(1)
    expect(box).not.toHaveBeenCalled()
    rerender(<DialogBox onClose={box} />)
    await userEvent.keyboard('{Escape}')
    expect(box).toHaveBeenCalledTimes(1)
  })
})
