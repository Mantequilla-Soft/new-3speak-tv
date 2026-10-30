# nginx: card image cache

The frontend asks for card images under `/img/` (see `src/utils/fixThumbnails.js`):

| Route | What it serves |
|---|---|
| `/img/t/<path>` | a video thumbnail from the image host, cropped to the card (640x360, `?s=p` 360x640) |
| `/img/i/<cid>` | an IPFS thumbnail, cropped the same way (main gateway, then the fallback) |
| `/img/u/<account>/avatar[/small\|medium\|large]` | a Hive avatar |
| `/img/a/<path>` | a profile picture uploaded through 3Speak, square (`?px=64\|128\|512`) |
| `/img/h/<path>` | anything from Hive's image proxy, passed through |
| `/img/c/<path>` | podcast cover art rendered by the checker |

nginx fetches and resizes each image once and keeps it on disk (1 GB, least recently
used goes first), so viewers never wait on the slow original.

## Files

- `image-cache.conf.template`: http context (the cache, the size maps and a
  loopback-only resizer server).
- `image-cache-locations.conf.template`: the `/img/` locations, included inside the
  site's `server { }`.

They are templates: the hosts and ports are placeholders, so nothing here names a
server or holds a secret.

| Placeholder | Meaning |
|---|---|
| `SPK_IMAGES_HOST` | the host 3Speak uploads images to (thumbnails, avatars) |
| `SPK_HIVE_IMAGES_HOST` | Hive's image service (avatars and its `/p/` resize proxy) |
| `SPK_IPFS_HOST` | the IPFS gateway for thumbnails |
| `SPK_IPFS_FALLBACK_HOST` | the IPFS gateway tried when the first one fails |
| `SPK_IMG_CACHE_DIR` | where the cache lives, e.g. `/var/cache/nginx/3speak-img` |
| `SPK_IMG_PORT` | the loopback port of the resizer, e.g. `8095` |
| `SPK_CHECKER_PORT` | the local port of the checker (for `/img/c/`) |

## Install

Needs nginx with `ngx_http_image_filter_module` (Debian/Ubuntu:
`libnginx-mod-http-image-filter`) and a `resolver` in the http context, because the
upstream hosts are variables resolved per request.

Fill in the placeholders with **only** these names listed, so nginx's own `$variables`
stay untouched:

```sh
export SPK_IMAGES_HOST=... SPK_HIVE_IMAGES_HOST=... SPK_IPFS_HOST=... SPK_IPFS_FALLBACK_HOST=... \
       SPK_IMG_CACHE_DIR=/var/cache/nginx/3speak-img SPK_IMG_PORT=8095 SPK_CHECKER_PORT=...
VARS='${SPK_IMAGES_HOST} ${SPK_HIVE_IMAGES_HOST} ${SPK_IPFS_HOST} ${SPK_IPFS_FALLBACK_HOST} ${SPK_IMG_CACHE_DIR} ${SPK_IMG_PORT} ${SPK_CHECKER_PORT}'
envsubst "$VARS" < image-cache.conf.template           > /etc/nginx/conf.d/3speak-img.conf
envsubst "$VARS" < image-cache-locations.conf.template > /etc/nginx/snippets/3speak-img.conf
```

Then add `include snippets/3speak-img.conf;` inside the site's `server { }`, and run
`nginx -t && systemctl reload nginx`.

Keep these templates in step with the running config: a change made on the server
belongs here too.
