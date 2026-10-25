// Share cards for the pages that are not a single video: creator profiles,
// playlists / albums, and audio posts. Same job as the video card in
// og-server.cjs (crawlers run no JavaScript, so without this every one of these
// links unfurled as the generic 3Speak card), same rules:
//
//   - Never fail the bot. A lookup that FAILED answers null (the caller tells
//     search engines to retry, link previews get the generic card). A thing
//     that does not exist answers MISSING: a 404 for search engines, so dead
//     URLs leave the index instead of standing in as copies of the homepage.
//   - Private and banned things look like they do not exist: a private playlist
//     or a banned creator is MISSING too, never a card that leaks a title.
//   - rel=canonical always names the 3speak.tv page (CANONICAL_ORIGIN), og:url
//     the host that was asked.
//   - Googlebot shares this route, so the body carries real text and links
//     (bio, track list, latest videos) rather than only meta tags.
//
// Built as a factory so it can reuse og-server's helpers (thumbnail fixing,
// image bounding, Hive post lookup, indexability) without a circular require.

const HIVE_API = 'https://api.hive.blog';
// Audio files are served from the audio gateway only: the hot Bunny zone 500s
// and ipfs.3speak.tv refuses browsers. See the snapie audio notes.
const AUDIO_GATEWAY = process.env.OG_AUDIO_GATEWAY || 'https://ipfs-audio.3speak.tv';
const FETCH_TIMEOUT_MS = 4000;
const ACCOUNT_RE = /^[a-z0-9][a-z0-9.-]{2,15}$/;
const PLAYLIST_ID_RE = /^[a-zA-Z0-9-]{8,64}$/;
const PERMLINK_RE = /^[a-z0-9][a-z0-9-]{0,255}$/i;
const MAX_LISTED = 20;

const AUDIO_MIME = { mp3: 'audio/mpeg', m4a: 'audio/mp4', mp4: 'audio/mp4', webm: 'audio/webm', ogg: 'audio/ogg', wav: 'audio/wav' };

module.exports = function createPages(h) {
  const {
    CANONICAL_ORIGIN, CHECKER_URL, escapeHtml, fixThumbnail, boundImage, extractDescription,
    parseMeta, getIndexability, lookupHivePost, isMissingError, breadcrumbLd,
    secondsToISO8601, toIsoDate, ogVideo, cardUrl,
  } = h;

  /** Answered by a handler for a page that does not exist (see the header). */
  const MISSING = Symbol('missing');

  async function getJson(url, init) {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return null;
    return res.json();
  }

  /** { data } on success, { missing: true } on a 404, { error: true } otherwise. */
  async function getJsonState(url) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (res.status === 404) return { missing: true };
      if (!res.ok) return { error: true };
      return { data: await res.json() };
    } catch (_) {
      return { error: true };
    }
  }

  /** A Hive RPC call as { result }, { missing: true } or { error: true }. */
  async function hiveCallState(method, params) {
    const data = await getJson(HIVE_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
    }).catch(() => null);
    if (!data) return { error: true };
    if (data.error) return isMissingError(data.error) ? { missing: true } : { error: true };
    return { result: data.result };
  }

  async function hiveCall(method, params) {
    return (await hiveCallState(method, params)).result || null;
  }

  const avatarOf = (account) => `https://images.hive.blog/u/${account}/avatar/large`;
  const clip = (text, n = 200) => {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    return t.length > n ? `${t.slice(0, n - 3)}...` : t;
  };
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  // Post markdown as readable text, longer than extractDescription's 200 chars:
  // the body is for search engines, the meta description for cards.
  const plainText = (body, n) => clip(String(body || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#*_~`>]/g, '')
    .replace(/https?:\/\/\S+/g, ''), n);

  /** Which page a URL is, or null. */
  function match(url) {
    const p = url.pathname.replace(/\/+$/, '') || '/';
    // A name no Hive account can have, an id no playlist can have: missing
    // without asking anyone.
    const decode = (v) => { try { return decodeURIComponent(v); } catch (_) { return ''; } };
    let m = p.match(/^\/(?:p|user)\/([^/]+)$/) || p.match(/^\/@([^/]+)(?:\/shorts)?$/);
    if (m) {
      const account = decode(m[1]).toLowerCase();
      return ACCOUNT_RE.test(account) ? { kind: 'profile', account } : { kind: 'missing' };
    }
    m = p.match(/^\/playlist\/([^/]+)$/);
    if (m) return PLAYLIST_ID_RE.test(m[1]) ? { kind: 'playlist', id: m[1] } : { kind: 'missing' };
    m = p.match(/^\/audio\/@?([^/]+)\/([^/]+)$/);
    if (m) {
      const author = decode(m[1]).toLowerCase();
      const permlink = decode(m[2]);
      return ACCOUNT_RE.test(author) && PERMLINK_RE.test(permlink)
        ? { kind: 'audio', author, permlink }
        : { kind: 'missing' };
    }
    return null;
  }

  /** Image for the card: bounded, and a JPEG copy for WhatsApp (no WebP previews). */
  function cardImage(raw, req, origin) {
    let image = boundImage(fixThumbnail(raw));
    let imageType;
    if (/whatsapp/i.test(req.headers['user-agent'] || '')) {
      const jpeg = ogVideo.jpegThumbPath(image);
      if (jpeg) { image = origin + jpeg; imageType = 'image/jpeg'; }
    }
    return { image, imageType };
  }

  function buildHtml({
    title, ogTitle, description, image, imageType, imageSize, imageAlt, url, canonical, ogType = 'website', ogExtra = [],
    twitterCard = 'summary_large_image', video, oembedUrl, jsonLd, noindex, body,
  }) {
    const meta = (prop, content) =>
      (content === undefined || content === null || content === ''
        ? ''
        : `\n  <meta property="${prop}" content="${escapeHtml(String(content))}" />`);
    const videoAbs = video ? escapeHtml(video.url) : '';
    const videoMeta = video
      ? meta('og:video', video.url) + meta('og:video:url', video.url) + meta('og:video:secure_url', video.url)
        + meta('og:video:type', 'video/mp4') + meta('og:video:width', video.width || 1280)
        + meta('og:video:height', video.height || 720)
      : '';
    const twitter = video
      ? `<meta name="twitter:card" content="player" />
  <meta name="twitter:player:stream" content="${videoAbs}" />
  <meta name="twitter:player:stream:content_type" content="video/mp4" />
  <meta name="twitter:player:width" content="${Number(video.width) || 1280}" />
  <meta name="twitter:player:height" content="${Number(video.height) || 720}" />`
      : `<meta name="twitter:card" content="${twitterCard}" />`;
    // One object or several (the page's own entity + its BreadcrumbList).
    const ld = jsonLd
      ? `\n  <script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>`
      : '';
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(title)} - 3Speak</title>
  <meta name="robots" content="${noindex ? 'noindex, follow' : 'index, follow'}" />
  <meta name="description" content="${escapeHtml(description)}" />

  <!-- Open Graph -->${meta('og:type', ogType)}${meta('og:site_name', '3Speak')}${meta('og:title', ogTitle || title)}${
    meta('og:description', description)}${meta('og:image', image)}${meta('og:image:type', imageType)}${
    imageSize ? meta('og:image:width', imageSize[0]) + meta('og:image:height', imageSize[1]) : ''}${meta('og:image:alt', imageAlt)}${
    meta('og:url', url)}${ogExtra.map(([p, c]) => meta(p, c)).join('')}${videoMeta}

  <!-- Twitter Card -->
  ${twitter}
  <meta name="twitter:site" content="@3speaktv" />
  <meta name="twitter:title" content="${escapeHtml(ogTitle || title)}" />
  <meta name="twitter:description" content="${escapeHtml(description)}" />
  <meta name="twitter:image" content="${escapeHtml(image)}" />

  <link rel="canonical" href="${escapeHtml(canonical || url)}" />${
    oembedUrl ? `\n  <link rel="alternate" type="application/json+oembed" href="${escapeHtml(oembedUrl)}" />` : ''}${ld}
</head>
<body>
${body}
</body>
</html>`;
  }

  // ─── Profiles: /p/:user, /user/:user, /@user ───────────────────────────────

  async function profilePage(req, res, page, origin) {
    const { account } = page;
    const [profileState, check, counts, posts, uploads] = await Promise.all([
      hiveCallState('bridge.get_profile', { account, observer: '' }),
      getJson(`${CHECKER_URL}/check/${encodeURIComponent(account)}`).catch(() => null),
      getJson(`${CHECKER_URL}/user/${encodeURIComponent(account)}/counts`).catch(() => null),
      hiveCall('bridge.get_account_posts', { sort: 'posts', account, limit: 20, observer: '' }),
      // The channel's own video list, as its profile page shows it. The Hive
      // posts above are everything the account wrote, so a creator who also
      // blogs had their videos pushed out of a list of 20.
      getJson(`${CHECKER_URL}/api/my-videos?username=${encodeURIComponent(account)}&limit=20&offset=0&status=published&sort=newest`).catch(() => null),
    ]);
    if (profileState.missing) return MISSING;
    const profile = profileState.result;
    if (!profile || !profile.name) return null;
    // A banned creator's channel shows nothing on 3Speak, so the card does not either.
    if (check && check.banned === true) return MISSING;

    const p = (profile.metadata && profile.metadata.profile) || {};
    const displayName = clip(p.name, 60) || account;
    const title = displayName.toLowerCase() === account ? `@${account}` : `${displayName} (@${account})`;

    const videos = Number(counts && counts.videos) || 0;
    const shorts = Number(counts && counts.shorts) || 0;
    const tally = [videos && plural(videos, 'video', 'videos'), shorts && plural(shorts, 'short', 'shorts')]
      .filter(Boolean).join(', ');
    const about = clip(p.about, 160);
    // The card says what the creator says about themselves (their Hive
    // profile), the counts only when they wrote nothing.
    const description = clip(p.about, 200) || (tally ? `${tally} on 3Speak` : `@${account} on 3Speak`);
    // As on the share image: any display name but the handle itself, even one
    // that only capitalises it ('MenO' for meno).
    const shareName = displayName === account || displayName === `@${account}` ? `@${account}` : displayName;
    const ogTitle = `${shareName} on 3speak.tv`;

    const canonical = `${CANONICAL_ORIGIN}/user/${account}`;
    const selfUrl = origin + req.url;
    // The channel's share image (og-cards.cjs: picture, name, @handle), drawn
    // on its first fetch and kept. Only the image: a channel trailer is not
    // put in as an inline player, so every platform shows the same card.
    const image = cardUrl(origin, 'user', account);

    // Their latest uploads, as links for search engines. A post is a video or
    // an audio by its metadata; anything else (an album's own post, text) is not
    // something to link as one.
    const channelVideos = ((uploads && uploads.data && uploads.data.videos) || [])
      .filter((v) => v && v.permlink && v.title && !v.isNsfwContent)
      .map((v) => ({ title: v.title, href: `${origin}/watch?v=${v.author || v.owner || account}/${v.permlink}` }));
    const fromPosts = (Array.isArray(posts) ? posts : [])
      .map((post) => {
        const meta = parseMeta(post.json_metadata);
        const href = meta.audio
          ? `${origin}/audio/${post.author}/${post.permlink}`
          : meta.video ? `${origin}/watch?v=${post.author}/${post.permlink}` : null;
        return href ? { title: post.title || post.permlink, href } : null;
      })
      .filter(Boolean);
    const seen = new Set();
    const latest = [...channelVideos, ...fromPosts]
      .filter((l) => !seen.has(l.href) && seen.add(l.href))
      .slice(0, 20);

    const stats = profile.stats || {};
    const jsonLd = {
      '@context': 'https://schema.org',
      '@type': 'ProfilePage',
      url: canonical,
      mainEntity: {
        '@type': 'Person',
        name: displayName,
        alternateName: `@${account}`,
        identifier: account,
        description: about || undefined,
        image: avatarOf(account),
        url: canonical,
        ...(p.website && /^https?:\/\//i.test(p.website) ? { sameAs: [p.website] } : {}),
        ...(Number(stats.followers) > 0
          ? {
            interactionStatistic: {
              '@type': 'InteractionCounter',
              interactionType: 'https://schema.org/FollowAction',
              userInteractionCount: Number(stats.followers),
            },
          }
          : {}),
      },
    };
    if (profile.created) jsonLd.dateCreated = toIsoDate(profile.created);
    const crumbs = breadcrumbLd([['3Speak', `${CANONICAL_ORIGIN}/`], [title, canonical]]);

    const list = latest.length
      ? `\n  <section>\n    <h2>Latest uploads</h2>\n    <ul>\n${latest
        .map((l) => `      <li><a href="${escapeHtml(l.href)}">${escapeHtml(l.title)}</a></li>`)
        .join('\n')}\n    </ul>\n  </section>`
      : '';
    const body = `  <h1>${escapeHtml(title)}</h1>
  <p>${escapeHtml(about || `@${account} on 3Speak`)}</p>${tally ? `\n  <p>${escapeHtml(tally)}</p>` : ''}${list}`;

    return buildHtml({
      title,
      ogTitle,
      description,
      image,
      imageType: 'image/jpeg',
      imageSize: [1200, 630],
      imageAlt: `${shareName} on 3Speak`,
      url: selfUrl,
      canonical,
      ogType: 'profile',
      ogExtra: [['profile:username', account]],
      jsonLd: [jsonLd, crumbs],
      body,
    });
  }

  // ─── Playlists and albums: /playlist/:id ────────────────────────────────────

  async function playlistPage(req, res, page, origin) {
    // Covers, album details and item titles come from the checker: the playlists
    // API the site reads does not pass covers or album details through. 404 for
    // private playlists, Watch Later and banned owners.
    const cardState = await getJsonState(`${CHECKER_URL}/rss/playlist/${encodeURIComponent(page.id)}/card.json`);
    if (cardState.missing) return MISSING;
    const card = cardState.data;
    if (!card || !card.owner || !card.name) return null;

    const isAlbum = !!card.album;
    const items = Array.isArray(card.items) ? card.items : [];
    const n = Number(card.itemCount) || items.length;
    const noun = card.medium === 'video'
      ? plural(n, 'video', 'videos')
      : card.medium === 'music' || isAlbum ? plural(n, 'track', 'tracks') : plural(n, 'episode', 'episodes');
    const what = isAlbum ? 'An album' : card.medium === 'podcast' ? 'A podcast' : 'A playlist';
    const description = clip(extractDescription(card.description || '')) || `${what} by @${card.owner} on 3Speak · ${noun}`;

    const canonical = `${CANONICAL_ORIGIN}/playlist/${card.id}`;
    const { image, imageType } = cardImage(card.cover || avatarOf(card.owner), req, origin);
    const itemUrl = (i) => (i.kind === 'audio'
      ? `${origin}/audio/${i.author}/${i.permlink}`
      : `${origin}/watch?v=${i.author}/${i.permlink}`);

    const ogType = isAlbum ? 'music.album' : card.medium === 'video' ? 'website' : 'music.playlist';
    const ogExtra = isAlbum
      ? [['music:musician', `${origin}/user/${card.owner}`], ['music:release_date', card.album.year ? String(card.album.year) : null]]
      : [['music:creator', card.medium === 'video' ? null : `${origin}/user/${card.owner}`]];
    items.slice(0, 10).forEach((i) => {
      if (i.kind === 'audio' && ogType !== 'website') ogExtra.push(['music:song', itemUrl(i)]);
    });

    const owner = { '@type': 'Person', name: `@${card.owner}`, url: `${origin}/user/${card.owner}` };
    const jsonLd = isAlbum
      ? {
        '@context': 'https://schema.org',
        '@type': 'MusicAlbum',
        name: card.name,
        url: canonical,
        image,
        description: card.description ? clip(card.description, 500) : undefined,
        byArtist: owner,
        numTracks: n,
        ...(card.album.musicStyle ? { genre: card.album.musicStyle } : {}),
        ...(card.album.year ? { datePublished: String(card.album.year) } : {}),
        track: items.map((i) => ({
          '@type': 'MusicRecording',
          name: i.title,
          url: itemUrl(i),
          ...(secondsToISO8601(i.duration) ? { duration: secondsToISO8601(i.duration) } : {}),
        })),
      }
      : {
        '@context': 'https://schema.org',
        '@type': 'ItemList',
        name: card.name,
        url: canonical,
        image,
        author: owner,
        numberOfItems: n,
        itemListElement: items.map((i, idx) => ({ '@type': 'ListItem', position: idx + 1, url: itemUrl(i), name: i.title })),
      };

    const crumbs = breadcrumbLd([
      ['3Speak', `${CANONICAL_ORIGIN}/`],
      [`@${card.owner}`, `${CANONICAL_ORIGIN}/user/${card.owner}`],
      [card.name, canonical],
    ]);

    const list = items.length
      ? `\n  <section>\n    <h2>${isAlbum ? 'Tracks' : 'In this playlist'}</h2>\n    <ol>\n${items
        .slice(0, MAX_LISTED)
        .map((i) => `      <li><a href="${escapeHtml(itemUrl(i))}">${escapeHtml(i.title || i.permlink)}</a> by @${escapeHtml(i.author)}</li>`)
        .join('\n')}\n    </ol>\n  </section>`
      : '';
    const body = `  <h1>${escapeHtml(card.name)}</h1>
  <p>${escapeHtml(what)} by <a href="${escapeHtml(`${origin}/user/${card.owner}`)}">@${escapeHtml(card.owner)}</a> on 3Speak · ${escapeHtml(noun)}</p>${
    card.description ? `\n  <p>${escapeHtml(clip(card.description, 2000))}</p>` : ''}${list}`;

    return buildHtml({
      title: card.name,
      description,
      image,
      imageType,
      url: origin + req.url,
      canonical,
      ogType,
      ogExtra,
      jsonLd: [jsonLd, crumbs],
      body,
    });
  }

  // ─── Audio posts: /audio/:author/:permlink ─────────────────────────────────

  const isSongDoc = (doc) => !!doc && doc.category === 'song';

  /** The audio doc behind a Hive post, the way the audio page finds it. */
  async function findAudioDoc(author, permlink, post) {
    const owned = await getJson(`${CHECKER_URL}/audio?owner=${encodeURIComponent(author)}&limit=100`).catch(() => null);
    const list = (owned && owned.audio) || [];
    const bare = (v) => String(v || '').split('/').pop();
    let doc = list.find((a) => bare(a.post_permlink) === permlink);
    if (doc) return doc;
    // Not reconciled yet: the post body links the player by the audio's own id.
    const m = post && String(post.body || '').match(/audio\.3speak\.tv\/play\?a=([A-Za-z0-9_-]+)/);
    if (!m) return null;
    doc = list.find((a) => a.permlink === m[1]);
    if (doc) return doc;
    const one = await getJson(`${CHECKER_URL}/audio?owner=${encodeURIComponent(author)}&permlink=${encodeURIComponent(m[1])}&limit=1`).catch(() => null);
    return (one && one.audio && one.audio[0]) || null;
  }

  async function audioPage(req, res, page, origin) {
    const { author, permlink } = page;
    const lookup = await lookupHivePost(author, permlink);
    if (lookup.missing) return MISSING;
    const post = lookup.post;
    if (!post) return null;
    const doc = await findAudioDoc(author, permlink, post);
    const meta = parseMeta(post.json_metadata);
    if (doc && (doc.status && doc.status !== 'published')) return MISSING;

    const indexability = getIndexability(post, meta);
    // The "empty" rule is about thin video posts; a post carrying a real audio
    // file is content however short its text...
    // ...unless nothing on the page says what it is: a voice snap keeps the
    // app's stand-in title ("Audio Snap by x") and often has no caption, which
    // leaves a search engine a name and a player. Kept out, not removed.
    const placeholderTitle = /^audio( snap)? by @?[a-z0-9.-]+$/i.test(String((doc && doc.title) || post.title || '').trim());
    const caption = plainText(post.body, 2000).replace(/\s+/g, ' ').trim();
    const thin = placeholderTitle && caption.length < 30;
    const index = (indexability.index || (indexability.reason === 'empty' && !!doc)) && !thin;

    // The audio's own title first: an album track is a Hive REPLY to the album
    // post, so its post title is "RE: <album post>", not the track's name.
    const title = (doc && doc.title) || post.title || `Audio by @${author}`;
    const fromAlbum = doc && doc.playlist_name ? ` from ${doc.playlist_name}` : '';
    let description = extractDescription(post.body) || clip(doc && doc.description);
    // A track's body is often just its title again, which says nothing new.
    if (!description || description.toLowerCase() === title.toLowerCase()) {
      description = `${isSongDoc(doc) ? 'A song' : 'Audio'}${fromAlbum} by @${author} on 3Speak`;
    }
    const rawImage = (doc && (doc.thumbnail_url || doc.playlist_thumbnail))
      || (Array.isArray(meta.image) && meta.image[0])
      || avatarOf(author);
    const { image, imageType } = cardImage(rawImage, req, origin);
    const canonical = `${CANONICAL_ORIGIN}/audio/${author}/${permlink}`;

    // The MP3 companion when there is one: WebM browser recordings play almost
    // nowhere outside a browser.
    const fmt = String((doc && doc.format) || '').toLowerCase();
    const audio = doc && doc.mp3_cid
      ? { url: `${AUDIO_GATEWAY}/ipfs/${doc.mp3_cid}`, type: 'audio/mpeg' }
      : doc && doc.audio_cid
        ? { url: `${AUDIO_GATEWAY}/ipfs/${doc.audio_cid}`, type: AUDIO_MIME[fmt] || 'audio/mpeg' }
        : null;
    const duration = Math.round(Number((doc && (doc.mp3_duration || doc.duration)) || 0)) || null;
    const isSong = isSongDoc(doc);
    const albumUrl = doc && doc.playlist_id ? `${origin}/playlist/${doc.playlist_id}` : null;

    const ogExtra = [];
    if (audio) {
      ogExtra.push(['og:audio', audio.url], ['og:audio:secure_url', audio.url], ['og:audio:type', audio.type]);
    }
    ogExtra.push(['music:duration', duration], ['music:musician', `${origin}/user/${author}`], ['music:album', albumUrl]);

    const jsonLd = {
      '@context': 'https://schema.org',
      '@type': isSong ? 'MusicRecording' : 'AudioObject',
      name: title,
      description: description || title,
      url: canonical,
      thumbnailUrl: image,
      ...(toIsoDate(post.created) ? { uploadDate: toIsoDate(post.created) } : {}),
      ...(secondsToISO8601(duration) ? { duration: secondsToISO8601(duration) } : {}),
      author: { '@type': 'Person', name: `@${author}`, url: `${origin}/user/${author}` },
    };
    if (audio) {
      if (isSong) {
        jsonLd.byArtist = jsonLd.author;
        jsonLd.audio = { '@type': 'AudioObject', contentUrl: audio.url, encodingFormat: audio.type };
        if (albumUrl) jsonLd.inAlbum = { '@type': 'MusicAlbum', name: doc.playlist_name || undefined, url: albumUrl };
      } else {
        jsonLd.contentUrl = audio.url;
        jsonLd.encodingFormat = audio.type;
      }
    }

    const crumbs = breadcrumbLd([
      ['3Speak', `${CANONICAL_ORIGIN}/`],
      [`@${author}`, `${CANONICAL_ORIGIN}/user/${author}`],
      [title, canonical],
    ]);

    const body = `  <h1>${escapeHtml(title)}</h1>
  <p><a href="${escapeHtml(`${origin}/audio/${author}/${permlink}`)}">${escapeHtml(title)}</a> by <a href="${escapeHtml(`${origin}/user/${author}`)}">@${escapeHtml(author)}</a> on 3Speak${
    albumUrl && doc.playlist_name ? `, from <a href="${escapeHtml(albumUrl)}">${escapeHtml(doc.playlist_name)}</a>` : ''}</p>
  <p>${escapeHtml(plainText(post.body, 2000) || description)}</p>`;

    return buildHtml({
      title,
      description,
      image,
      imageType,
      url: origin + req.url,
      canonical,
      ogType: isSong ? 'music.song' : 'website',
      ogExtra,
      jsonLd: index ? [jsonLd, crumbs] : jsonLd,
      noindex: !index,
      body,
    });
  }

  const HANDLERS = {
    profile: profilePage,
    playlist: playlistPage,
    audio: audioPage,
    missing: async () => MISSING,
  };

  /** Rendered HTML for the page, MISSING, or null when a lookup failed. */
  async function render(req, res, page, origin) {
    return HANDLERS[page.kind](req, res, page, origin);
  }

  return { match, render, MISSING };
};
