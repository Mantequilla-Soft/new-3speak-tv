// Shared stand-ins for the EmbedUploadContext tests (not a test file itself).
//
// Each test file loads this with `await vi.hoisted(() => import(...))` and points
// its vi.mock factories at `mocks`, so every module the provider talks to (the
// embed API through axios and XHR, tus, the wallet, the checker, Hive) is a fake
// the test can steer and inspect. Nothing here touches the network.
import { vi } from 'vitest'

export const EMBED_URL = 'https://play.3speak.tv/embed?v=badadib/asset-1'
export const POOL_BASE = 'https://embed2.test'
export const RELIABLE_BASE = 'https://embed.test'

// Mutable per-test state, reset by reset().
export const state = {
  store: { user: 'badadib', incubationHandle: null },
  premium: { premium: false },
  // What /uploads/token answers (axios.post).
  tokenData: null,
}

// Every function the provider calls into, replaced with a fresh vi.fn per test.
export const fns = {}

const defaultToken = () => ({
  token: 'up-tok',
  embed_url: '',
  defer_encode: true,
  finalize_token: 'fin-tok',
  permlink: 'asset-1',
  gated: false,
})

function defaultAxios(url) {
  if (url.endsWith('/uploads/token')) return Promise.resolve({ data: state.tokenData })
  if (url.endsWith('/encode')) return Promise.resolve({ status: 201, data: { ok: true } })
  if (url.endsWith('/scheduled-posts/create')) return Promise.resolve({ status: 201, data: { success: true } })
  return Promise.reject(new Error(`unexpected axios.post ${url}`))
}

// ── tus-js-client ────────────────────────────────────────────────────────────
// `tus.behaviour` decides what an upload does once started: 'success' plays a
// normal upload (progress, an acknowledged PATCH carrying X-Embed-URL, success),
// 'hang' never gets a PATCH acknowledged, 'error' fails; or pass a function.
export const tus = { uploads: [], previous: [], behaviour: 'success', embedUrl: EMBED_URL }

const fakeReq = (method, url) => ({ getMethod: () => method, getURL: () => url })
const fakeRes = (headers) => ({ getHeader: (name) => headers[name] })

export const tusBehaviours = {
  success(up) {
    const o = up.options
    const size = up.file.size
    o.onProgress(Math.floor(size / 2), size)
    o.onAfterResponse(fakeReq('HEAD', `${o.endpoint}/part-1`), fakeRes({ 'Upload-Offset': '0' }))
    o.onAfterResponse(
      fakeReq('PATCH', `${o.endpoint}/part-1`),
      fakeRes({ 'Upload-Offset': String(size), 'X-Embed-URL': tus.embedUrl }),
    )
    o.onChunkComplete(size, size)
    o.onProgress(size, size)
    o.onSuccess()
  },
  hang() {},
  error(up) { up.options.onError(new Error('tus refused')) },
}

export class FakeTusUpload {
  constructor(file, options) {
    this.file = file
    this.options = options
    this.abort = vi.fn(() => Promise.resolve())
    this.resumeFromPreviousUpload = vi.fn()
    tus.uploads.push(this)
  }
  findPreviousUploads() { return Promise.resolve(tus.previous) }
  start() {
    const b = tus.behaviour
    ;(typeof b === 'function' ? b : tusBehaviours[b])(this)
  }
}

// ── XMLHttpRequest (the chunked and single-request fallbacks) ────────────────
// `xhr.handler(path, request)` answers each POST: { status, body } responds,
// 'hang' never answers, 'error' is a network error. The default handler is a
// small working chunk server; tests wrap it to inject faults.
export const xhr = { requests: [], handler: null, server: null }

export function defaultChunkServer(path, req) {
  const s = xhr.server
  const f = req.form
  switch (path) {
    case '/upload/probe':
      return { status: 200, body: {} }
    case '/upload/chunk/create': {
      const size = Number(f.get('size'))
      s.size = size
      s.totalChunks = Math.ceil(size / s.chunkSize)
      return { status: 200, body: { sessionId: 's1', totalChunks: Math.ceil(size / s.chunkSize), chunkSize: s.chunkSize, received: [] } }
    }
    case '/upload/chunk': {
      const index = Number(f.get('index'))
      s.received.add(index)
      req.progress(f.get('chunk').size)
      return { status: 200, body: { receivedBytes: Math.min(s.received.size * s.chunkSize, s.size || Infinity) } }
    }
    case '/upload/chunk/status':
      return { status: 200, body: { received: [...s.received], totalChunks: s.totalChunks, chunkSize: s.chunkSize, receivedBytes: s.received.size * s.chunkSize } }
    case '/upload/chunk/finish':
      return { status: 200, body: { embed_url: s.finishEmbedUrl, permlink: s.finishPermlink } }
    case '/upload/simple':
      req.progress(f.get('file').size)
      return { status: 200, body: { embed_url: s.simpleEmbedUrl } }
    default:
      return { status: 404, body: { error: 'no route' } }
  }
}

export class FakeXHR {
  constructor() {
    this.upload = {}
    this.status = 0
    this.responseText = ''
    xhr.requests.push(this)
  }
  open(method, url) { this.method = method; this.url = url }
  get path() { return new URL(this.url).pathname }
  progress(loaded) {
    this.upload.onprogress?.({ lengthComputable: true, loaded, total: loaded })
  }
  send(form) {
    this.form = form
    const answer = (xhr.handler || defaultChunkServer)(this.path, this)
    if (answer === 'hang') return
    Promise.resolve().then(() => {
      if (answer === 'error') { this.onerror?.(); return }
      this.status = answer.status
      this.responseText = JSON.stringify(answer.body)
      this.onload?.()
    })
  }
  abort() { this.aborted = true; this.onabort?.() }
}

export const posted = (path) => xhr.requests.filter((r) => r.path === path)

// ── module mocks ─────────────────────────────────────────────────────────────
const call = (name) => (...a) => fns[name](...a)

export const mocks = {
  config: {
    EMBED_UPLOAD_URL: 'https://embed.test/uploads',
    EMBED_API_URL: RELIABLE_BASE,
    EMBED_API_KEY: 'embed-key',
    HIVE_API_URL: 'https://hive.test',
    EMBED_DEBUG: false,
    CHECKER_API_KEY: 'checker-key',
  },
  axios: { default: { post: call('axiosPost') } },
  tus: { Upload: FakeTusUpload },
  router: { useNavigate: () => fns.navigate },
  i18n: (() => {
    const t = (key, opts) => (opts ? `${key} ${JSON.stringify(opts)}` : key)
    return { useTranslation: () => ({ t }) }
  })(),
  toast: { toastIn: () => ({ message: call('toastMessage'), error: call('toastError'), success: call('toastSuccess') }) },
  store: { useAppStore: (sel) => (sel ? sel(state.store) : state.store) },
  premium: { usePremiumStatus: () => state.premium },
  snaps: { resolveSnapsContainer: call('resolveSnapsContainer') },
  creatorSettings: { getCreatorSettings: call('getCreatorSettings'), isUploadBlocked: call('isUploadBlocked') },
  supportBlock: { useSupportBlock: { getState: () => ({ showSupportBlock: fns.showSupportBlock }) } },
  thumbnail: { uploadThumbnail: call('uploadThumbnail') },
  endpoints: { pickEmbedEndpoint: call('pickEmbedEndpoint') },
  stale: { reloadIfStale: call('reloadIfStale') },
  aioha: {
    commentWithAioha: call('commentWithAioha'),
    broadcastWithAioha: call('broadcastWithAioha'),
    broadcastViaThreespeak: call('broadcastViaThreespeak'),
    signMessageWithAioha: call('signMessageWithAioha'),
    isLoggedIn: call('isLoggedIn'),
    getCurrentProvider: call('getCurrentProvider'),
    Providers: { Keychain: 'keychain', HiveSigner: 'hivesigner' },
    KeyTypes: { Posting: 'posting', Active: 'active' },
  },
  postingAuth: { hasThreespeakPostingAuth: call('hasThreespeakPostingAuth'), addThreespeakToPostingAuth: call('addThreespeakToPostingAuth') },
  trailer: { setChannelTrailer: call('setChannelTrailer') },
  advertise: { syncVideoAdOptOut: call('syncVideoAdOptOut') },
  youtubeImport: { markImportPublished: call('markImportPublished') },
  stories: { registerStory: call('registerStory') },
  hiveApi: { getPostDetails: call('getPostDetails') },
}

export function reset() {
  state.store = { user: 'badadib', incubationHandle: null }
  state.premium = { premium: false }
  state.tokenData = defaultToken()
  tus.uploads = []
  tus.previous = []
  tus.behaviour = 'success'
  tus.embedUrl = EMBED_URL
  xhr.requests = []
  xhr.handler = null
  xhr.server = {
    chunkSize: 256 * 1024,
    received: new Set(),
    totalChunks: 0,
    size: 0,
    finishEmbedUrl: EMBED_URL,
    finishPermlink: 'asset-1',
    simpleEmbedUrl: EMBED_URL,
  }
  Object.assign(fns, {
    axiosPost: vi.fn(defaultAxios),
    navigate: vi.fn(),
    toastMessage: vi.fn(),
    toastError: vi.fn(),
    toastSuccess: vi.fn(),
    resolveSnapsContainer: vi.fn(async () => ({ author: 'peak.snaps', permlink: 'snap-container-1' })),
    getCreatorSettings: vi.fn(async () => ({})),
    isUploadBlocked: vi.fn(() => false),
    showSupportBlock: vi.fn(),
    uploadThumbnail: vi.fn(async () => 'https://images.test/thumb.jpg'),
    pickEmbedEndpoint: vi.fn(async () => ({ base: POOL_BASE, uploadUrl: `${POOL_BASE}/uploads` })),
    reloadIfStale: vi.fn(async () => false),
    commentWithAioha: vi.fn(async () => ({ success: true })),
    broadcastWithAioha: vi.fn(async () => ({ success: true })),
    broadcastViaThreespeak: vi.fn(async () => ({ success: true })),
    signMessageWithAioha: vi.fn(),
    isLoggedIn: vi.fn(() => true),
    getCurrentProvider: vi.fn(() => 'keychain'),
    hasThreespeakPostingAuth: vi.fn(async () => true),
    addThreespeakToPostingAuth: vi.fn(async () => {}),
    setChannelTrailer: vi.fn(async () => {}),
    syncVideoAdOptOut: vi.fn(async () => {}),
    markImportPublished: vi.fn(async () => {}),
    registerStory: vi.fn(async () => {}),
    getPostDetails: vi.fn(async () => null),
  })
}

// A video file of `bytes` bytes.
export const videoFile = (bytes = 600 * 1024, name = 'clip.mp4') =>
  new File([new Uint8Array(bytes)], name, { type: 'video/mp4' })
