// Share-card text rules (server/og-text.cjs): a short's title and description.
import { describe, it, expect } from 'vitest'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const { clip, withoutLeadingTitle, shortCardText } = require('../../server/og-text.cjs')

describe('a short card\'s text', () => {
  it('a cut title: the description goes on where the title stops', () => {
    const title = 'I ate a raw chicken breast on the carnivore diet for science'
    const desc = `${title} In this video I consume a raw chicken breast. Why? Because why not and for science. It was a bit slimy.`
    const out = shortCardText(title, desc, 'vynith')
    expect(out.title).toBe('I ate a raw chicken breast on the carnivore diet…')
    expect(out.title.length).toBeLessThanOrEqual(50)
    expect(out.description.startsWith('…for science In this video I consume')).toBe(true)
    expect(out.description.length).toBeLessThanOrEqual(100)
  })

  it('never starts the description inside a word when the title is a cut caption line', () => {
    const caption = 'Make lunchtime easier with this cute, portable thermal lunch box Leak-proof, durable and perfect for school, work or travel'
    // firstLine() cuts a caption line to 100 characters, mid-word.
    const out = shortCardText(`${caption.slice(0, 97)}...`, caption, 'nov13')
    expect(out.title).toBe('Make lunchtime easier with this cute, portable…')
    expect(out.description.startsWith('…thermal lunch box Leak-proof')).toBe(true)
  })

  it('a whole title is left out of the description whole', () => {
    expect(shortCardText('My dog learns to surf', 'My dog learns to surf. It goes badly.', 'alice').description).toBe('It goes badly.')
  })

  it('says whose short it is when the caption is only the title', () => {
    expect(shortCardText('My dog learns to surf', 'My dog learns to surf!', 'alice'))
      .toEqual({ title: 'My dog learns to surf', description: 'A short by @alice on 3Speak.' })
  })

  it('ignores case and punctuation when matching, and keeps a description that starts otherwise', () => {
    expect(withoutLeadingTitle('MY DOG, learns to surf - and fails', 'My dog learns to surf')).toBe('and fails')
    expect(withoutLeadingTitle('Something else first', 'My dog')).toBe('Something else first')
    expect(withoutLeadingTitle('Cats are great', 'Cat')).toBe('Cats are great')
  })

  it('cuts at a word break, a single long word where it is', () => {
    expect(clip('short enough', 50)).toBe('short enough')
    expect(clip('one two three four five six seven', 20)).toBe('one two three four…')
    expect(clip('x'.repeat(60), 50)).toBe(`${'x'.repeat(49)}…`)
  })
})
