// TagsV2Picker in multi mode (the interests popup, layout="tiles"): a category
// and its topics as one choice (owner 2026-11-12). A click on a category with
// nothing picked picks it whole; after that a click only opens/closes it and
// never takes anything away; topics leave out or add; Clear empties it; the
// tile shows a partial fill ("3/5") when only some topics are picked.
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { useState } from 'react'
import { screen, within } from '@testing-library/react'
import { renderWithProviders } from './_render.jsx'
import TagsV2Picker from '../../../src/components/tooltip/TagsV2Picker.jsx'

let last = []
function Harness({ initial = [] }) {
  const [value, setValue] = useState(initial)
  last = value
  return <TagsV2Picker multi layout="tiles" searchable value={value} onChange={setValue} />
}
const cat = () => screen.getAllByRole('button', { name: /Food & Outdoors/ })[0]
const topic = (name) => within(document.querySelector('.tagsv2-topics')).getByRole('button', { name: new RegExp(`^${name}`) })

describe('interests picker: categories and topics', () => {
  it('a first click picks the whole category; its topics show as picked', async () => {
    const { user } = renderWithProviders(<Harness />)
    await user.click(cat())
    expect(last).toEqual(['food-outdoor'])
    expect(cat()).toHaveAttribute('aria-pressed', 'true')
    expect(topic('Pets')).toHaveAttribute('aria-pressed', 'true')
  })

  it('leaving topics out of a whole category keeps the rest, shown as a partial fill', async () => {
    const { user } = renderWithProviders(<Harness />)
    await user.click(cat())
    await user.click(topic('Pets'))
    await user.click(topic('Gardening'))
    expect(new Set(last)).toEqual(new Set(['nature', 'travel', 'food']))
    expect(cat()).toHaveAttribute('aria-pressed', 'mixed')
    expect(cat()).toHaveClass('is-partial')
    expect(cat().style.getPropertyValue('--fill')).toBe('60%')
    expect(within(cat()).getByText('3/5')).toBeInTheDocument()
  })

  it('a click on a category with picks only opens or closes it, nothing is taken away', async () => {
    // A category with picks starts open (returning users see their picks).
    const { user } = renderWithProviders(<Harness initial={['nature', 'food']} />)
    expect(document.querySelector('.tagsv2-topics')).not.toBeNull()
    await user.click(cat())      // closes
    expect(new Set(last)).toEqual(new Set(['nature', 'food']))
    expect(document.querySelector('.tagsv2-topics')).toBeNull()
    expect(cat()).toHaveAttribute('aria-pressed', 'mixed')
    await user.click(cat())      // opens again
    expect(new Set(last)).toEqual(new Set(['nature', 'food']))
    expect(document.querySelector('.tagsv2-topics')).not.toBeNull()
  })

  it('picking every topic one by one makes the category whole; Clear empties it', async () => {
    const { user } = renderWithProviders(<Harness initial={['nature', 'travel', 'food', 'pets']} />)
    await user.click(topic('Gardening'))   // open from the start
    expect(last).toEqual(['food-outdoor'])
    await user.click(screen.getByRole('button', { name: 'Clear' }))
    expect(last).toEqual([])
    expect(cat()).toHaveAttribute('aria-pressed', 'false')
  })
})
