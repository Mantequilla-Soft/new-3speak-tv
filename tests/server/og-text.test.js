// Share-card text rules (server/og-text.cjs): a short's title and description.
import { describe, it, expect } from 'vitest'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const { clip, withoutLeadingTitle, shortCardText } = require('../../server/og-text.cjs')

describe('a short card\'s text', () => {
  it('does not repeat the title at the start of the description', () => {
    const title = 'I ate a raw chicken breast on the carnivore diet for science'
    const desc = `${title} In this video I consume a raw chicken breast. Why? Because why not and for science. It was a bit slimy.`
    const out = shortCardText(title, desc, 'vynith')
    expect(out.title).toBe('I ate a raw chicken breast on the carnivore diet…')
    expect(out.title.length).toBeLessThanOrEqual(50)
    expect(out.description.startsWith('In this video I consume')).toBe(true)
    expect(out.description.length).toBeLessThanOrEqual(100)
  })

  it('says whose short it is when the caption is only the title', () => {
    expect(shortCardText('My dog learns to surf', 'My dog learns to surf!', 'alice'))
      .toEqual({ title: 'My dog learns to surf', description: 'A short by @alice on 3Speak.' })
  })

  it('ignores case and punctuation when matching, and keeps a description that starts otherwise', () => {
    expect(withoutLeadingTitle('MY DOG, learns to surf - and fails', 'My dog learns to surf')).toBe('and fails')
    expect(withoutLeadingTitle('Something else first', 'My dog')).toBe('Something else first')
  })

  it('cuts at a word break, a single long word where it is', () => {
    expect(clip('short enough', 50)).toBe('short enough')
    expect(clip('one two three four five six seven', 20)).toBe('one two three four…')
    expect(clip('x'.repeat(60), 50)).toBe(`${'x'.repeat(49)}…`)
  })
})
