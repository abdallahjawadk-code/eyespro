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
          format: 'iife',
          inlineDynamicImports: true,
          entryFileNames: 'assets/[name]-[hash].js',
          chunkFileNames: 'assets/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash][extname]'
        }
      }
    }
  }
});
