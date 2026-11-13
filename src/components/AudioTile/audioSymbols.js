// Material Symbols per audio category/type (the v2 icon set). Used by the
// audio tiles (the type line under each track) and the audio page's type chips,
// so one type always shows one icon. No category counts as a voice note.
export const AUDIO_CATEGORY_SYMBOLS = {
  song: 'music_note',
  music: 'music_note',
  podcast: 'podcasts',
  voice_message: 'mic',
  audiobook: 'menu_book',
  interview: 'forum',
};

export const audioCategorySymbol = (category) =>
  AUDIO_CATEGORY_SYMBOLS[category] || AUDIO_CATEGORY_SYMBOLS.voice_message;
