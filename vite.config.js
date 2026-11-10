import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { sentryVitePlugin } from '@sentry/vite-plugin'

// OPS-05: Vercel tells the build whether it is production or preview.
const deployEnv = process.env.VERCEL_ENV || ''
const release = process.env.VERCEL_GIT_COMMIT_SHA || ''
// Source maps go to Sentry only when the build has an auth token, and are then
// deleted from the output so they are never served publicly.
const uploadSourceMaps = Boolean(
  process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT,
)

export default defineConfig({
  define: {
    __APP_DEPLOY_ENV__: JSON.stringify(deployEnv),
    __APP_RELEASE__: JSON.stringify(release),
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // "prompt" keeps the new worker waiting. The UpdatePrompt card (OPS-17)
      // offers it; only a tap on 업데이트 asks it to skip waiting and reload.
      registerType: 'prompt',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png'],
      workbox: {
        skipWaiting: false,
        clientsClaim: false,
        // 멤버 평가 icons (one small file each, 1,500+) are not pre-cached;
        // the few a place uses are cached the first time they are shown.
        globIgnores: ['**/assets/ph/**'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/assets/ph/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'place-icons',
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },
      manifest: {
        name: 'UvA-IN 멤버십',
        short_name: 'UvA-IN',
        description: 'UvA-IN 회원용 멤버십 앱',
        theme_color: '#2563eb',
        background_color: '#ffffff',
        display: 'fullscreen',
        display_override: ['fullscreen', 'standalone'],
        // LEG-10: landscape layouts are supported, so the installed app follows
        // the device rotation instead of being locked to portrait.
        orientation: 'any',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: 'icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
    }),
    uploadSourceMaps && sentryVitePlugin({
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      url: 'https://de.sentry.io/',
      release: release ? { name: release } : undefined,
      sourcemaps: { filesToDeleteAfterUpload: ['./dist/**/*.map'] },
      telemetry: false,
      // A Sentry outage must never block a deploy: warn instead of failing.
      errorHandler: (error) => {
        console.warn('Sentry source map upload failed:', error?.message || error)
      },
    }),
  ].filter(Boolean),
  build: {
    sourcemap: uploadSourceMaps ? 'hidden' : false,
    license: { fileName: 'third-party-licenses.md' },
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // Copyright notice at the top of every app JS file served to browsers
        // (postBanner: added after minification, which strips normal banners).
        postBanner: (chunk) => (chunk.fileName.endsWith('.js')
          ? '/*! (c) 2026 Woojay Lim. Developed for UvA-IN. All rights reserved. Proprietary: no copying, reuse or AI training without written permission. */'
          : ''),
        // On-demand 멤버 평가 icons and their name list go to assets/ph/
        // (not pre-cached). Icons the app itself uses stay in assets/.
        chunkFileNames: (chunk) => (
          (chunk.isDynamicEntry && chunk.facadeModuleId?.includes('/@phosphor-icons/react/dist/csr/') && !chunk.isImplicitEntry)
            || chunk.moduleIds.some((id) => id.includes('/components/icons/phosphorIconLoader'))
            ? 'assets/ph/[name]-[hash].js'
            : 'assets/[name]-[hash].js'
        ),
        manualChunks(id) {
          if (id.includes('node_modules/@supabase')) {
            return 'vendor-supabase'
          }
        },
      },
    },
  },
})
