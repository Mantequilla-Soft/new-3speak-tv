// @vitest-environment jsdom
// The studio's live captions setting (components/openpods/studioCaptions):
// Pro hosts only. Where the speech server runs stream captions on Whisper
// (/live) the source starts there and every Whisper language is offered, the
// host's own first; else /stt with the live models.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

const m = vi.hoisted(() => ({ premium: true, info: null, sourceCfg: null }))
vi.mock('../../../src/hooks/usePremiumStatus', () => ({ usePremiumStatus: () => ({ premium: m.premium }) }))
vi.mock('../../../src/utils/transcribe', () => ({ speechInfo: async () => m.info }))
vi.mock('../../../src/utils/config', async (orig) => ({
  ...(await orig()),
  STT_WS_URL: 'wss://speech.test/stt',
  sttEnabledFor: () => true,
}))
vi.mock('../../../src/utils/liveCaptionSource', async (orig) => {
  const real = await orig()
  return { ...real, createLiveCaptionSource: (cfg) => { m.sourceCfg = cfg; return () => ({ stop() {} }) } }
})
vi.mock('react-i18next', async (orig) => ({
  ...(await orig()),
  useTranslation: () => ({ t: (k) => k, i18n: { resolvedLanguage: 'de', language: 'de' } }),
}))

const { useStudioCaptionsOptions } = await import('../../../src/components/openpods/studioCaptions.js')

beforeEach(() => {
  m.premium = true
  m.sourceCfg = null
  m.info = { models: ['en-us', 'de'], transcribe: null, live: null }
})

describe('studio captions setting', () => {
  it('is not offered to a host without Pro', async () => {
    m.premium = false
    const { result } = renderHook(() => useStudioCaptionsOptions('badadib'))
    await new Promise((r) => setTimeout(r, 20))
    expect(result.current).toBeUndefined()
  })

  it('a Pro host captions on /live with the Whisper languages, their own first', async () => {
    m.info = { models: ['en-us'], transcribe: null, live: { engine: 'whisper', langs: ['en', 'de', 'tl'] } }
    const { result } = renderHook(() => useStudioCaptionsOptions('badadib'))
    await waitFor(() => expect(result.current).toBeDefined())
    expect(result.current.languages.map((l) => l.code)).toEqual(['de', 'en', 'tl'])
    expect(m.sourceCfg).toMatchObject({ url: 'wss://speech.test/stt', liveUrl: 'wss://speech.test/live', user: 'badadib' })
  })

  it('without Whisper live it is /stt with the live models', async () => {
    const { result } = renderHook(() => useStudioCaptionsOptions('badadib'))
    await waitFor(() => expect(result.current).toBeDefined())
    expect(result.current.languages.map((l) => l.code)).toEqual(['de', 'en-us'])
    expect(m.sourceCfg.liveUrl).toBeNull()
  })

  it('nothing while the studio is closed', async () => {
    const { result } = renderHook(() => useStudioCaptionsOptions('badadib', false))
    await new Promise((r) => setTimeout(r, 20))
    expect(result.current).toBeUndefined()
  })
})
