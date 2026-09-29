import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { bridgeProxyConfig } from './vite-bridge-proxy';
import { devInfoPlugin } from './vite-dev-info';

export default defineConfig({
  plugins: [react(), devInfoPlugin()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: true,
    allowedHosts: true,
    proxy: bridgeProxyConfig,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  preview: {
    host: true,
    allowedHosts: true,
    proxy: bridgeProxyConfig,
  },
  envPrefix: ['VITE_', 'TAURI_'],
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
    minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_DEBUG,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('monaco-editor') || id.includes('@monaco-editor')) {
            return 'monaco';
          }
        },
      },
    },
  },
  optimizeDeps: {
    include: ['monaco-editor', '@monaco-editor/react'],
  },
});
