// Share pages for outside podcasts on the audio page (server/og-pages.cjs):
// a show or an episode gets its own card page, the bare /audio keeps the
// audio page's card, and a malformed id is a page that does not exist.
import { describe, it, expect } from 'vitest'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const pages = require('../../server/og-pages.cjs')({})
const at = (u) => pages.match(new URL(u, 'https://3speak.tv'))

describe('podcast share pages', () => {
  it('match a show and an episode by their checker ids', () => {
    expect(at('/audio?type=external&podcast=6ae3d0da1b502682dec2f1d5')).toEqual({ kind: 'podcast', id: '6ae3d0da1b502682dec2f1d5' })
    expect(at('/audio?type=external&episode=6ae3d0da1b502682dec2f1d5%3ApCVMxOtyQtOMcjew'))
      .toEqual({ kind: 'episode', id: '6ae3d0da1b502682dec2f1d5:pCVMxOtyQtOMcjew' })
  })

  it('leave the bare audio page to its own card', () => {
    expect(at('/audio')).toBeNull()
    expect(at('/audio?type=external')).toBeNull()
  })

  it('treat an id no feed can have as missing', () => {
    expect(at('/audio?podcast=nope')).toEqual({ kind: 'missing' })
    expect(at('/audio?episode=6ae3d0da1b502682dec2f1d5')).toEqual({ kind: 'missing' })
  })

  it('match a 3Speak audio by its player link', () => {
    expect(at('/audio?play=kevinicabales/aa8ro7ms')).toEqual({ kind: 'audioplay', owner: 'kevinicabales', id: 'aa8ro7ms' })
    expect(at('/audio?play=@Kevinicabales/aa8ro7ms&t=30')).toEqual({ kind: 'audioplay', owner: 'kevinicabales', id: 'aa8ro7ms' })
    expect(at('/audio?play=x/aa8ro7ms')).toEqual({ kind: 'missing' })
    expect(at('/audio?play=kevinicabales/../etc')).toEqual({ kind: 'missing' })
  })
})
