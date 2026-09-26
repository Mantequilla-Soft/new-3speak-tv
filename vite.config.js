import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({
      // Include all modules needed by keychain-sdk and hive crypto libraries
      include: [
        "buffer",
        "stream",
        "crypto",
        "util",
        "process",
        "querystring",
        "events",
        "string_decoder",
        // Add common node modules used by renderers/libs that need browser polyfills
        "os",
        "path",
        "url",
        "source-map-js",
      ],
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
      // Use polyfills even in dev mode
      protocolImports: true,
      // Override to ensure proper Buffer implementation
      overrides: {
        fs: "memfs",
      },
    }),
    VitePWA({
      registerType: "autoUpdate",
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.js",
      // OFF on purpose. Push does not need it: utils/webPush.js falls back to
      // public/push-sw.js (classic, notifications only) at its own scope, which
      // registers in dev in every browser — including Firefox, which cannot
      // evaluate the ES-module dev worker this option would serve. Leaving it
      // off keeps Workbox precaching out of dev, where it only causes stale
      // modules and confusing HMR.
      devOptions: { enabled: false },
      manifest: {
        name: "3Speak",
        short_name: "3Speak",
        description: "3Speak - Decentralized Video Platform",
        theme_color: "#1a1a2e",
        background_color: "#1a1a2e",
        display: "standalone",
        orientation: "portrait-primary",
        start_url: "/",
        categories: ["video", "social", "entertainment"],
        shortcuts: [
          {
            name: "Shorts",
            short_name: "Shorts",
            url: "/shorts",
            icons: [{ src: "/pwa-192x192.png", sizes: "192x192" }],
          },
          {
            name: "Discover",
            short_name: "Discover",
            url: "/discover",
            icons: [{ src: "/pwa-192x192.png", sizes: "192x192" }],
          },
          {
            name: "Upload Video",
            short_name: "Upload",
            url: "/embed-studio",
            icons: [{ src: "/pwa-192x192.png", sizes: "192x192" }],
          },
          {
            name: "Upload Short",
            short_name: "Short",
            url: "/embed-studio?from=shorts",
            icons: [{ src: "/pwa-192x192.png", sizes: "192x192" }],
          },
          {
            name: "Shorts Editor",
            short_name: "Editor",
            url: "/embed-studio",
            icons: [{ src: "/pwa-192x192.png", sizes: "192x192" }],
          },
        ],
        file_handlers: [
          {
            action: "/studio",
            accept: {
              "video/mp4": [".mp4"],
              "video/webm": [".webm"],
              "video/quicktime": [".mov"],
              "video/x-matroska": [".mkv"],
              "video/avi": [".avi"],
            },
          },
          {
            action: "/embed-studio",
            accept: {
              "video/mp4": [".mp4"],
              "video/webm": [".webm"],
              "video/quicktime": [".mov"],
            },
          },
        ],
        share_target: {
          action: "/share-target",
          method: "POST",
          enctype: "multipart/form-data",
          params: {
            title: "title",
            text: "text",
            url: "url",
            files: [
              {
                name: "video",
                accept: ["video/mp4", "video/webm", "video/quicktime", "video/*"],
              },
            ],
          },
        },
        icons: [
          {
            src: "/pwa-192x192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "/pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable",
          },
        ],
      },
      injectManifest: {
        globPatterns: ["**/*.{html,js,css,svg}"],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
      },
    }),
  ],

  define: {
    "process.env": {},
    global: "globalThis",
  },

  resolve: {
    alias: {
      // Ensure browser-compatible versions of Node.js modules
      crypto: "crypto-browserify",
      stream: "stream-browserify",
      util: "util/",
      querystring: "querystring-es3",
      // Force readable-stream to use the polyfilled buffer
      buffer: "buffer",
      // Browser polyfills for node core modules
      path: "path-browserify",
      os: "os-browserify/browser",
      url: "url",
      'source-map-js': 'source-map-js',
    },
    // Enforce a single React instance across the whole graph. Without this,
    // dynamic imports + lazy chunks can resolve through a different React
    // instance than the renderer, causing "Invalid hook call: dispatcher is
    // null" errors when a lazy-loaded component first mounts.
    dedupe: ['react', 'react-dom', '@livekit/components-react', 'livekit-client'],
  },

  optimizeDeps: {
    // Vite 8 pre-bundles with Rolldown, which ignores `esbuildOptions` entirely
    // and warns on startup. The only thing that block set was
    // `define: { global: "globalThis" }`, already covered by the root-level
    // `define` above, so it was dropped rather than ported to rolldownOptions.
    include: [
      "buffer",
      "qrcode.react",
      "hive-auth-wrapper",
      "keychain-sdk",
      "readable-stream",
      // ensure these deps are pre-bundled
      "path-browserify",
      "os-browserify",
      "source-map-js",
      "url",
    ],
    exclude: ["@metamask/providers", "web3"],
  },

  build: {
    commonjsOptions: {
      transformMixedEsModules: true,
    },
    rollupOptions: {
      output: {
        // Split the Hive crypto/wallet stack out of the app chunk. It was one
        // undivided ~8.6 MiB bundle, which had grown past the service worker's
        // precache ceiling, so the app bundle silently stopped being precached
        // and `vite build` started exiting 1.
        //
        // These deps are large, stable, and change far less often than app
        // code, so isolating them also stops every app deploy from
        // invalidating a multi-megabyte download for returning users.
        //
        // React is deliberately NOT split: `resolve.dedupe` above exists
        // because this graph is sensitive to React resolving through more than
        // one path, so it stays where it is.
        manualChunks(id) {
          if (!id.includes("node_modules")) return;

          // Hive chain + the elliptic-curve/crypto primitives it pulls in,
          // plus the node polyfills that only exist to satisfy them.
          if (
            /[\\/]node_modules[\\/](@hiveio[\\/]dhive|dhive|hive-tx|elliptic|secp256k1|bn\.js|hash\.js|asn1\.js|bs58|browserify-[^\\/]+|crypto-browserify|stream-browserify|readable-stream|create-hash|create-hmac|cipher-base|sha\.js|ripemd160|md5\.js|pbkdf2|randombytes|buffer)[\\/]/.test(id)
          ) {
            return "hive-crypto";
          }

          // Wallet adapters: only needed once a user actually authenticates.
          if (
            /[\\/]node_modules[\\/](@aioha|aioha|keychain-sdk|hive-auth-wrapper|@metamask)[\\/]/.test(id)
          ) {
            return "wallet";
          }
        },
      },
    },
  },

  css: {
    devSourcemap: true,
  },

  server: {
    allowedHosts: ["3speak.okinoko.io", "preview.3speak.tv"],
    // preview.3speak.tv is a PUBLIC dev server, so scanners probe it for secrets
    // (.env, .git/config, .htaccess …). Vite's own deny list already covers most
    // of those, but `.htaccess` sits inside the project root with no extension it
    // recognises, so Vite tried to parse it as a module and threw. Transform
    // errors are broadcast over HMR to EVERY connected client, so a bot's probe
    // put a full-screen error overlay in front of whoever was using the site.
    // Deny it (403) instead.
    fs: {
      // Leading **/ matters: these are matched against ABSOLUTE paths, so a bare
      // ".git/**" never matched and Vite happily tried to parse .git/index as a
      // module.
      deny: [".env", ".env.*", "*.{crt,pem}", ".htaccess", "**/.git/**"],
    },
    watch: {
      // Don't watch .git at all. Every commit rewrites .git/index, which woke
      // the watcher, which asked Vite to transform a binary file — and transform
      // errors are broadcast over HMR to EVERY connected client, so committing
      // put a full-screen syntax-error overlay in front of anyone using the site.
      ignored: ["**/.git/**"],
    },
    proxy: {
      // Proxy upload API calls to video.3speak.tv to avoid CORS issues in dev.
      // In production, VITE_UPLOAD_URL should point directly to video.3speak.tv.
      '/upload-api': {
        target: 'https://video.3speak.tv',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/upload-api/, ''),
        configure: (proxy) => {
          // Strip Origin header so video.3speak.tv doesn't reject the request
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.removeHeader('origin');
          });
          // Rewrite Location headers (TUS protocol returns absolute URLs)
          // so the TUS client continues through the proxy
          proxy.on('proxyRes', (proxyRes) => {
            const location = proxyRes.headers['location'];
            if (location && location.includes('video.3speak.tv')) {
              proxyRes.headers['location'] = location.replace(
                /https?:\/\/video\.3speak\.tv/,
                '/upload-api'
              );
            }
          });
        },
      },
      // Proxy image upload to images.3speak.tv to avoid CORS in dev.
      '/image-api': {
        target: 'https://images.3speak.tv',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/image-api/, ''),
      },
      // Snapie chat API (@snapie/chat-client). Same-origin proxy:
      // /snapie-chat/api/chat/* -> https://snapie.io/api/chat/*.
      // snapie.io carries the delegated-verify patch (verified 2026-06-15), so
      // background @threespeak chat signing works against the public service.
      '/snapie-chat': {
        target: 'https://snapie.io',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/snapie-chat/, ''),
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.removeHeader('origin');
          });
        },
      },
    },
  },
});