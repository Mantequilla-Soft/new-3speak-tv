import { describe, it, expect } from 'vitest';
import {
  buildAudioEmbedHtml, buildAudioEmbedSrc, buildPlaylistEmbedHtml, buildPlaylistEmbedSrc,
} from '../../src/utils/embedCode';
import { AUDIO_EMBED_BASE } from '../../src/utils/config';

describe('audio and playlist embed code', () => {
  it('points an audio at the audio player, embedded look, chosen mode', () => {
    expect(buildAudioEmbedSrc('tmcfounj', 'compact')).toBe(`${AUDIO_EMBED_BASE}/play?a=tmcfounj&mode=compact&iframe=1`);
  });

  it('points a playlist at the playlist embed', () => {
    expect(buildPlaylistEmbedSrc('4bc07fe6-b8a0-439a-b97a-c77a8bfe5c32'))
      .toBe(`${AUDIO_EMBED_BASE}/play?list=4bc07fe6-b8a0-439a-b97a-c77a8bfe5c32&iframe=1`);
  });

  it('is full width with the height of the chosen size', () => {
    expect(buildAudioEmbedHtml('x', { size: 'minimal' })).toContain('width="100%" height="80"');
    expect(buildPlaylistEmbedHtml('abcdefgh', { size: 'tall' })).toContain('height="640"');
    expect(buildPlaylistEmbedHtml('abcdefgh', { size: 'nope' })).toContain('height="480"');
  });

  it('escapes the title so a quote cannot break the snippet', () => {
    const html = buildPlaylistEmbedHtml('abcdefgh', { title: 'Mix "1" & <b>' });
    expect(html).toContain('title="Mix &quot;1&quot; &amp; &lt;b&gt;"');
  });
});
