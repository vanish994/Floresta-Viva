/**
 * Lista de operações de desenho (IR de renderização).
 *
 * A composição da cena é PURA: produz ops a partir do estado do mundo.
 * Dois executores consomem as mesmas ops:
 *  - CanvasRenderer (navegador, Canvas2D)
 *  - SoftwareRenderer (tools/preview.ts, para validação visual headless)
 */
export type Op =
  | {
      k: 'blit';
      img: string;
      sx: number; sy: number; sw: number; sh: number;
      dx: number; dy: number; dw: number; dh: number;
      alpha?: number;
      flip?: boolean;
    }
  | { k: 'fill'; x: number; y: number; w: number; h: number; r: number; g: number; b: number; a: number }
  /** multiplicação global de cor (iluminação ambiente) */
  | { k: 'tint'; r: number; g: number; b: number; strength: number }
  /** escuridão noturna com furo de luz ao redor do personagem */
  | { k: 'dark'; a: number; lx: number; ly: number; radius: number };

export interface SceneOps {
  ops: Op[];
  tiles: number;
  sprites: number;
}
