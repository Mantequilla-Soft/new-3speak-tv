// @vitest-environment jsdom
// Which document portals belong to (src/utils/portalDocument.js): the page's
// own, or the pop-out player's window inside its provider.
import { describe, it, expect } from 'vitest'
import { createElement as h } from 'react'
import { renderHook } from '@testing-library/react'
import { PortalDocContext, usePortalDoc } from '../../../src/utils/portalDocument.js'

describe('usePortalDoc', () => {
  it('is the page document outside a provider', () => {
    expect(renderHook(() => usePortalDoc()).result.current).toBe(document)
  })

  it('is the pop-out window document inside one', () => {
    const popout = document.implementation.createHTMLDocument('pip')
    const wrapper = ({ children }) => h(PortalDocContext.Provider, { value: popout }, children)
    expect(renderHook(() => usePortalDoc(), { wrapper }).result.current).toBe(popout)
  })
})
