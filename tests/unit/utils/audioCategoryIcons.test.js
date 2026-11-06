// Icons for audio categories (src/utils/audioCategoryIcons.js): the same type
// always shows the same icon, and no category reads as a voice message.
import { describe, it, expect } from 'vitest'
import { AUDIO_CATEGORY_ICONS, audioCategoryIcon } from '../../../src/utils/audioCategoryIcons.js'

describe('audioCategoryIcon', () => {
  it.each([
    ['song', 'fa-solid fa-music'],
    ['music', 'fa-solid fa-music'],
    ['podcast', 'fa-solid fa-podcast'],
    ['audiobook', 'fa-solid fa-book-open'],
    ['interview', 'fa-solid fa-comments'],
    ['voice_message', 'fa-solid fa-microphone'],
    [undefined, 'fa-solid fa-microphone'],
    ['unknown', 'fa-solid fa-microphone'],
  ])('%s -> %s', (category, icon) => {
    expect(audioCategoryIcon(category)).toBe(icon)
  })

  it('uses Font Awesome solid icons only', () => {
    for (const icon of Object.values(AUDIO_CATEGORY_ICONS)) expect(icon).toMatch(/^fa-solid fa-[a-z-]+$/)
  })
})
