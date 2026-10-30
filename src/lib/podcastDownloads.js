/**
 * Episodes saved in this browser for listening without a connection.
 * INTERFACE STUB: the podcast library work (feat/podcast-library) replaces the
 * bodies; the signatures below are the contract the player relies on.
 */

/** True when the track with this id is saved here. Synchronous. */
export function isDownloaded(_id) { return false; }

/** An object URL for the saved audio of this track, or null. */
export async function localAudioUrl(_id) { return null; }

/** Save a track (an outside episode or a 3Speak audio). Resolves when done. */
export async function downloadTrack(_track) { throw new Error('not implemented'); }

/** Forget a saved track. */
export async function removeDownload(_id) {}

/** React hook: { items: [{ id, track, bytes, savedAt }], progress: { [id]: 0..1 }, usedBytes } */
export function useDownloads() { return { items: [], progress: {}, usedBytes: 0 }; }
