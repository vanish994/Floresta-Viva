/** Chuva ambiente dinâmica: usa um único loop e adapta volume/filtro à intensidade do clima. */
export class RainAudio {
  private readonly audio: HTMLAudioElement;
  private readonly ctx: AudioContext | null;
  private readonly gain: GainNode | null;
  private readonly filter: BiquadFilterNode | null;
  private unlocked = false;
  private current = 0;

  constructor(src = new URL('audio/rain-spring.mp3', import.meta.env.BASE_URL).href) {
    this.audio = new Audio(src);
    this.audio.loop = true;
    this.audio.preload = 'auto';
    this.audio.volume = 1;

    const AudioCtx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (AudioCtx) {
      this.ctx = new AudioCtx();
      const source = this.ctx.createMediaElementSource(this.audio);
      this.gain = this.ctx.createGain();
      this.filter = this.ctx.createBiquadFilter();
      this.filter.type = 'lowpass';
      this.filter.frequency.value = 1200;
      this.filter.Q.value = 0.25;
      source.connect(this.filter).connect(this.gain).connect(this.ctx.destination);
      this.gain.gain.value = 0;
    } else {
      this.ctx = null;
      this.gain = null;
      this.filter = null;
    }
  }

  /** Deve ser chamado durante uma interação do usuário para liberar o áudio no mobile. */
  async unlock(): Promise<void> {
    this.unlocked = true;
    try {
      await this.ctx?.resume();
      if (this.current > 0.01 && this.audio.paused) await this.audio.play();
    } catch {
      // Autoplay ainda bloqueado: a próxima interação tentará novamente.
      this.unlocked = false;
    }
  }

  update(intensity: number, dt: number): void {
    const rain = Math.max(0, Math.min(1, intensity));
    // Curva perceptual: a garoa fica discreta, mas chuva forte cresce bastante.
    const target = rain < 0.025 ? 0 : Math.pow(rain, 0.72) * 0.42;
    const smoothing = 1 - Math.exp(-dt * 2.8);
    this.current += (target - this.current) * smoothing;

    if (this.gain) {
      this.gain.gain.value = this.current;
      // Chuva fraca é mais abafada; pancada ganha mais agudos.
      this.filter!.frequency.value = 1100 + this.current / 0.42 * 6500;
    } else {
      this.audio.volume = this.current;
    }

    if (this.unlocked && this.current > 0.008 && this.audio.paused) {
      void this.audio.play().catch(() => undefined);
    }
    if (this.current <= 0.003 && !this.audio.paused) {
      this.audio.pause();
    }
  }

  stop(): void {
    this.current = 0;
    if (this.gain) this.gain.gain.value = 0;
    this.audio.pause();
    this.audio.currentTime = 0;
  }
}
