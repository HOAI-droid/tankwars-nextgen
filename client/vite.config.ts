import { defineConfig } from 'vite';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const BUILD_ID = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);

export default defineConfig({
  base: './',
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  plugins: [
    {
      name: 'version-file',
      closeBundle() {
        mkdirSync(resolve(__dirname, 'dist'), { recursive: true });
        writeFileSync(resolve(__dirname, 'dist/version.json'), JSON.stringify({ id: BUILD_ID }));
      },
    },
  ],
  server: { port: 5173, host: true },
  build: { target: 'es2022' },
});
