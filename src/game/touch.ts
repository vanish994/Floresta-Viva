/**
 * Controles de toque (mobile first): joystick virtual à esquerda e botões de
 * ação à direita. Sem dependências; os elementos são criados aqui e o estado
 * é lido pelo loop do jogo.
 */
export interface TouchState {
  axis: { x: number; y: number };
  /** botões pressionados desde o último frame (consumidos pelo jogo) */
  cut: boolean;
  plant: boolean;
  active: boolean;
}

export class TouchControls {
  readonly state: TouchState = { axis: { x: 0, y: 0 }, cut: false, plant: false, active: false };
  private root: HTMLDivElement;
  private stickBase: HTMLDivElement;
  private stickKnob: HTMLDivElement;
  private pointerId: number | null = null;
  private baseX = 0;
  private baseY = 0;
  private readonly RADIUS = 52;

  constructor() {
    const root = document.createElement('div');
    root.id = 'touch';
    root.innerHTML = `
      <div id="stick-base" class="stick-base"><div class="stick-knob"></div></div>
      <div class="touch-actions">
        <button id="touch-cut" class="touch-btn" aria-label="derrubar árvore">F</button>
        <button id="touch-plant" class="touch-btn" aria-label="plantar muda">G</button>
      </div>`;
    document.body.appendChild(root);
    this.root = root;
    this.stickBase = root.querySelector('#stick-base')!;
    this.stickKnob = root.querySelector('.stick-knob')!;
    this.bind();
    // só mostra em dispositivos de toque
    const coarse = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    root.style.display = coarse ? 'block' : 'none';
    this.state.active = coarse;
  }

  private bind() {
    const base = this.stickBase;
    base.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.pointerId = e.pointerId;
      base.setPointerCapture(e.pointerId);
      const r = base.getBoundingClientRect();
      this.baseX = r.left + r.width / 2;
      this.baseY = r.top + r.height / 2;
      this.move(e.clientX, e.clientY);
      base.classList.add('on');
    });
    base.addEventListener('pointermove', (e) => {
      if (this.pointerId !== e.pointerId) return;
      e.preventDefault();
      this.move(e.clientX, e.clientY);
    });
    const end = (e: PointerEvent) => {
      if (this.pointerId !== e.pointerId) return;
      this.pointerId = null;
      this.state.axis.x = 0;
      this.state.axis.y = 0;
      this.stickKnob.style.transform = 'translate(-50%, -50%)';
      base.classList.remove('on');
    };
    base.addEventListener('pointerup', end);
    base.addEventListener('pointercancel', end);

    const btn = (id: string, set: (v: boolean) => void) => {
      const el = this.root.querySelector(`#${id}`)!;
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        set(true);
      });
      el.addEventListener('pointerup', () => set(false));
      el.addEventListener('pointercancel', () => set(false));
      el.addEventListener('pointerleave', () => set(false));
    };
    btn('touch-cut', (v) => {
      if (v) this.state.cut = true;
    });
    btn('touch-plant', (v) => {
      if (v) this.state.plant = true;
    });
  }

  private move(cx: number, cy: number) {
    let dx = cx - this.baseX;
    let dy = cy - this.baseY;
    const len = Math.hypot(dx, dy);
    const max = this.RADIUS;
    if (len > max) {
      dx = (dx / len) * max;
      dy = (dy / len) * max;
    }
    this.stickKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    const dead = 6;
    const nx = Math.abs(dx) < dead ? 0 : dx / max;
    const ny = Math.abs(dy) < dead ? 0 : dy / max;
    const l = Math.hypot(nx, ny);
    if (l > 1) {
      this.state.axis.x = nx / l;
      this.state.axis.y = ny / l;
    } else {
      this.state.axis.x = nx;
      this.state.axis.y = ny;
    }
  }

  consumeCut(): boolean {
    const v = this.state.cut;
    this.state.cut = false;
    return v;
  }
  consumePlant(): boolean {
    const v = this.state.plant;
    this.state.plant = false;
    return v;
  }
}
