/**
 * App-wide Hive markdown renderers.
 *
 * `./renderer.js` is our own vendored copy of the Hive markdown renderer (see
 * the header there for why). It only ever produces 3Speak and IPFS players —
 * YouTube, Vimeo, Twitch, Spotify, Twitter and Instagram URLs stay ordinary
 * inline links, so nothing downstream has to unpick an auto-embed afterwards.
 *
 * Every consumer should take a renderer from here rather than build its own:
 * these are memoised singletons, and the renderer chunk (which drags in
 * @hiveio/content-renderer + DOMPurify) then loads once, on first use.
 */

const promises = {};

function getRenderer(key, embeds) {
  if (!promises[key]) {
    promises[key] = import('./renderer.js').then(({ createHiveRenderer }) =>
      createHiveRenderer({
        ipfsGateway: 'https://hotipfs-3speak-1.b-cdn.net',
        ipfsFallbackGateways: [
          'https://ipfs.skatehive.app',
          'https://cloudflare-ipfs.com',
          'https://ipfs.io',
        ],
        convertHiveUrls: true,
        internalUrlPrefix: '',
        usertagUrlFn: (account) => `/@${account}`,
        hashtagUrlFn: (tag) => `/t/${tag}`,
        embeds,
      })
    );
  }
  return promises[key];
}

/**
 * General-purpose renderer: comments, snaps, community descriptions, composer
 * previews. 3Speak video and audio links become players.
 *
 * @returns {Promise<(markdown: string) => string>}
 */
export function getHiveRenderer() {
  return getRenderer('default', {});
}

/**
 * Renderer for a video's own post body (watch page, shorts).
 *
 * 3Speak video embeds are off: the body almost always leads with a link to the
 * very video the page is already playing, and embedding it would show the same
 * video twice. Audio is still embedded — BlogContent swaps those containers for
 * a native <AudioPlayerInline />.
 *
 * @returns {Promise<(markdown: string) => string>}
 */
export function getPostBodyRenderer() {
  return getRenderer('postBody', { threespeakVideo: false });
}
