// The snap posted when an OpenPod starts (src/utils/openpodUtils.js).
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('../../../src/utils/snapsContainer', () => ({ resolveSnapsContainer: vi.fn(async () => ({ author: 'peak.snaps', permlink: 'c' })) }))

import {
  fetchLatestSnapsPost, buildOpenPodSnapBody, buildOpenPodPermlink, buildOpenPodSnapMetadata,
} from '../../../src/utils/openpodUtils.js'

afterEach(() => { vi.useRealTimers() })

describe('OpenPod snap', () => {
  it('replies under the latest snaps container', async () => {
    expect(await fetchLatestSnapsPost()).toEqual({ author: 'peak.snaps', permlink: 'c' })
  })

  it('the body leads with the thumbnail, then the title and room link', () => {
    expect(buildOpenPodSnapBody('Late show', 'https://3speak.tv/openpod/r', 'https://t/x.jpg'))
      .toBe('![Late show](https://t/x.jpg)\n\n🎙️ **Late show**\n\nI just started an OpenPod — come join the conversation!\n\nhttps://3speak.tv/openpod/r')
  })

  it('without a title or thumbnail it still reads well', () => {
    const body = buildOpenPodSnapBody('', 'https://r')
    expect(body.startsWith('🎙️ **OpenPod Live**')).toBe(true)
    expect(body).not.toContain('![')
    expect(buildOpenPodSnapBody(null, 'u', 'https://t')).toMatch(/^!\[OpenPod\]\(https:\/\/t\)/)
  })

  it('permlinks are time-stamped', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1760000000000)
    expect(buildOpenPodPermlink()).toBe('openpod-1760000000000')
  })

  it('metadata marks the snap as an OpenPod in the 3Speak community', () => {
    expect(buildOpenPodSnapMetadata('room-1')).toEqual({
      app: '3speak/openpod', format: 'markdown', tags: ['3speak', 'openpod', 'hive-181335'], type: 'openpod', room: 'room-1',
    })
  })
})
