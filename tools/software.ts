/**
 * Executor software das mesmas ops de cena usadas no navegador.
 * Permite validação visual headless com os sprites REAIS do pacote.
 */
import type { Op } from '../src/render/ops';
import type { RGBAImage } from './png';

export interface SpriteSource {
  get(file: string): RGBAImage | null;
}

export class SoftwareRenderer {
  constructor(private src: SpriteSource) {}

  render(target: RGBAImage, ops: Op[]): void {
    for (const op of ops) {
      switch (op.k) {
        case 'blit': {
          const img = this.src.get(op.img);
          if (!img) break;
          this.blit(target, img, op);
          break;
        }
        case 'fill':
          this.fill(target, op.x, op.y, op.w, op.h, op.r, op.g, op.b, op.a);
          break;
        case 'tint': {
          const s = op.strength;
          const mr = op.r / 255, mg = op.g / 255, mb = op.b / 255;
          const d = target.data;
          for (let i = 0; i < d.length; i += 4) {
            d[i] = d[i] * (1 - s + s * mr);
            d[i + 1] = d[i + 1] * (1 - s + s * mg);
            d[i + 2] = d[i + 2] * (1 - s + s * mb);
          }
          break;
        }
        case 'dark': {
          if (op.a <= 0.003) break;
          const r0 = op.radius * 0.25;
          const d = target.data;
          for (let y = 0; y < target.height; y++) {
            for (let x = 0; x < target.width; x++) {
              const dist = Math.hypot(x - op.lx, y - op.ly);
              const t = Math.max(0, Math.min(1, (dist - r0) / Math.max(1, op.radius - r0)));
              const a = op.a * t;
              const i = (y * target.width + x) * 4;
              d[i] = d[i] * (1 - a) + 6 * a;
              d[i + 1] = d[i + 1] * (1 - a) + 8 * a;
              d[i + 2] = d[i + 2] * (1 - a) + 20 * a;
            }
          }
          break;
        }
      }
    }
  }

  private blit(t: RGBAImage, img: RGBAImage, op: Extract<Op, { k: 'blit' }>): void {
    const alpha = op.alpha ?? 1;
    for (let dy = 0; dy < op.dh; dy++) {
      const sy = op.sy + Math.floor((dy / op.dh) * op.sh);
      const ty = op.dy + dy;
      if (ty < 0 || ty >= t.height) continue;
      for (let dx = 0; dx < op.dw; dx++) {
        const sxLocal = Math.floor((dx / op.dw) * op.sw);
        const sx = op.flip ? op.sx + op.sw - 1 - sxLocal : op.sx + sxLocal;
        const tx = op.dx + dx;
        if (tx < 0 || tx >= t.width) continue;
        const si = (sy * img.width + sx) * 4;
        const sa = (img.data[si + 3] / 255) * alpha;
        if (sa <= 0.004) continue;
        const ti = (ty * t.width + tx) * 4;
        const da = t.data[ti + 3] / 255;
        const oa = sa + da * (1 - sa);
        if (oa <= 0) continue;
        t.data[ti] = (img.data[si] * sa + t.data[ti] * da * (1 - sa)) / oa;
        t.data[ti + 1] = (img.data[si + 1] * sa + t.data[ti + 1] * da * (1 - sa)) / oa;
        t.data[ti + 2] = (img.data[si + 2] * sa + t.data[ti + 2] * da * (1 - sa)) / oa;
        t.data[ti + 3] = oa * 255;
      }
    }
  }

  private fill(t: RGBAImage, x: number, y: number, w: number, h: number, r: number, g: number, b: number, a: number): void {
    const x0 = Math.max(0, Math.floor(x)), y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(t.width, Math.ceil(x + w)), y1 = Math.min(t.height, Math.ceil(y + h));
    for (let ty = y0; ty < y1; ty++) {
      for (let tx = x0; tx < x1; tx++) {
        const i = (ty * t.width + tx) * 4;
        const da = t.data[i + 3] / 255;
        const oa = a + da * (1 - a);
        t.data[i] = (r * a + t.data[i] * da * (1 - a)) / (oa || 1);
        t.data[i + 1] = (g * a + t.data[i + 1] * da * (1 - a)) / (oa || 1);
        t.data[i + 2] = (b * a + t.data[i + 2] * da * (1 - a)) / (oa || 1);
        t.data[i + 3] = oa * 255;
      }
    }
  }
}
