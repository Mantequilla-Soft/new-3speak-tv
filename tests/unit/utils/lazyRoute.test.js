// @vitest-environment jsdom
// Lazy route components (src/utils/lazyRoute.js): a route chunk that fails to
// load reloads the page once onto the current build, and after that the error
// reaches the error boundary instead of a fallback that never goes away.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Component, Suspense, createElement as h } from 'react'
import { render, screen } from '@testing-library/react'

const m = vi.hoisted(() => ({ reload: vi.fn() }))
vi.mock('../../../src/utils/staleChunk', () => ({ reloadOnceForChunk: m.reload }))

import lazyRoute from '../../../src/utils/lazyRoute.js'

class Boundary extends Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(error) { return { error } }
  render() { return this.state.error ? h('p', null, `error: ${this.state.error.message}`) : this.props.children }
}
const mount = (Route) => render(h(Boundary, null, h(Suspense, { fallback: h('p', null, 'loading') }, h(Route))))

beforeEach(() => {
  m.reload.mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('lazyRoute', () => {
  it('renders the route once its chunk loads', async () => {
    const Route = lazyRoute(async () => ({ default: () => h('p', null, 'shorts page') }), 'Shorts')
    mount(Route)
    expect(await screen.findByText('shorts page')).toBeInTheDocument()
    expect(m.reload).not.toHaveBeenCalled()
  })

  it('reloads once when the chunk is gone, holding the fallback while the page goes', async () => {
    m.reload.mockResolvedValue(true)
    const Route = lazyRoute(() => Promise.reject(new Error('Failed to fetch dynamically imported module')), 'Shorts')
    mount(Route)
    await vi.waitFor(() => expect(m.reload).toHaveBeenCalledWith('Shorts'))
    expect(screen.getByText('loading')).toBeInTheDocument()
  })

  it('hands the error to the boundary when a reload already happened', async () => {
    m.reload.mockResolvedValue(false)
    const Route = lazyRoute(() => Promise.reject(new Error('chunk 404')), 'Shorts')
    mount(Route)
    expect(await screen.findByText('error: chunk 404')).toBeInTheDocument()
    expect(console.error).toHaveBeenCalledWith('[route] chunk failed to load: Shorts', expect.any(Error))
  })
})
