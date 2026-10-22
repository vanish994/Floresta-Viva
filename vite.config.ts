import { defineConfig } from 'vite';

export default defineConfig({
  // Caminho do projeto no GitHub Pages: https://vanish994.github.io/Floresta-Viva/
  base: '/Floresta-Viva/',
  server: {
    host: '0.0.0.0',
    // o preview do Arena usa um host proxyado arbitrário
    allowedHosts: true,
  },
  preview: {
    host: '0.0.0.0',
    allowedHosts: true,
  },
  build: { target: 'es2022' },
});
