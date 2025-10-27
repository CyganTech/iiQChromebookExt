import { defineConfig } from 'vite';
import { resolve } from 'path';
import { viteStaticCopy } from 'vite-plugin-static-copy';

const extensionRoot = resolve(__dirname, 'extension');
const srcRoot = resolve(extensionRoot, 'src');

export default defineConfig({
  root: extensionRoot,
  build: {
    outDir: resolve(extensionRoot, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        background: resolve(srcRoot, 'background/index.js'),
        telemetry: resolve(srcRoot, 'background/telemetry.js'),
        popup: resolve(srcRoot, 'popup/index.html'),
        options: resolve(srcRoot, 'options/index.html')
      }
    }
  },
  plugins: [
    viteStaticCopy({
      targets: [
        {
          src: resolve(extensionRoot, 'manifest.json'),
          dest: '.'
        }
      ]
    })
  ]
});
