import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

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
  plugins: [react(), tailwindcss(), copyRootLogoPlugin()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: true,
  },
});
