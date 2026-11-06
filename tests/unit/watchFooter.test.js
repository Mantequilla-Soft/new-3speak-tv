import { describe, it, expect } from 'vitest';
import { stripWatchFooter } from '../../src/utils/watchFooter';

// 3Speak's own "Watch on 3speak.tv" footer never shows in a short/story caption
// (owner, 2026-11-05). Credits under a "---" stay.
describe('watch footer', () => {
  const footer = '\n\n---\n▶ [Watch on 3speak.tv](https://3speak.tv/shorts?v=alice/abc)';

  it('drops the footer and its separator', () => {
    expect(stripWatchFooter(`Hello world${footer}`)).toBe('Hello world');
  });

  it('drops the banner and older footer variants', () => {
    const body = 'Hi\n\n---\n▶️ [Watch on 3Speak](https://3speak.tv/watch?v=a/b)\n[![alice](https://3speak.tv/banners/alice.png)](https://3speak.tv/user/alice)';
    expect(stripWatchFooter(body)).toBe('Hi');
    expect(stripWatchFooter('Hi\n\n---\n[3Speak](https://3speak.tv/watch?v=a/b)')).toBe('Hi');
  });

  it('keeps credits and the creator\'s own links', () => {
    const body = `My short\n\n---\n*Sound: Song by Bob*${footer}`;
    expect(stripWatchFooter(body)).toBe('My short\n\n---\n*Sound: Song by Bob*');
    expect(stripWatchFooter('See [my site](https://example.com)')).toBe('See [my site](https://example.com)');
    // A "Watch on 3speak.tv" link inside a sentence is the creator's text, not the footer.
    expect(stripWatchFooter('Go [Watch on 3speak.tv](https://3speak.tv) now')).toBe('Go [Watch on 3speak.tv](https://3speak.tv) now');
  });
});
