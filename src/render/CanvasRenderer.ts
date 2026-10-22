/**
 * Executor das ops de cena em Canvas2D (navegador).
 * Pixel-perfect: sem suavização, coordenadas inteiras, proporções preservadas.
 * Na carga, o marcador roxo de sombra dos assets é convertido em sombra real.
 */
import type { Op } from './ops';
import { sanitizeShadow } from './sanitize';
import { BUILD_ID } from '../core/build';

export class CanvasRenderer {
  private images = new Map<string, HTMLCanvasElement>();
  private pending = 0;
  ready = false;

  /** sprites carregados / falhas (para diagnóstico no HUD) */
  loadedCount = 0;
  failedFiles: string[] = [];

  load(files: string[], base = './'): Promise<void> {
    this.pending = files.length;
    return new Promise((resolve) => {
      if (files.length === 0) {
        this.ready = true;
        resolve();
        return;
      }
      const done = () => {
        this.pending--;
        if (this.pending <= 0) {
          this.ready = true;
          resolve();
        }
      };
      for (const f of files) {
        const fetchSprite = (url: string, retry: boolean) => {
          const img = new Image();
          img.onload = () => {
          try {
            const cv = document.createElement('canvas');
            cv.width = img.naturalWidth;
            cv.height = img.naturalHeight;
            const c = cv.getContext('2d', { willReadFrequently: true })!;
            c.drawImage(img, 0, 0);
            const id = c.getImageData(0, 0, cv.width, cv.height);
            sanitizeShadow(id.data);
            c.putImageData(id, 0, 0);
            this.images.set(f, cv);
          } catch {
            /* mantém sem sanitizar se algo falhar */
          }
            this.loadedCount++;
            done();
          };
          img.onerror = () => {
            // 404 cacheado no celular é teimoso: tenta 1x com cache-buster
            if (retry) {
              fetchSprite(`${url}${url.includes('?') ? '&' : '?'}cb=${Date.now()}`, false);
            } else {
              this.failedFiles.push(f);
              done();
            }
          };
          img.src = url;
        };
        // Codifica cada segmento do caminho para suportar %, &, espaços etc.
        // sem alterar as barras que separam as pastas.
        const encodedPath = f.split('/').map((segment) => encodeURIComponent(segment)).join('/');
        // versão do build na query: deploy novo nunca reusa sprite cacheado
        fetchSprite(`${base}${encodedPath}?v=${BUILD_ID}`, true);
      }
    });
  }

  render(ctx: CanvasRenderingContext2D, ops: Op[], w: number, h: number): void {
    ctx.imageSmoothingEnabled = false;
    for (const op of ops) {
      switch (op.k) {
        case 'blit': {
          const img = this.images.get(op.img);
          if (!img) break;
          ctx.globalAlpha = op.alpha ?? 1;
          if (op.flip) {
            ctx.save();
            ctx.translate(op.dx + op.dw, op.dy);
            ctx.scale(-1, 1);
            ctx.drawImage(img, op.sx, op.sy, op.sw, op.sh, 0, 0, op.dw, op.dh);
            ctx.restore();
          } else {
            ctx.drawImage(img, op.sx, op.sy, op.sw, op.sh, op.dx, op.dy, op.dw, op.dh);
          }
          ctx.globalAlpha = 1;
          break;
        }
        case 'fill': {
          ctx.globalAlpha = 1;
          ctx.fillStyle = `rgba(${op.r},${op.g},${op.b},${op.a})`;
          ctx.fillRect(op.x, op.y, op.w, op.h);
          break;
        }
        case 'tint': {
          ctx.globalCompositeOperation = 'multiply';
          ctx.globalAlpha = op.strength;
          ctx.fillStyle = `rgb(${op.r},${op.g},${op.b})`;
          ctx.fillRect(0, 0, w, h);
          ctx.globalAlpha = 1;
          ctx.globalCompositeOperation = 'source-over';
          break;
        }
        case 'dark': {
          if (op.a <= 0.003) break;
          const g = ctx.createRadialGradient(op.lx, op.ly, op.radius * 0.25, op.lx, op.ly, op.radius);
          g.addColorStop(0, `rgba(6,8,20,0)`);
          g.addColorStop(1, `rgba(6,8,20,${op.a})`);
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, w, h);
          break;
        }
      }
    }
  }
}
