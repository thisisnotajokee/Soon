// @ts-nocheck
import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: 'src',
  publicDir: '../public',
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: process.env.VITE_API_URL || 'http://127.0.0.1:3100', changeOrigin: true },
      '/trackings': { target: process.env.VITE_API_URL || 'http://127.0.0.1:3100', changeOrigin: true },
      '/products': { target: process.env.VITE_API_URL || 'http://127.0.0.1:3100', changeOrigin: true },
      '/automation': { target: process.env.VITE_API_URL || 'http://127.0.0.1:3100', changeOrigin: true },
      '/self-heal': { target: process.env.VITE_API_URL || 'http://127.0.0.1:3100', changeOrigin: true },
      '/metrics': { target: process.env.VITE_API_URL || 'http://127.0.0.1:3100', changeOrigin: true },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    strictPort: true,
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'src/index.html'),
        sw: resolve(__dirname, 'src/sw.ts'),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'sw') return 'sw.js';
          return 'assets/[name]-[hash].js';
        },
      },
    },
  },
});
