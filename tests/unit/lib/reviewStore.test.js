// The global review popup's state (src/lib/reviewStore.js): opening it for an
// area and an optional post, and closing it.
import { describe, it, expect, beforeEach } from 'vitest'
import { useReviewModal } from '../../../src/lib/reviewStore.js'

beforeEach(() => useReviewModal.getState().closeReview())

describe('useReviewModal', () => {
  it('starts closed', () => {
    expect(useReviewModal.getState().review).toBeNull()
  })

  it('opens for the global area by default', () => {
    useReviewModal.getState().openReview()
    expect(useReviewModal.getState().review).toEqual({ area: 'global', username: null, permlink: null })
  })

  it('opens for an area and post, and closes again', () => {
    useReviewModal.getState().openReview({ area: 'stream', username: 'alice', permlink: 'live-1' })
    expect(useReviewModal.getState().review).toEqual({ area: 'stream', username: 'alice', permlink: 'live-1' })
    useReviewModal.getState().closeReview()
    expect(useReviewModal.getState().review).toBeNull()
  })
})
