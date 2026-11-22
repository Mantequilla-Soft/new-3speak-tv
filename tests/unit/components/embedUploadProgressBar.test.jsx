// @vitest-environment jsdom
// The upload progress card in the embed studio (components/embed-studio/
// EmbedUploadProgressBar): its chunk strip. On prod 2.0.153 every upload in more
// than one chunk took the page down ("Cannot read properties of undefined
// (reading 'length')" on /embed-studio/preview and /timeline): the strip read a
// third argument Array.from never passes.
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import '../../../src/i18n'

const upload = vi.hoisted(() => ({ value: {} }))
vi.mock('../../../src/context/EmbedUploadContext', () => ({ useEmbedUpload: () => upload.value }))
const { default: EmbedUploadProgressBar } = await import('../../../src/components/embed-studio/EmbedUploadProgressBar.jsx')

const uploading = (detail) => {
  upload.value = { videoUploadStatus: 'uploading', uploadProgress: 40, uploading: false, prefilled: false, selectedEndpoint: 'https://embed2.3speak.tv', statusText: '', uploadDetail: detail, cancelEarlyUpload: vi.fn() }
}
const cells = (c) => [...c.querySelectorAll('.embed-upload-progress-chunks > span')].map((s) => s.className)

describe('EmbedUploadProgressBar: the chunk strip', () => {
  it('draws one cell per chunk: the confirmed ones done, the next one live', () => {
    uploading({ method: 'resumable', chunksTotal: 5, chunksDone: 2 })
    const { container } = render(<EmbedUploadProgressBar />)
    expect(cells(container)).toEqual(['is-done', 'is-done', 'is-live', '', ''])
  })

  it('caps a long upload at 24 cells, each standing for several chunks', () => {
    uploading({ method: 'resumable', chunksTotal: 240, chunksDone: 120 })
    const { container } = render(<EmbedUploadProgressBar />)
    const c = cells(container)
    expect(c).toHaveLength(24)
    expect(c.filter((x) => x === 'is-done')).toHaveLength(12)
    expect(c[12]).toBe('is-live')
  })

  it('has no strip for a single chunk or the compact card', () => {
    uploading({ chunksTotal: 1, chunksDone: 0 })
    expect(cells(render(<EmbedUploadProgressBar />).container)).toEqual([])
    uploading({ chunksTotal: 5, chunksDone: 1 })
    expect(cells(render(<EmbedUploadProgressBar compact />).container)).toEqual([])
  })
})
