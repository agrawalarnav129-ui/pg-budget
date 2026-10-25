/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // Relative base so the build works on GitHub Pages sub-paths as well as Netlify roots.
  base: './',
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/apple-touch-icon.png', 'icons/favicon.svg'],
      manifest: {
        name: 'PG Budget',
        short_name: 'PG Budget',
        description: 'Track spends, see where your money goes, and know how much to save.',
        theme_color: '#0f766e',
        background_color: '#f6f5f2',
        display: 'standalone',
        orientation: 'portrait',
        start_url: './',
        scope: './',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // The pdfjs worker is 1.2MB and only needed when importing a PDF statement, so
        // fetch it on first use and keep it cached rather than adding it to the install.
        runtimeCaching: [
          {
            urlPattern: /pdf\.worker.*\.mjs$/,
            handler: 'CacheFirst',
            options: { cacheName: 'pdfjs-worker', expiration: { maxEntries: 3 } },
          },
        ],
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
