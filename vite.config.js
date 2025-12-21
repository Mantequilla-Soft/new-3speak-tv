import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";

export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({
      // Include all modules needed by keychain-sdk and hive crypto libraries
      include: ["buffer", "stream", "crypto", "util", "process", "querystring", "events", "string_decoder"],
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
      // Use polyfills even in dev mode
      protocolImports: true,
      // Override to ensure proper Buffer implementation
      overrides: {
        fs: 'memfs',
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
    },
  },
  optimizeDeps: {
    esbuildOptions: {
      define: {
        global: "globalThis",
      },
      // Inject Buffer shim at the top of every file
      inject: ['./src/polyfills.js'],
    },
    // Force these to be pre-bundled together so polyfills are available
    include: [
      "buffer",
      "react-quilljs", 
      "quill", 
      "qrcode.react", 
      "hive-auth-wrapper",
      "keychain-sdk",
      "readable-stream",
    ],
    exclude: ['@metamask/providers', 'web3'],
  },
  build: {
    commonjsOptions: {
      transformMixedEsModules: true, // Helps with CJS/ESM interop
    },
  },

  // ✅ Add this block to enable SCSS source maps
  css: {
    devSourcemap: true,
  },
});
