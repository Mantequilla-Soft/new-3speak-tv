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

describe('podcast embed code', () => {
  it('points an outside show at the podcast embed, playlist heights', async () => {
    const { buildPodcastEmbedHtml, buildPodcastEmbedSrc } = await import('../../src/utils/embedCode');
    expect(buildPodcastEmbedSrc('6ae3c77f91d7738e82354365')).toBe(`${AUDIO_EMBED_BASE}/play?podcast=6ae3c77f91d7738e82354365&iframe=1`);
    expect(buildPodcastEmbedHtml('6ae3c77f91d7738e82354365', { size: 'short', title: 'Battle of the Nerds' }))
      .toContain('height="360"');
  });
});
