import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Ensures the root-level ./lasued-intel.webp logo is copied into the
 * production build output directory while remaining in the repository root.
 */
function copyRootLogoPlugin(): Plugin {
  return {
    name: 'copy-root-lasued-intel-logo',
    writeBundle(options) {
      const outDir = options.dir ? path.resolve(options.dir) : path.resolve('dist');
      const source = path.resolve('lasued-intel.webp');
      const destination = path.join(outDir, 'lasued-intel.webp');
      if (fs.existsSync(source)) {
        fs.mkdirSync(outDir, { recursive: true });
        fs.copyFileSync(source, destination);
      }
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    copyRootLogoPlugin(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectRegister: false,
      manifestFilename: 'manifest.webmanifest',
      includeAssets: [
        'apple-touch-icon.png',
        'pwa-192x192.png',
        'pwa-512x512.png',
        'pwa-maskable-512x512.png',
        'offline.html',
      ],
      manifest: {
        id: '/',
        name: 'LASUED Intel',
        short_name: 'LASUED Intel',
        description:
          'LASUED Intel — Your Campus. Your Information. Your Community. A modern student information and community platform.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        display_override: ['standalone', 'minimal-ui'],
        orientation: 'any',
        theme_color: '#0B1A2E',
        background_color: '#FFFFFF',
        categories: ['education', 'social', 'news'],
        icons: [
          {
            src: '/pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/pwa-maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,webp,svg,woff2}'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
      },
      devOptions: {
        enabled: true,
        type: 'module',
        navigateFallback: 'index.html',
      },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (/node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) {
            return 'react-vendor';
          }
          if (/node_modules[\\/](firebase|@firebase)[\\/]/.test(id)) {
            return 'firebase';
          }
          if (/node_modules[\\/]lucide-react[\\/]/.test(id)) {
            return 'lucide';
          }
          return undefined;
        },
      },
    },
  },
  server: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: true,
  },
});
