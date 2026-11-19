import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5180,
    host: '127.0.0.1',
    open: false,
  },
  build: {
    target: 'es2020',
    outDir: 'dist',
    sourcemap: true,
  },
});
