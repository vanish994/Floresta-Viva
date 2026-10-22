/**
 * Regressão do deploy no GitHub Pages (subpath): garante o contrato
 * "sprites na raiz do site + URLs relativas" que quebrou uma vez
 * (bundle pedindo ./assets/... => 404 => tela de quadrados no celular).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

describe('contrato de deploy (Pages em subpath)', () => {
  it('vite: base relativa, sprites como publicDir, bundle sem colisão', () => {
    const cfg = read('vite.config.ts');
    expect(cfg).toContain("base: './'");
    expect(cfg).toContain("publicDir: 'assets'");
    expect(cfg).toContain("assetsDir: 'bundle'");
  });

  it('main.ts: base de sprites é a raiz do site (não /assets/)', () => {
    const main = read('src/main.ts');
    expect(main).toContain("const assetBase = './';");
    expect(main).not.toContain('BASE_URL}assets/');
    expect(main).toContain('renderer.load(allAssetFiles(), assetBase)');
  });

  it('CanvasRenderer: base padrão relativa + versão de build na query', () => {
    const r = read('src/render/CanvasRenderer.ts');
    expect(r).toContain("load(files: string[], base = './')");
    expect(r).toContain('?v=${BUILD_ID}');
    expect(r).toContain('failedFiles');
  });

  it('todo sprite do manifesto existe em assets/ (e portanto no dist/)', () => {
    const manifest = read('src/render/manifest.ts');
    const files = [...manifest.matchAll(/'([A-Za-z_0-9/]+\.png)'/g)].map((m) => m[1]);
    expect(files.length).toBeGreaterThan(30);
    for (const f of new Set(files)) {
      expect(readFileSync(join(ROOT, 'assets', f)).length).toBeGreaterThan(0);
    }
  });
});
