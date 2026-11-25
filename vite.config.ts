import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import {
  isValidVapidPrivateKey,
  isValidVapidPublicKey,
  normalizeVapidKey,
} from './api/_lib/pushSanitizer.ts';
import {
  getServerPushConfigDiagnostics,
  parseServiceAccountJson,
} from './api/_lib/pushConfig.ts';
import {
  buildRobotsTxt,
  buildSitemapXml,
  resolveServerPublicOrigin,
} from './api/_lib/siteOrigin.ts';

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

function seoDevEndpointsPlugin(env: Record<string, string>): Plugin {
  const syncEnvForCheck = () => {
    for (const key of [
      'WEB_PUSH_VAPID_PUBLIC_KEY',
      'VITE_WEB_PUSH_VAPID_PUBLIC_KEY',
      'WEB_PUSH_VAPID_PRIVATE_KEY',
      'WEB_PUSH_VAPID_SUBJECT',
      'FIREBASE_SERVICE_ACCOUNT_JSON',
      'FIREBASE_FIRESTORE_DATABASE_ID',
      'PUSH_WEBHOOK_SECRET',
      'VITE_PUBLIC_BASE_URL',
    ]) {
      if (typeof env[key] === 'string' && !process.env[key]) {
        process.env[key] = env[key];
      }
    }
  };

  const resolveLocalPushConfig = (
    reqUrl?: string,
    reqHeaders?: Record<string, string | string[] | undefined>
  ) => {
    syncEnvForCheck();
    const publicKey =
      normalizeVapidKey(env.WEB_PUSH_VAPID_PUBLIC_KEY ?? process.env.WEB_PUSH_VAPID_PUBLIC_KEY) ||
      normalizeVapidKey(env.VITE_WEB_PUSH_VAPID_PUBLIC_KEY ?? process.env.VITE_WEB_PUSH_VAPID_PUBLIC_KEY);
    const privateKey = normalizeVapidKey(
      env.WEB_PUSH_VAPID_PRIVATE_KEY ?? process.env.WEB_PUSH_VAPID_PRIVATE_KEY
    );
    const serviceAccount = parseServiceAccountJson(
      env.FIREBASE_SERVICE_ACCOUNT_JSON ?? process.env.FIREBASE_SERVICE_ACCOUNT_JSON
    );
    const configured =
      isValidVapidPublicKey(publicKey) &&
      isValidVapidPrivateKey(privateKey) &&
      Boolean(serviceAccount);

    let wantsDiagnostics = false;
    if (typeof reqUrl === 'string' && reqUrl.includes('?')) {
      try {
        wantsDiagnostics =
          new URL(reqUrl, 'https://localhost').searchParams.get('diagnostics') === '1';
      } catch {
        wantsDiagnostics = false;
      }
    }

    return {
      configured,
      vapidPublicKey: configured ? publicKey : null,
      ...(wantsDiagnostics
        ? { diagnostics: getServerPushConfigDiagnostics(reqHeaders) }
        : {}),
    };
  };

  const attachMiddleware = (
    middlewares: {
      use: (
        handler: (
          req: { url?: string; headers?: Record<string, string | string[] | undefined> },
          res: {
            statusCode: number;
            setHeader: (name: string, val: string) => void;
            end: (body: string) => void;
          },
          next: () => void
        ) => void
      ) => void;
    }
  ) => {
    middlewares.use((req, res, next) => {
      const pathname = req.url?.split('?')[0];
      if (pathname === '/sitemap.xml') {
        const origin = resolveServerPublicOrigin(req.headers);
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/xml; charset=utf-8');
        res.end(buildSitemapXml(origin));
        return;
      }
      if (pathname === '/robots.txt') {
        const origin = resolveServerPublicOrigin(req.headers);
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end(buildRobotsTxt(origin));
        return;
      }
      if (pathname === '/api/push/config') {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify(resolveLocalPushConfig(req.url, req.headers)));
        return;
      }
      if (pathname === '/api/push/test') {
        const method = (req as { method?: string }).method ?? 'GET';
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        if (method !== 'POST') {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: 'Method not allowed' }));
          return;
        }
        const cfg = resolveLocalPushConfig(req.url, req.headers);
        res.statusCode = 200;
        res.end(
          JSON.stringify({
            ok: false,
            configured: cfg.configured,
            skipped: true,
          })
        );
        return;
      }
      next();
    });
  };

  return {
    name: 'seo-dev-endpoints',
    configureServer(server) {
      attachMiddleware(server.middlewares);
    },
    configurePreviewServer(server) {
      attachMiddleware(server.middlewares);
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
  plugins: [
    react(),
    tailwindcss(),
    copyRootLogoPlugin(),
    seoDevEndpointsPlugin(env),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectRegister: false,
      manifestFilename: 'manifest.webmanifest',
      includeAssets: [
        'favicon.ico',
        'favicon.svg',
        'favicon-16x16.png',
        'favicon-32x32.png',
        'favicon-48x48.png',
        'site.webmanifest',
        'apple-touch-icon.png',
        'og-share.png',
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
        enabled: false,
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
  };
});
