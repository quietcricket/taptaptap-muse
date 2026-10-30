import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    rollupOptions: { input: ['index.html', 'studio.html', 'play.html'] },
  },
  server: { proxy: { '/api': 'http://127.0.0.1:8080' } },
});
