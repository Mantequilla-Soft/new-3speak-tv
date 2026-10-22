// TUS upload settings (src/utils/tusConfig.js).
import { describe, it, expect } from 'vitest'
import {
  getTusUploadOptions, TUS_CHUNK_SIZE, TUS_RETRY_DELAYS, TUS_THUMBNAIL_CONFIG,
} from '../../../src/utils/tusConfig.js'

describe('getTusUploadOptions', () => {
  it('uses 50 MB chunks, data on creation and the shared retry ladder', () => {
    const o = getTusUploadOptions()
    expect(o.chunkSize).toBe(50 * 1024 * 1024)
    expect(o.chunkSize).toBe(TUS_CHUNK_SIZE)
    expect(o.uploadDataDuringCreation).toBe(true)
    expect(o.retryDelays).toEqual([0, 1000, 3000, 5000, 10000])
  })

  it('custom options win over the defaults', () => {
    const o = getTusUploadOptions({ chunkSize: 1, parallelUploads: 1, endpoint: 'https://x' })
    expect(o).toMatchObject({ chunkSize: 1, parallelUploads: 1, endpoint: 'https://x', retryDelays: TUS_RETRY_DELAYS })
  })

  it('retry delays never go down', () => {
    for (let i = 1; i < TUS_RETRY_DELAYS.length; i++) expect(TUS_RETRY_DELAYS[i]).toBeGreaterThan(TUS_RETRY_DELAYS[i - 1])
  })

  it('thumbnails upload in one small sequential stream', () => {
    expect(TUS_THUMBNAIL_CONFIG).toMatchObject({ chunkSize: 5 * 1024 * 1024, parallelUploads: 1 })
  })
})
