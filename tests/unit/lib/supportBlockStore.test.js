// The "contact support" block modal's state (src/lib/supportBlockStore.js):
// shown with a reason for a banned creator or a refused upload, then hidden.
import { describe, it, expect } from 'vitest'
import { useSupportBlock } from '../../../src/lib/supportBlockStore.js'

describe('useSupportBlock', () => {
  it('shows with its reason and hides again', () => {
    expect(useSupportBlock.getState().block).toBeNull()
    useSupportBlock.getState().showSupportBlock('banned')
    expect(useSupportBlock.getState().block).toEqual({ reason: 'banned' })
    useSupportBlock.getState().showSupportBlock('upload')
    expect(useSupportBlock.getState().block).toEqual({ reason: 'upload' })
    useSupportBlock.getState().hideSupportBlock()
    expect(useSupportBlock.getState().block).toBeNull()
  })
})
