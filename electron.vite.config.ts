import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') },
        external: ['playwright-core', /^playwright-core\/.+/, 'node-machine-id'],
        output: {
          format: 'cjs',              // CJS required for bytenode V8 bytecode compilation
          inlineDynamicImports: true  // bundle every module into index.cjs so 100% of
                                      // main-process code becomes bytecode — no plaintext chunks
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') }
      }
    }
  },
  renderer: {
    resolve: {
      alias: { '@renderer': resolve(__dirname, 'src/renderer/src') }
    },
    plugins: [react()],
    build: {
      modulePreload: false,
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html')
        },
        output: {
          // ES output (not iife) so the renderer can code-split: the React.lazy()
          // route domains become separate chunks loaded on navigation instead of
          // being inlined into one ~3MB bundle. base is already './' (relative) so
          // chunks resolve under file:// / asar. protect-renderer.cjs obfuscates
          // every emitted .js, so all chunks stay protected.
          format: 'es',
          entryFileNames: 'assets/[name]-[hash].js',
          chunkFileNames: 'assets/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash][extname]',
          manualChunks(id: string) {
            if (!id.includes('node_modules')) return undefined;
            if (id.includes('@tiptap') || id.includes('prosemirror')) return 'editor';
            if (/[\\/]react(-dom|-router|-router-dom)?[\\/]/.test(id) || id.includes('scheduler')) return 'react-vendor';
            return 'vendor';
          }
        }
      }
    }
  }
});
