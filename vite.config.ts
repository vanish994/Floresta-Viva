import { defineConfig } from 'vite';

export default defineConfig({
  // Caminho do projeto no GitHub Pages: https://vanish994.github.io/Floresta-Viva/
  base: '/Floresta-Viva/',
  // Os sprites do jogo ficam em /assets e precisam ser copiados para o build.
  publicDir: 'assets',
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
