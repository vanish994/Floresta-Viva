/**
 * Tileset do pack: garante que as folhas extraídas existem, têm 32×32, cabem no
 * manifesto, o casamento de tom é estável e o render usa o tileset escolhido.
 *
 * Nada aqui baixa/reprocessa o pack: o teste lê as folhas já geradas por
 * `npm run sprites:pack` — se o extrator quebrar, o teste de reprodutibilidade
 * (`--check`) acusa.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PACK_GROUND,
  PACK_GROUND_FILE,
  DEFAULT_TILESET,
  activeTilesetId,
  setActiveTileset,
  PACK_WATER_FILE,
  PACK_WATER_DEEP_FILE,
  PACK_WATER_FRAMES,
  GROUND_TILES,
  GROUND_TILES_FILE,
  allAssetFiles,
  groundRect,
  type Rect,
} from '../src/render/manifest';
import { World } from '../src/world/world';
import { composeScene } from '../src/render/scene';
import { decodePNG, type RGBAImage } from '../tools/png';
import { PIXELLAB_WANG, wangTransition, streamCornerKey } from '../src/render/pixellab';
import { readZip, harmonize, matchTone, stats } from '../tools/extract-pack-tiles';

const ROOT = join(__dirname, '..');
const PACK_ZIP = 'Free asset pack, thank u so much!.zip';

const sheet = (file: string): RGBAImage => decodePNG(readFileSync(join(ROOT, 'assets', file)));

/** luminância média e desvio de um recorte 32×32 */
function luma(img: RGBAImage, r: Rect): { mean: number; sd: number } {
  const v: number[] = [];
  for (let y = 0; y < r[3]; y++) {
    for (let x = 0; x < r[2]; x++) {
      const i = ((r[1] + y) * img.width + (r[0] + x)) * 4;
      v.push(0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2]);
    }
  }
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  return { mean, sd: Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length) };
}

describe('tileset do pack: folhas e manifesto', () => {
  it('1. folhas existem, são 32 px por tile e carregam no jogo', () => {
    const files = allAssetFiles();
    expect(files).toContain(PACK_GROUND_FILE);
    expect(files).toContain(PACK_WATER_FILE);
    expect(files).toContain(PACK_WATER_DEEP_FILE);
    // ...e o tileset antigo continua carregado (A/B possível, nada removido)
    expect(files).toContain(GROUND_TILES_FILE);

    const ground = sheet(PACK_GROUND_FILE);
    expect(ground.height).toBe(32);
    const cells = Object.values(PACK_GROUND).flat();
    for (const r of cells) {
      expect(r[2]).toBe(32);
      expect(r[3]).toBe(32);
      expect(r[0] + r[2]).toBeLessThanOrEqual(ground.width);
      expect(r[1] + r[3]).toBeLessThanOrEqual(ground.height);
    }
    // nenhuma célula repete recorte (variantes de verdade, não cópias)
    const keys = new Set(cells.map((r) => r.join(',')));
    expect(keys.size).toBe(cells.length);

    const water = sheet(PACK_WATER_FILE);
    expect(water.width).toBe(32 * PACK_WATER_FRAMES);
    expect(water.height).toBe(32);
    expect(sheet(PACK_WATER_DEEP_FILE).width).toBe(32 * PACK_WATER_FRAMES);
  });

  it('2. todo tipo de chão tem pelo menos uma variante e o default é o pack', () => {
    for (const kind of ['grass', 'dirt', 'sand', 'snow'] as const) {
      expect(PACK_GROUND[kind].length).toBeGreaterThanOrEqual(1);
      // no mínimo 2 leituras para grama/terra/areia (variação visível)
      if (kind !== 'snow') expect(PACK_GROUND[kind].length).toBeGreaterThanOrEqual(2);
    }
    expect(DEFAULT_TILESET).toBe('pixellab');
    setActiveTileset('pixellab');
    expect(activeTilesetId()).toBe('pixellab');
  });

  it('3. groundRect() alterna entre os dois tilesets sem inventar recorte', () => {
    setActiveTileset('pack');
    const gp = groundRect('grass', 0);
    expect(gp.file).toBe(PACK_GROUND_FILE);
    expect(gp.rect).toEqual(PACK_GROUND.grass[0]);
    // variante fora da faixa não estoura (módulo, inclusive negativo)
    expect(groundRect('grass', 7).rect).toEqual(PACK_GROUND.grass[7 % PACK_GROUND.grass.length]);
    expect(groundRect('grass', -1).rect).toEqual(PACK_GROUND.grass[PACK_GROUND.grass.length - 1]);

    setActiveTileset('harmonious');
    const gh = groundRect('grass', 0);
    expect(gh.file).toBe(GROUND_TILES_FILE);
    expect(gh.rect).toEqual(GROUND_TILES.grass);
    setActiveTileset('pack'); // restaura o padrão do jogo
  });
});

describe('tileset PixelLab: Wang 32×32 ativo no mapa', () => {
  const names = {
    lake: '01_lago_margem',
    forest: '02_margem_chao_floresta',
    grass: '03_chao_grama',
    rock: '04_grama_relevo',
    stream: '05_grama_riacho',
  } as const;

  it('4. cinco folhas Wang têm 16 cantos únicos e recortes 32×32 válidos', () => {
    for (const [id, name] of Object.entries(names) as Array<[keyof typeof names, typeof names[keyof typeof names]]>) {
      const sh = PIXELLAB_WANG[id];
      const img = sheet(sh.file);
      expect(img.width).toBe(128);
      expect(img.height).toBe(128);
      expect(Object.keys(sh.corners)).toHaveLength(16);
      expect(new Set(Object.values(sh.corners).map((r) => r.join(','))).size).toBe(16);
      for (const r of Object.values(sh.corners)) {
        expect(r).toEqual([expect.any(Number), expect.any(Number), 32, 32]);
        expect(r[0] + r[2]).toBeLessThanOrEqual(img.width);
        expect(r[1] + r[3]).toBeLessThanOrEqual(img.height);
      }
      const json = JSON.parse(readFileSync(join(ROOT, 'assets/Tilesets/pixellab', `${name}.json`), 'utf8'));
      expect(Object.keys(json.corners).sort()).toEqual(Object.keys(sh.corners).sort());
    }
  });

  it('5. wangTransition escolhe as quatro fronteiras na cadeia de terreno', () => {
    expect(wangTransition([0, 0, 0, 1])).toEqual({ sheet: 'lake', key: '0001' });
    expect(wangTransition([1, 2, 1, 2])).toEqual({ sheet: 'forest', key: '0101' });
    expect(wangTransition([2, 3, 2, 3])).toEqual({ sheet: 'grass', key: '0101' });
    expect(wangTransition([3, 4, 3, 4])).toEqual({ sheet: 'rock', key: '0101' });
    expect(wangTransition([0, 0, 0, 0])).toEqual({ sheet: 'lake', key: '0000' });
    expect(wangTransition([4, 4, 4, 4])).toEqual({ sheet: 'rock', key: '1111' });
    expect(streamCornerKey([true, false, true, false])).toBe('1010');
  });

  it('6. o tileset PixelLab é o default e as cinco folhas entram no carregador', () => {
    expect(DEFAULT_TILESET).toBe('pixellab');
    setActiveTileset('pixellab');
    expect(activeTilesetId()).toBe('pixellab');
    for (const sh of Object.values(PIXELLAB_WANG)) expect(allAssetFiles()).toContain(sh.file);
  });

  it('7. a cena usa os Wang PixelLab; não desenha o chão/água do pack antigo', () => {
    setActiveTileset('pixellab');
    const allPixelBlits: string[] = [];
    const pixelFiles = new Set(Object.values(PIXELLAB_WANG).map((sh) => sh.file));
    for (const seed of [1337, 4242]) {
      const w = new World({ seed });
      w.requestChunks(0, 0, 0, 0);
      w.pumpGeneration(400);
      for (let i = 0; i < 4; i++) w.update(0);
      const cam = { x: w.playerX - 180, y: w.playerY - 120, w: 360, h: 240 };
      const ops = composeScene(w, cam, { timeMs: 0 }).ops;
      const pixelBlits = ops.filter((op) => op.k === 'blit' && pixelFiles.has(op.img));
      expect(pixelBlits.length).toBeGreaterThan(0);
      allPixelBlits.push(...pixelBlits.map((op) => op.k === 'blit' ? op.img : ''));
      expect(ops.some((op) => op.k === 'blit' && op.img === PACK_GROUND_FILE)).toBe(false);
      expect(ops.some((op) => op.k === 'blit' && op.img === PACK_WATER_FILE)).toBe(false);
      expect(ops.some((op) => op.k === 'blit' && op.img === PACK_WATER_DEEP_FILE)).toBe(false);
      expect(ops.some((op) => op.k === 'blit' && op.img === GROUND_TILES_FILE)).toBe(false);
      for (const op of pixelBlits) {
        if (op.k !== 'blit') continue;
        expect([op.sw, op.sh, op.dw, op.dh]).toEqual([32, 32, 32, 32]);
      }
    }
    // Os seeds gerados cobrem lago, lama, folhiço, grama e riacho. A transição
    // de rocha é garantida pelo mapeador Wang (pode não cair nesta câmera).
    for (const id of ['lake', 'forest', 'grass', 'stream'] as const) {
      expect(allPixelBlits).toContain(PIXELLAB_WANG[id].file);
    }
    expect(wangTransition([3, 4, 3, 4]).sheet).toBe('rock');
  });
});

describe('tileset do pack: casamento de tom (nada de asset "colado")', () => {
  it('4. a paleta do pack fica próxima da paleta atual do jogo', () => {
    const ground = sheet(PACK_GROUND_FILE);
    const old = sheet(GROUND_TILES_FILE);
    const packGrass = luma(ground, PACK_GROUND.grass[0]);
    const oldGrass = luma(old, GROUND_TILES.grass);
    // mesma família de cor (verde) e brilho na mesma faixa
    expect(Math.abs(packGrass.mean - oldGrass.mean)).toBeLessThan(40);
    // e ainda tem TEXTURA (não virou cor chapada)
    expect(packGrass.sd).toBeGreaterThan(1.5);
    // mas não é o ruído cru do pack (que tinha desvio ~3× o do jogo)
    expect(packGrass.sd).toBeLessThan(oldGrass.sd * 3 + 4);

    const packWater = luma(sheet(PACK_WATER_FILE), [0, 0, 32, 32]);
    expect(packWater.sd).toBeGreaterThan(3); // água com onda visível
  });

  it('5. matchTone/harmonize são determinísticos e limitados', () => {
    // textura sintética com faixa segura (sem estourar 0..255 após o ganho)
    const img: RGBAImage = { width: 8, height: 8, data: new Uint8ClampedArray(8 * 8 * 4) };
    for (let i = 0; i < img.data.length; i += 4) {
      const t = (i / 4) % 8;
      img.data[i] = 40 + t * 3;
      img.data[i + 1] = 150 + t * 2;
      img.data[i + 2] = 90 + t;
      img.data[i + 3] = 255;
    }
    const ref = { mean: [40, 160, 80] as [number, number, number], sd: [10, 12, 8] as [number, number, number] };
    const a = matchTone(img, ref);
    const b = matchTone(img, ref);
    expect([...a.data]).toEqual([...b.data]); // determinístico
    const s = stats(a);
    for (let k = 0; k < 3; k++) {
      expect(Math.abs(s.mean[k] - ref.mean[k])).toBeLessThan(3); // casou a média
      expect(s.sd[k]).toBeLessThanOrEqual(ref.sd[k] * 1.4 + 0.5); // não "explode" o contraste
    }
    // fora da faixa: o resultado é preso em 0..255 (nunca NaN/overflow)
    const hot = matchTone(img, { mean: [250, 250, 250], sd: [3, 3, 3] });
    for (let i = 0; i < hot.data.length; i += 4) {
      for (let k = 0; k < 3; k++) {
        expect(hot.data[i + k]).toBeGreaterThanOrEqual(0);
        expect(hot.data[i + k]).toBeLessThanOrEqual(255);
      }
    }
    const h = harmonize(img, { levels: 8 });
    expect([...harmonize(img, { levels: 8 }).data]).toEqual([...h.data]);
    // quantizado: no máximo 8 valores por canal
    const uniq = new Set<number>();
    for (let i = 0; i < h.data.length; i += 4) uniq.add(h.data[i]);
    expect(uniq.size).toBeLessThanOrEqual(8);
  });
});

describe('tileset do pack: render', () => {
  it('6. a cena usa as folhas do tileset ativo (e o antigo continua funcionando)', () => {
    const render = (id: 'pack' | 'harmonious') => {
      setActiveTileset(id);
      const w = new World({ seed: 1337 });
      w.requestChunks(0, 0, 0, 0);
      w.pumpGeneration(300);
      w.update(0);
      const cam = { x: w.playerX - 120, y: w.playerY - 80, w: 240, h: 160 };
      return composeScene(w, cam, { timeMs: 0 }).ops;
    };
    const packOps = render('pack');
    const oldOps = render('harmonious');
    setActiveTileset('pack');

    const blitsOf = (ops: ReturnType<typeof render>, file: string) =>
      ops.filter((op) => op.k === 'blit' && op.img === file).length;
    expect(blitsOf(packOps, PACK_GROUND_FILE)).toBeGreaterThan(0);
    expect(blitsOf(packOps, GROUND_TILES_FILE)).toBe(0);
    expect(blitsOf(oldOps, GROUND_TILES_FILE)).toBeGreaterThan(0);
    expect(blitsOf(oldOps, PACK_GROUND_FILE)).toBe(0);

    // todo blit de chão cabe na folha e é 32×32 desenhado 1:1
    for (const op of packOps) {
      if (op.k !== 'blit' || op.img !== PACK_GROUND_FILE) continue;
      expect(op.sw).toBe(32);
      expect(op.sh).toBe(32);
      expect(op.dw).toBe(32);
      expect(op.dh).toBe(32);
    }
  });

  it('7. o pack está no repositório e é só PNG (nada de binário inesperado)', () => {
    const zip = readZip(readFileSync(join(ROOT, PACK_ZIP)));
    expect(zip.size).toBeGreaterThan(5);
    for (const name of zip.keys()) {
      expect(name.toLowerCase().endsWith('.png')).toBe(true);
    }
    // as pranchas que o extrator usa continuam lá
    for (const f of ['1. Grass and dirt.png', '2. Water.png', '7. Snow.png', '8. Desert.png', '9. Beach.png']) {
      expect([...zip.keys()].some((k) => k.endsWith(f))).toBe(true);
    }
  });
});
