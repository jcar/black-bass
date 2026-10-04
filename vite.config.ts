import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { VitePWA } from 'vite-plugin-pwa';

// HTTPS in dev so iOS Safari on the LAN allows service workers / fullscreen testing.
// BASE_PATH is set by the GitHub Pages workflow (site lives at /<repo>/); defaults to root.
export default defineConfig(({ command }) => ({
  base: process.env.BASE_PATH ?? '/',
  plugins: [
    react(),
    command === 'serve' && process.env.NO_SSL !== '1' ? basicSsl() : null,
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.png', 'icons/*.svg'],
      manifest: {
        name: 'Black Bass Pro Tour',
        short_name: 'Bass Tour',
        description: 'Tournament bass fishing for iPhone and iPad.',
        display: 'fullscreen',
        orientation: 'landscape',
        background_color: '#0b1d26',
        theme_color: '#0b1d26',
        start_url: '.',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Generated art/audio are precached so a home-screen install plays fully offline.
        globPatterns: ['**/*.{js,css,html,svg,png,webp,json,mp3,m4a,ogg,wav}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
      },
    }),
  ],
}));
