import { describe, it, expect } from 'vitest';
import { splitAudioBody, joinAudioBody } from '../../../src/utils/audioPostBody';
import { soundCreditsMarkdown } from '../../../src/utils/soundCredits';

const PLAY = 'https://audio.3speak.tv/play?a=abc123';
const COVER = 'https://images.hive.blog/p/cover.jpg';

// The way the audio uploader writes a body (AudioUploadModal publishSinglePost).
const uploaderBody = ({ cover = COVER, title = 'My Song', desc = 'Show notes here.', credits = [] } = {}) => {
  const c = cover ? `![${title}](${cover})\n\n` : '';
  return `${c}${PLAY}\n\n${desc}`.trim() + soundCreditsMarkdown(credits);
};

const CREDITS = [{ title: 'Calm', artist: 'Someone', source: 'Pixabay', sourceUrl: 'https://pixabay.com/x' }];

describe('splitAudioBody', () => {
  it('splits cover, player line and notes', () => {
    const s = splitAudioBody(uploaderBody());
    expect(s).toEqual({
      hasHead: true, coverAlt: 'My Song', coverUrl: COVER, playLine: PLAY, notes: 'Show notes here.', credits: '',
    });
  });

  it('works without a cover', () => {
    const s = splitAudioBody(uploaderBody({ cover: '' }));
    expect(s.hasHead).toBe(true);
    expect(s.coverUrl).toBe('');
    expect(s.playLine).toBe(PLAY);
    expect(s.notes).toBe('Show notes here.');
  });

  it('keeps the sound credits apart from the notes', () => {
    const s = splitAudioBody(uploaderBody({ credits: CREDITS }));
    expect(s.notes).toBe('Show notes here.');
    expect(s.credits.startsWith('---\n*Music: "Calm" Someone')).toBe(true);
  });

  it('keeps a markdown rule inside the notes when no credits follow it', () => {
    const s = splitAudioBody(uploaderBody({ desc: 'Part one\n\n---\n\nPart two' }));
    expect(s.notes).toBe('Part one\n\n---\n\nPart two');
    expect(s.credits).toBe('');
  });

  it('treats a body of another shape as all notes', () => {
    const body = 'Hello\n\nListen: https://audio.3speak.tv/play?a=x';
    expect(splitAudioBody(body)).toMatchObject({ hasHead: false, notes: body, credits: '' });
    expect(splitAudioBody('')).toMatchObject({ hasHead: false, notes: '' });
    expect(splitAudioBody(null)).toMatchObject({ hasHead: false, notes: '' });
  });
});

describe('joinAudioBody', () => {
  it('gives back the uploader body unchanged', () => {
    for (const body of [
      uploaderBody(),
      uploaderBody({ cover: '' }),
      uploaderBody({ credits: CREDITS }),
      uploaderBody({ credits: [...CREDITS, { ...CREDITS[0], title: 'Two' }] }),
    ]) {
      expect(joinAudioBody(splitAudioBody(body))).toBe(body);
    }
  });

  it('writes the edited notes and a new cover', () => {
    const s = splitAudioBody(uploaderBody({ credits: CREDITS }));
    const out = joinAudioBody({ ...s, notes: 'New notes', coverUrl: 'https://x/new.png', coverAlt: 'New [title]' });
    expect(out.startsWith(`![New title](https://x/new.png)\n\n${PLAY}\n\nNew notes\n\n---\n*Music:`)).toBe(true);
  });

  it('leaves out empty notes and a removed cover', () => {
    const s = splitAudioBody(uploaderBody());
    expect(joinAudioBody({ ...s, notes: '  ', coverUrl: '' })).toBe(PLAY);
  });

  it('returns only the notes for a body of another shape', () => {
    const s = splitAudioBody('Plain post');
    expect(joinAudioBody({ ...s, notes: 'Edited' })).toBe('Edited');
  });
});
