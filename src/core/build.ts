/**
 * Identificador do build: nome do bundle atual (muda a cada `vite build`).
 * Vai na query dos sprites (`?v=…`) para um deploy novo nunca reutilizar
 * sprite cacheado/404-cacheado no navegador do celular.
 */
export const BUILD_ID = (() => {
  try {
    return new URL(import.meta.url).pathname.split('/').pop() || 'dev';
  } catch {
    return 'dev';
  }
})();
