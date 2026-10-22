/**
 * Geração determinística de chunks.
 *
 * Tudo deriva de coordenadas globais + seed: dois chunks gerados em qualquer
 * ordem produzem exatamente o mesmo conteúdo nas regiões compartilhadas, e
 * objetos pertencem ao chunk que contém sua célula-âncora (sem duplicatas nas
 * fronteiras).
 */
import type { WorldConfig } from '../core/config';
import { hash1, hash2, clamp, smoothstep, lerp } from '../core/rng';
import { cellToTile } from '../core/coords';
import { WorldFields, type DeltaAt } from './fields';
import { solveHydrology } from './hydro';
import { Chunk, SOIL_ALLUVIAL, SOIL_FOREST } from './chunk';
import { SPECIES, type PlantRecord } from './flora';
import type { Climate } from './climate';

export interface GenContext {
  cfg: WorldConfig;
  fields: WorldFields;
  climate: Climate;
  deltaAt: DeltaAt;
}

/** espécie dominante esperada para o micro-sítio (usada nas regras de placement) */
function bestGuessSpecies(
  cfg: WorldConfig,
  fields: WorldFields,
  chunk: Chunk,
  i: number,
  moisture: number,
  light: number,
  tempMean: number,
): number {
  void cfg; void fields;
  let best = 0, bestScore = -1;
  for (let sp = 0; sp < SPECIES.length; sp++) {
    const score = speciesSuitability(sp, moisture, chunk.soilType[i], light, tempMean);
    if (score > bestScore) {
      bestScore = score;
      best = sp;
    }
  }
  return best;
}

/** idoneidade 0..1 de uma espécie às condições locais */
export function speciesSuitability(
  sp: number,
  moisture: number,
  soilType: number,
  light: number,
  tempMean: number,
): number {
  const s = SPECIES[sp];
  const water = 1 - clamp(Math.abs(moisture - s.waterNeed) / 0.55, 0, 1);
  const soil = s.soilAffinity[soilType === 3 ? 1 : soilType === 4 ? 1 : soilType] ?? 0.5;
  const lightFit = 1 - clamp(Math.abs(light - s.lightNeed) / 0.9, 0, 1);
  const temp = clamp(1 - Math.abs(tempMean - s.tempOpt) / 16, 0, 1) * (tempMean > s.tempMin ? 1 : 0.05);
  return clamp(water * 0.4 + soil * 0.2 + lightFit * 0.2 + temp * 0.2, 0, 1);
}

export function generateChunk(ctx: GenContext, cx: number, cy: number): Chunk {
  const { cfg, fields, climate, deltaAt } = ctx;
  const chunk = new Chunk(cx, cy, cfg);
  const n = chunk.n;
  const gx0 = cx * n;
  const gy0 = cy * n;
  const wet = climate.meanWetness();

  const hydro = solveHydrology(fields, cfg, deltaAt, wet, gx0, gy0, n, n);

  for (let ly = 0; ly < n; ly++) {
    for (let lx = 0; lx < n; lx++) {
      const i = chunk.cellIdx(lx, ly);
      const gx = gx0 + lx, gy = gy0 + ly;
      const e = fields.elevation(gx, gy, deltaAt);
      const { slope, aspect } = fields.slopeAspect(gx, gy, deltaAt);
      chunk.elev[i] = e;
      chunk.slope[i] = slope;
      chunk.aspect[i] = aspect;
      chunk.waterDepth[i] = hydro.waterDepth[i];
      chunk.waterKind[i] = hydro.waterKind[i];
      chunk.acc[i] = hydro.acc[i];
      chunk.flowDir[i] = hydro.flowDir[i];

      const wtElev = fields.waterTable(gx, gy, wet) * cfg.elevationRange;
      const parent = fields.soilParent(gx, gy);
      const forest = fields.forestDensity(gx, gy, wet);
      const nearWater = hydro.waterDepth[i] > 0.05 || hydro.acc[i] > cfg.streamThreshold * 0.5;
      let soil = parent;
      if (nearWater) soil = SOIL_ALLUVIAL;
      else if (forest > 0.5 && parent !== 2) soil = SOIL_FOREST;
      chunk.soilType[i] = soil;
      chunk.soilDepth[i] = fields.soilDepth(gx, gy) + (soil === SOIL_ALLUVIAL ? 0.3 : 0);

      // umidade inicial: proximidade do lençol + retenção do solo
      const retention = soil === 0 ? 0.6 : soil === 1 ? 1.0 : soil === 2 ? 0.45 : 1.15;
      const wetness = smoothstep(9, 0, e - wtElev) * 0.7 + wet * 0.35 * retention;
      chunk.moisture[i] = clamp(wetness + (hydro.waterDepth[i] > 0 ? 0.4 : 0), 0.04, 0.98);

      // estado inicial de equilíbrio do solo (não zera: o mundo nasce coerente)
      const litter0 = forest * 2.4 * retention + 0.2;
      chunk.litter[i] = litter0;
      chunk.humus[i] = 1.2 + forest * 3.4 + (soil === SOIL_ALLUVIAL ? 0.8 : 0);
      chunk.nAvail[i] = 0.35 + chunk.humus[i] * 0.11;
      chunk.pAvail[i] = 0.1 + (soil === 2 ? 0.06 : 0.04) + chunk.humus[i] * 0.02;
      chunk.kAvail[i] = 0.3 + chunk.humus[i] * 0.06 + (soil === SOIL_ALLUVIAL ? 0.15 : 0);
      chunk.pH[i] = [6.2, 6.6, 7.2, 5.8, 6.8][soil] + (hash2(cfg.seed, gx, gy, 41) - 0.5) * 0.5;
      chunk.microbe[i] = clamp(0.25 + chunk.moisture[i] * 0.5 + forest * 0.25, 0.05, 1);
      chunk.stress[i] = 0;
    }
  }

  // --- tiles: variação de chão, trilhas e bordas de penhasco ---
  const t = chunk.tiles;
  const elevNorm = (tx: number, ty: number) => {
    const cellX = gx0 * cfg.simCellTiles + tx; // tile global
    const cellY = gy0 * cfg.simCellTiles + ty;
    const cX = Math.floor(cellX / cfg.simCellTiles) - gx0;
    const cY = Math.floor(cellY / cfg.simCellTiles) - gy0;
    return chunk.elev[chunk.cellIdx(clamp(cX, 0, n - 1), clamp(cY, 0, n - 1))] / cfg.elevationRange;
  };
  for (let ty = 0; ty < t; ty++) {
    for (let tx = 0; tx < t; tx++) {
      const ti = chunk.tileIdx(tx, ty);
      const gtx = cx * cfg.chunkTiles + tx;
      const gty = cy * cfg.chunkTiles + ty;
      chunk.groundVariant[ti] = Math.floor(hash2(cfg.seed, gtx, gty, 91) * 4);
      const trail = fields.trailField(gtx / cfg.simCellTiles, gty / cfg.simCellTiles) * 1.25;
      const cX = clamp(Math.floor(gtx / cfg.simCellTiles) - gx0, 0, n - 1);
      const cY = clamp(Math.floor(gty / cfg.simCellTiles) - gy0, 0, n - 1);
      const ci = chunk.cellIdx(cX, cY);
      const walkable = chunk.waterDepth[ci] < 0.12 && chunk.slope[ci] < 2.2;
      chunk.trail[ti] = walkable ? Math.round(trail * 255) : 0;

      // bordas íngremes (para tiles de penhasco): compara elevação entre células vizinhas
      const e0 = elevNorm(tx, ty);
      let bits = 0;
      const dS = e0 - elevNorm(tx, ty + cfg.simCellTiles);
      const dW = e0 - elevNorm(tx - cfg.simCellTiles, ty);
      const dE = e0 - elevNorm(tx + cfg.simCellTiles, ty);
      const dSW = e0 - elevNorm(tx - cfg.simCellTiles, ty + cfg.simCellTiles);
      const dSE = e0 - elevNorm(tx + cfg.simCellTiles, ty + cfg.simCellTiles);
      const TH = 0.045;
      if (dS > TH) bits |= 1;
      if (dSW > TH * 1.2) bits |= 2;
      if (dSE > TH * 1.2) bits |= 4;
      if (dW > TH) bits |= 8;
      if (dE > TH) bits |= 16;
      chunk.cliff[ti] = bits;
    }
  }

  // --- vegetação: composição em múltiplas escalas ---
  const tilePx = cfg.tileSize;
  const cellPx = cfg.simCellTiles * tilePx;
  const tempMean = 17;
  for (let ly = 0; ly < n; ly++) {
    for (let lx = 0; lx < n; lx++) {
      const i = chunk.cellIdx(lx, ly);
      const gx = gx0 + lx, gy = gy0 + ly;
      const forest = fields.forestDensity(gx, gy, wet);
      const moisture = chunk.moisture[i];
      const light = clamp(1 - forest * 0.85, 0.08, 1);
      // manchas finas de densidade: bosques coesos e vazios irregulares
      const clusterRaw = fields.noise.fbm2(gx * 0.085, gy * 0.085, 3, 0.55, 2, 101) * 0.5 + 0.5;
      const cluster = smoothstep(0.3, 0.72, clusterRaw);
      const density = forest * (0.06 + 2.1 * cluster);
      // coorte de idade: manchas de árvores com idades parecidas (clareiras de regeneração)
      const cohort = fields.noise.fbm2(gx * 0.045, gy * 0.045, 2, 0.5, 2, 107) * 0.5 + 0.5;
      const slots = cfg.maxTreesPerCell * 2;
      for (let slot = 0; slot < slots; slot++) {
        if (hash2(cfg.seed, gx * 7 + slot, gy * 3 - slot, 51) > density * 0.5) continue;
        const h1 = hash2(cfg.seed, gx * 31 + slot, gy, 52);
        const h2 = hash2(cfg.seed, gx, gy * 37 + slot, 53);
        // jitter amplo (até ~1.7 células): elimina o padrão de grade; a célula
        // âncora continua sendo esta, então não há duplicatas nas fronteiras
        const px = (cellToTile(gx, cfg) + 0.5 * cfg.simCellTiles + (h1 - 0.5) * cfg.simCellTiles * 1.7) * tilePx;
        const py = (cellToTile(gy, cfg) + 0.5 * cfg.simCellTiles + (h2 - 0.5) * cfg.simCellTiles * 1.7) * tilePx;
        // amostra o tile local para regras de micro-sítio
        const ltx = clamp(Math.floor(px / tilePx) - cx * cfg.chunkTiles, 0, t - 1);
        const lty = clamp(Math.floor(py / tilePx) - cy * cfg.chunkTiles, 0, t - 1);
        const ti = chunk.tileIdx(ltx, lty);
        // tolerância a inundação por espécie: ripárias aceitam margem alagada
        const floodOk = SPECIES[bestGuessSpecies(cfg, fields, chunk, i, moisture, light, tempMean)].floodTolerance;
        if (chunk.waterDepth[i] > 0.1 + floodOk * 0.35 && h1 > 0.15) continue;
        if (chunk.trail[ti] > 150) continue; // trilhas ficam livres
        if (chunk.slope[i] > 2.6) continue;
        // escolha de espécie por idoneidade (manchas compatíveis → bosques coerentes)
        let best = -1, bestScore = -1;
        for (let sp = 0; sp < SPECIES.length; sp++) {
          const stand = hash2(cfg.seed ^ (sp * 7919), Math.floor(gx / 5), Math.floor(gy / 5), 54);
          const score = speciesSuitability(sp, moisture, chunk.soilType[i], light, tempMean) * (0.45 + 0.55 * stand);
          if (score > bestScore) {
            bestScore = score;
            best = sp;
          }
        }
        if (bestScore < 0.22) continue;
        const sp = SPECIES[best];
        const id = hashId(cfg.seed, gx, gy, slot);
        chunk.plants.push({
          id,
          species: best,
          x: px,
          y: py,
          birthAge: Math.floor((cohort * 0.55 + hash2(cfg.seed, gx + slot, gy - slot, 55) * 0.45) * sp.longevity * 0.9),
          variant: Math.floor(hash2(cfg.seed, gx - slot, gy + slot, 56) * 997),
          origin: 'gen',
        } satisfies PlantRecord);
      }

      // --- marcos paisagísticos: bosques de árvores gigantes + afloramentos ---
      const landmark = smoothstep(0.7, 0.86, fields.noise.ridge2(gx * 0.02, gy * 0.02, 3, 201));
      if (landmark > 0.4 && chunk.waterDepth[i] < 0.2 && chunk.slope[i] < 1.8 && hash2(cfg.seed, gx, gy, 202) < landmark * 0.5) {
        const hx = hash2(cfg.seed, gx, gy, 203), hy = hash2(cfg.seed, gx, gy, 204);
        const spIdx = hash2(cfg.seed, gx, gy, 205) < 0.5 ? 1 : 3; // jequitibá ou araucária
        const spL = SPECIES[spIdx];
        chunk.plants.push({
          id: hashId(cfg.seed, gx + 9000, gy - 9000, 0),
          species: spIdx,
          x: (cellToTile(gx, cfg) + hx * cfg.simCellTiles) * tilePx,
          y: (cellToTile(gy, cfg) + hy * cfg.simCellTiles) * tilePx,
          birthAge: Math.floor(spL.longevity * (0.5 + hash2(cfg.seed, gx, gy, 206) * 0.4)),
          variant: Math.floor(hash2(cfg.seed, gx, gy, 207) * 997),
          origin: 'gen',
        });
        if (hash2(cfg.seed, gx, gy, 208) < 0.5) {
          chunk.decor.push({
            kind: `rock_${1 + Math.floor(hash2(cfg.seed, gx, gy, 209) * 6)}`,
            x: (cellToTile(gx, cfg) + hy * cfg.simCellTiles) * tilePx,
            y: (cellToTile(gy, cfg) + hx * cfg.simCellTiles) * tilePx,
            variant: Math.floor(hash2(cfg.seed, gx, gy, 210) * 997),
            flip: false,
            layer: 1,
          });
        }
      }

      // --- detalhes de superfície (escala fina, só depois da composição maior) ---
      const openness = 1 - forest;
      const decorBudget = 3;
      let placed = 0;
      const push = (kind: string, hx: number, hy: number, layer: 0 | 1, ch: number) => {
        if (placed >= decorBudget) return;
        const a = hash2(cfg.seed, gx * 13 + placed, gy, ch);
        const b = hash2(cfg.seed, gx, gy * 17 + placed, ch + 1);
        const x = (cellToTile(gx, cfg) + hx * cfg.simCellTiles + a * 1.6) * tilePx;
        const y = (cellToTile(gy, cfg) + hy * cfg.simCellTiles + b * 1.6) * tilePx;
        const ltx = clamp(Math.floor(x / tilePx) - cx * cfg.chunkTiles, 0, t - 1);
        const lty = clamp(Math.floor(y / tilePx) - cy * cfg.chunkTiles, 0, t - 1);
        if (chunk.waterDepth[i] > 0.1) return;
        chunk.decor.push({
          kind,
          x,
          y,
          variant: Math.floor(hash2(cfg.seed, gx + placed, gy + placed, ch + 2) * 997),
          flip: hash2(cfg.seed, gx, gy, ch + 3) > 0.5,
          layer,
        });
        placed++;
      };
      // serrapilheira e galhos sob copa
      if (forest > 0.3 && hash2(cfg.seed, gx, gy, 61) < forest * 0.95) {
        push(hash2(cfg.seed, gx, gy, 62) < 0.55 ? 'leaves_1' : 'leaves_2', 0.2, 0.2, 0, 63);
      }
      if (forest > 0.3 && hash2(cfg.seed, gx, gy, 64) < 0.3) {
        push(`sticks_${1 + Math.floor(hash2(cfg.seed, gx, gy, 65) * 6)}`, 0.5, 0.4, 0, 66);
      }
      // gramíneas e flores em aberturas (com agregação por ruído, não uniforme)
      const patchy = smoothstep(0.35, 0.7, hash2(cfg.seed, Math.floor(gx / 3), Math.floor(gy / 3), 67));
      const grassP = clamp(openness * (0.5 + 0.9 * patchy) * smoothstep(0.1, 0.28, moisture), 0, 0.95);
      if (hash2(cfg.seed, gx, gy, 68) < grassP) {
        push(`grass_${1 + Math.floor(hash2(cfg.seed, gx, gy, 69) * 3)}`, 0.3, 0.6, 1, 70);
      }
      if (hash2(cfg.seed, gx, gy, 71) < grassP * 0.45 * smoothstep(0.25, 0.5, moisture)) {
        const big = hash2(cfg.seed, gx, gy, 72) < 0.5;
        push(big ? `flower_${hash2(cfg.seed, gx, gy, 73) < 0.5 ? 'a' : 'b'}` : `sflower_${'abc'[Math.floor(hash2(cfg.seed, gx, gy, 74) * 3)]}`, 0.6, 0.3, 1, 75);
      }
      // arbustos nas bordas de floresta (transição)
      const edge = smoothstep(0.18, 0.35, forest) * smoothstep(0.75, 0.5, forest);
      if (hash2(cfg.seed, gx, gy, 76) < edge * 0.7) {
        push(`bush${hash2(cfg.seed, gx, gy, 77) < 0.5 ? '' : Math.floor(hash2(cfg.seed, gx, gy, 78) * 3) === 0 ? '2' : '3'}`, 0.4, 0.5, 1, 79);
      }
      // rochas em solo rochoso/encostas
      const rocky = chunk.soilType[i] === 2 || chunk.slope[i] > 1.5;
      if (rocky && hash2(cfg.seed, gx, gy, 80) < 0.5) {
        push(`rock_${1 + Math.floor(hash2(cfg.seed, gx, gy, 81) * 6)}`, 0.5, 0.5, 1, 82);
      }
      // tocos raros (história da floresta)
      if (forest > 0.4 && hash2(cfg.seed, gx, gy, 83) < 0.035) {
        push(`stump_${1 + Math.floor(hash2(cfg.seed, gx, gy, 84) * 4)}`, 0.5, 0.5, 1, 85);
      }
    }
  }

  chunk.rebuildPlantIndex();
  chunk.ready = true;
  return chunk;
}

export function hashId(seed: number, gx: number, gy: number, slot: number): number {
  return Math.floor(hash1(seed, gx * 100003 + gy * 997 + slot, 900) * 0x7fffffff);
}


