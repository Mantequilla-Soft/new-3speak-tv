// @vitest-environment jsdom
// Shared plumbing for the site's 3D touches (src/lib/three3d.js): the lazy
// three.js chunk, WebGL and motion checks, the theme read, the renderer
// wrapper and freeing a scene. three.js itself is replaced by small fakes.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

let mod
beforeEach(async () => {
  vi.resetModules()
  vi.doMock('three', () => ({ marker: 'three' }))
  mod = await import('../../../src/lib/three3d.js')
})
afterEach(() => {
  vi.doUnmock('three')
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.className = ''
  delete window.matchMedia
  delete window.WebGLRenderingContext
})

const media = (matches) => vi.fn(() => ({ matches }))

describe('loadThree', () => {
  it('loads three.js once and shares the promise', async () => {
    const a = mod.loadThree()
    expect(mod.loadThree()).toBe(a)
    expect((await a).marker).toBe('three')
  })

  it('lets the next caller try again after a failed chunk load', async () => {
    vi.resetModules()
    let fail = true
    vi.doMock('three', () => {
      if (fail) throw new Error('chunk 404')
      return { marker: 'retry' }
    })
    const fresh = await import('../../../src/lib/three3d.js')
    await expect(fresh.loadThree()).rejects.toThrow()
    fail = false
    vi.resetModules()
    vi.doMock('three', () => ({ marker: 'retry' }))
    // The cached promise was dropped, so this call imports again.
    await expect(fresh.loadThree()).resolves.toMatchObject({ marker: 'retry' })
  })
})

describe('hasWebGL', () => {
  const fakeCanvas = (ctx) => {
    const real = document.createElement.bind(document)
    return vi.spyOn(document, 'createElement').mockImplementation((tag) => (
      tag === 'canvas' ? { getContext: vi.fn((kind) => ctx[kind] ?? null) } : real(tag)
    ))
  }

  it.each([
    ['a WebGL2 context', { webgl2: {} }, true],
    ['only WebGL1', { webgl: {} }, true],
    ['no context', {}, false],
  ])('answers %s', (_, ctx, expected) => {
    window.WebGLRenderingContext = function WebGLRenderingContext() {}
    fakeCanvas(ctx)
    expect(mod.hasWebGL()).toBe(expected)
  })

  it('answers false without the WebGL constructor', () => {
    fakeCanvas({ webgl2: {} })
    expect(mod.hasWebGL()).toBe(false)
  })

  it('answers false when probing throws, and remembers the answer', () => {
    window.WebGLRenderingContext = function WebGLRenderingContext() {}
    const spy = vi.spyOn(document, 'createElement').mockImplementation(() => { throw new Error('blocked') })
    expect(mod.hasWebGL()).toBe(false)
    expect(mod.hasWebGL()).toBe(false)
    expect(spy).toHaveBeenCalledTimes(1)
  })
})

describe('prefersReducedMotion', () => {
  it('follows the media query and is false without matchMedia', () => {
    expect(mod.prefersReducedMotion()).toBe(false)
    window.matchMedia = media(true)
    expect(mod.prefersReducedMotion()).toBe(true)
    expect(window.matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)')
  })
})

describe('isDarkTheme', () => {
  it.each([
    ['data-theme light', () => document.documentElement.setAttribute('data-theme', 'light'), true, false],
    ['data-theme dark', () => document.documentElement.setAttribute('data-theme', 'dark'), false, true],
    ['a dark class', () => { document.documentElement.className = 'theme-dark' }, false, true],
    ['nothing set, system dark', () => {}, true, true],
    ['nothing set, system light', () => {}, false, false],
  ])('%s', (_, arrange, systemDark, expected) => {
    arrange()
    window.matchMedia = media(systemDark)
    expect(mod.isDarkTheme()).toBe(expected)
  })

  it('is light when nothing is set and matchMedia is missing', () => {
    expect(mod.isDarkTheme()).toBe(false)
  })
})

describe('createRenderer', () => {
  function fakeThree() {
    const instances = []
    class WebGLRenderer {
      constructor(opts) {
        this.opts = opts
        this.domElement = document.createElement('canvas')
        this.setPixelRatio = vi.fn()
        this.setClearColor = vi.fn()
        this.dispose = vi.fn()
        this.forceContextLoss = vi.fn()
        instances.push(this)
      }
    }
    return { THREE: { WebGLRenderer, SRGBColorSpace: 'srgb' }, instances }
  }

  it('fills the host with a transparent, capped pixel ratio canvas and cleans up', () => {
    const { THREE, instances } = fakeThree()
    const host = document.createElement('div')
    vi.stubGlobal('devicePixelRatio', 3)
    const { renderer, dispose } = mod.createRenderer(THREE, host)
    expect(renderer).toBe(instances[0])
    expect(renderer.opts).toEqual({ antialias: true, alpha: true, powerPreference: 'low-power' })
    expect(renderer.setPixelRatio).toHaveBeenCalledWith(2)
    expect(renderer.setClearColor).toHaveBeenCalledWith(0x000000, 0)
    expect(renderer.outputColorSpace).toBe('srgb')
    expect(host.firstChild).toBe(renderer.domElement)
    expect(renderer.domElement.style.width).toBe('100%')

    dispose()
    expect(renderer.dispose).toHaveBeenCalled()
    expect(renderer.forceContextLoss).toHaveBeenCalled()
    expect(host.childNodes).toHaveLength(0)
  })

  it('uses a pixel ratio of 1 when the device reports none', () => {
    const { THREE, instances } = fakeThree()
    vi.stubGlobal('devicePixelRatio', 0)
    mod.createRenderer(THREE, document.createElement('div'), { pixelRatioCap: 4 })
    expect(instances[0].setPixelRatio).toHaveBeenCalledWith(1)
  })
})

describe('disposeTree', () => {
  const tex = (shared) => ({ isTexture: true, userData: shared ? { shared: true } : {}, dispose: vi.fn() })

  it('frees geometries, materials and their own textures, keeping shared ones', () => {
    const own = tex(false)
    const shared = tex(true)
    const matA = { map: own, dispose: vi.fn() }
    const matB = { map: shared, color: 3, empty: null, dispose: vi.fn() }
    const meshA = { geometry: { dispose: vi.fn() }, material: matA }
    const meshB = { geometry: { dispose: vi.fn() }, material: [matB] }
    const group = {}
    const root = { traverse: (fn) => [group, meshA, meshB].forEach(fn) }

    mod.disposeTree(root)

    expect(meshA.geometry.dispose).toHaveBeenCalled()
    expect(meshB.geometry.dispose).toHaveBeenCalled()
    expect(matA.dispose).toHaveBeenCalled()
    expect(matB.dispose).toHaveBeenCalled()
    expect(own.dispose).toHaveBeenCalled()
    expect(shared.dispose).not.toHaveBeenCalled()
  })
})

describe('PALETTE', () => {
  it('keeps the flat corporate red', () => {
    expect(mod.PALETTE.red).toBe(0xe53935)
  })
})
