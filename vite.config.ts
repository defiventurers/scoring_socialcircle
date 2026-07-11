import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import {copyFileSync, mkdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {defineConfig, type Plugin} from 'vite';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(projectRoot, 'dist');

// These files are loaded by index.html as classic browser scripts or by the
// browser directly. Vite does not emit classic scripts from the project root,
// so copy them into dist explicitly for Vercel production deployments.
const staticFiles = [
  'app.js',
  'fixtures.js',
  'firebase-config.js',
  'manifest.json',
  'service-worker.js',
  'styles.css',
];

function copyStaticFiles(): Plugin {
  return {
    name: 'copy-static-files',
    closeBundle() {
      mkdirSync(outDir, {recursive: true});

      for (const file of staticFiles) {
        copyFileSync(
          path.resolve(projectRoot, file),
          path.resolve(outDir, file),
        );
      }
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), copyStaticFiles()],
    resolve: {
      alias: {
        '@': projectRoot,
      },
    },
    build: {
      outDir: 'dist',
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
