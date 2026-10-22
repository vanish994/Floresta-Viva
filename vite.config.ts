import { defineConfig } from 'vite';

export default defineConfig({
  // base relativo: o build funciona em qualquer subpath (GitHub Pages: /Floresta-Viva/)
  base: './',
  // os sprites do pacote são servidos como arquivos públicos (copiados para a
  // raiz do dist em build e servidos na raiz no dev)
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
  build: {
    target: 'es2022',
    // evita colidir com a pasta de sprites (dist/assets → dist/bundle)
    assetsDir: 'bundle',
  },
});
