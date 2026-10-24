/**
 * Importa os tilesets **Wang (4×4, 16 cantos)** do pacote "Floresta completa —
 * PixelLab" (`Floresta_completa_PixelLab.zip`, na raiz do repositório).
 *
 * Diferente do pack anterior, este já vem no formato do jogo: tiles de **32×32
 * nativos** e metadados de autotiling (cada tile declara os 4 cantos
 * NW/NE/SW/SE como `upper` ou `lower`). O que este extrator faz:
 *
 *  1. lê o zip direto do repositório (nada é copiado para `assets/` além do
 *     que o jogo realmente usa);
 *  2. monta, por folha, o mapa `cantos (NW+NE+SW+SE) → recorte`;
 *  3. mede a diferença de luminância topo/base para diagnóstico de peças 2,5D;
 *     NÃO remove tiles: a lombada escura é uma emenda válida entre terrenos;
 *  4. valida que os 16 cantos existem (Wang completo) — sem isso o autotiling
 *     deixaria buracos;
 *  5. grava a folha original (128×128) e seu JSON de cantos em
 *     `assets/Tilesets/pixellab/`; o render lê as tabelas de cantos desses
 *     metadados (sem criar spritesheets duplicadas).
 *
 * Uso: npx tsx tools/import-pixellab-tiles.ts [--verbose]
 * Saída:
 *   assets/Tilesets/pixellab/<sheet>.png + .json   (folha 4×4 original, 128×128)
 *   assets/Tilesets/pixellab/index.json            (mapa de todas as folhas)
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { decodePNG, encodePNG, type RGBAImage } from './png';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const PACK_ZIP = 'Floresta_completa_PixelLab.zip';
const TILE = 32;

/** leitor mínimo de ZIP (deflate/stored) — não extrai o pacote inteiro */
export function readZip(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('ZIP inválido: EOCD não encontrado');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + compSize);
    out.set(name, method === 0 ? Buffer.from(raw) : inflateRawSync(raw));
  }
  return out;
}

/** chave canônica dos cantos: NW, NE, SW, SE — nesta ordem, 1 = upper */
export type CornerKey = string;

export interface WangSheet {
  id: string;
  file: string;
  lower: string;
  upper: string;
  /** canto (4 bits "NW NE SW SE", 1 = upper) → recorte na folha */
  corners: Record<CornerKey, [number, number, number, number]>;
}

interface MetaTile {
  id: string;
  corners: Record<'NW' | 'NE' | 'SW' | 'SE', string>;
  bounding_box: { x: number; y: number; width: number; height: number };
}

interface Meta {
  id: string;
  name: string;
  lower_description: string;
  upper_description: string;
  tile_size: { width: number; height: number };
  tileset_data: { tiles: MetaTile[]; total_tiles: number };
}

/** "NW NE SW SE" → chave de bits (1 = upper) */
export function cornerKey(t: MetaTile): CornerKey {
  return (['NW', 'NE', 'SW', 'SE'] as const).map((k) => (t.corners[k] === 'upper' ? '1' : '0')).join('');
}

/**
 * Detecta tile em **2,5D**: o que delata é a BASE muito mais escura que o topo
 * (bloco de terra/rocha embaixo do "chão"). Medir a média do tile inteiro não
 * serve — tiles de água e de folhiço são escuros por natureza e foram
 * descartados por engano na primeira tentativa.
 *
 * Devolve a diferença de luminância média entre a faixa de cima e a de baixo.
 */
export function bottomDrop(img: RGBAImage, x: number, y: number): number {
  const band = (y0: number, y1: number) => {
    let sum = 0;
    let n = 0;
    for (let py = y0; py < y1; py++) {
      for (let px = 0; px < TILE; px++) {
        const i = ((y + py) * img.width + (x + px)) * 4;
        sum += 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
        n++;
      }
    }
    return sum / n;
  };
  const top = band(0, Math.floor(TILE / 3));
  const bottom = band(Math.floor((TILE * 2) / 3), TILE);
  return top - bottom;
}

function main(): void {
  const verbose = process.argv.includes('--verbose');
  const zip = readZip(readFileSync(join(ROOT, PACK_ZIP)));
  const sheets = [...zip.keys()].filter((k) => /\/tilesets\/\d+_.*\.png$/.test(k)).sort();
  if (sheets.length === 0) throw new Error('nenhuma folha de tileset encontrada no zip');

  const outDir = join(ROOT, 'assets/Tilesets/pixellab');
  mkdirSync(outDir, { recursive: true });
  const index: Array<{ id: string; file: string; tile: number; lower: string; upper: string }> = [];

  for (const pngPath of sheets) {
    const id = pngPath.split('/').pop()!.replace(/\.png$/, '');
    const jsonPath = pngPath.replace('/tilesets/', '/metadata/').replace(/\.png$/, '.json');
    const png = zip.get(pngPath);
    const json = zip.get(jsonPath);
    if (!png || !json) {
      console.warn(`  !! ${id}: faltou ${png ? 'metadados' : 'imagem'} — folha ignorada`);
      continue;
    }
    const img = decodePNG(png);
    const meta = JSON.parse(json.toString('utf8')) as Meta;
    const tiles = meta.tileset_data.tiles;
    if (meta.tile_size.width !== TILE || meta.tile_size.height !== TILE) {
      console.warn(`  !! ${id}: tiles de ${meta.tile_size.width}×${meta.tile_size.height}, esperado ${TILE} — ignorada`);
      continue;
    }

    const corners: Record<CornerKey, [number, number, number, number]> = {};
    let duplicated = 0;
    let rocky = 0;
    for (const t of tiles) {
      const key = cornerKey(t);
      const box = t.bounding_box;
      if (box.width !== TILE || box.height !== TILE) continue;
      if (x(corners[key], key)) duplicated++;
      // NÃO se descarta por desenho: a borda inferior mais escura é a "lombada"
      // que o próprio tileset Wang usa para ligar chão e margem — jogar fora o
      // tile cria descasamento (dois cantos apontando para o mesmo recorte).
      // Só registramos a medida para quem for calibrar o autotile.
      const drop = bottomDrop(img, box.x, box.y);
      if (drop > 42) rocky++;
      corners[key] = [box.x, box.y, TILE, TILE];
    }
    const missing = 16 - Object.keys(corners).length;
    if (missing > 0) {
      // Wang incompleto: o autotile deixaria buraco. Completa com o vizinho mais
      // próximo em nº de bits (mesma "família" de canto) — decisão declarada.
      const keys = Object.keys(corners);
      for (let mask = 0; mask < 16; mask++) {
        const k = mask.toString(2).padStart(4, '0');
        if (corners[k]) continue;
        let best = keys[0];
        let bestD = 9;
        for (const cand of keys) {
          const d = [...k].reduce((s, c, i) => s + (c === cand[i] ? 0 : 1), 0);
          if (d < bestD) {
            bestD = d;
            best = cand;
          }
        }
        if (best) corners[k] = corners[best];
      }
    }

    writeFileSync(join(outDir, `${id}.png`), encodePNG(img));
    const data: WangSheet = {
      id,
      file: `Tilesets/pixellab/${id}.png`,
      lower: meta.lower_description,
      upper: meta.upper_description,
      corners,
    };
    writeFileSync(join(outDir, `${id}.json`), `${JSON.stringify(data, null, 2)}\n`);
    index.push({ id, file: data.file, tile: TILE, lower: data.lower, upper: data.upper });
    if (verbose || missing || duplicated || rocky) {
      console.log(
        `  ${id}: ${Object.keys(corners).length}/16 cantos` +
        `${duplicated ? ` | ${duplicated} duplicado(s)` : ''}` +
        `${rocky ? ` | ${rocky} com base escura (medidos e mantidos)` : ''}` +
        `${missing ? ` | ${missing} completado(s) pelo vizinho` : ''}`,
      );
    }
    void x;
  }

  writeFileSync(
    join(outDir, 'index.json'),
    `${JSON.stringify(
      {
        pack: PACK_ZIP,
        tile: TILE,
        pattern: '4×4 Wang (16 cantos NW/NE/SW/SE, 1 = upper)',
        sheets: index,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`gravado assets/Tilesets/pixellab/ (${index.length} folhas + index.json)`);
}

/** helper só para contar chaves duplicadas (mantém a leitura simples) */
function x(_v: unknown, _k: string | undefined): boolean {
  return _v !== undefined;
}

if (process.argv[1] && process.argv[1].endsWith('import-pixellab-tiles.ts')) main();
