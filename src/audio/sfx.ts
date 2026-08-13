/**
 * Efeitos sonoros sintetizados na hora, com WebAudio.
 *
 * Nenhum arquivo de audio no projeto — mesmo motivo das texturas. Som importa
 * mais do que parece na rubrica de feedback de tiro: o disparo precisa de
 * ataque seco e queda rapida, senao o tiro parece macio por mais correto que
 * esteja o numero de tics.
 *
 * O contexto so e criado no primeiro gesto do jogador, porque navegador
 * nenhum permite tocar audio antes disso.
 */

export class Sfx {
  private context: AudioContext | null = null
  private master: GainNode | null = null
  private muted = false

  /** Chamar dentro de um gesto do usuario (o clique de comecar). */
  resume(): void {
    if (!this.context) {
      const Ctor = window.AudioContext ?? (window as unknown as {
        webkitAudioContext?: typeof AudioContext
      }).webkitAudioContext

      if (!Ctor) return // navegador sem WebAudio: o jogo segue mudo

      this.context = new Ctor()
      this.master = this.context.createGain()
      this.master.gain.value = 0.35
      this.master.connect(this.context.destination)
    }

    void this.context.resume()
  }

  toggleMute(): boolean {
    this.muted = !this.muted
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.35
    return this.muted
  }

  /** Ruido branco com envelope — a base de tiro e impacto. */
  private noiseBurst(duration: number, gain: number, filterHz: number, sweepTo?: number): void {
    const ctx = this.context
    if (!ctx || !this.master) return

    const frames = Math.max(1, Math.floor(ctx.sampleRate * duration))
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1

    const source = ctx.createBufferSource()
    source.buffer = buffer

    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(filterHz, ctx.currentTime)
    if (sweepTo !== undefined) {
      filter.frequency.exponentialRampToValueAtTime(sweepTo, ctx.currentTime + duration)
    }

    const envelope = ctx.createGain()
    // Ataque de 1 ms: e o que faz o som parecer um golpe e nao um sopro.
    envelope.gain.setValueAtTime(0.0001, ctx.currentTime)
    envelope.gain.exponentialRampToValueAtTime(gain, ctx.currentTime + 0.001)
    envelope.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration)

    source.connect(filter)
    filter.connect(envelope)
    envelope.connect(this.master)
    source.start()
    source.stop(ctx.currentTime + duration)
  }

  private tone(
    frequency: number,
    duration: number,
    gain: number,
    type: OscillatorType = 'square',
    endFrequency?: number,
  ): void {
    const ctx = this.context
    if (!ctx || !this.master) return

    const oscillator = ctx.createOscillator()
    oscillator.type = type
    oscillator.frequency.setValueAtTime(frequency, ctx.currentTime)
    if (endFrequency !== undefined) {
      oscillator.frequency.exponentialRampToValueAtTime(
        Math.max(1, endFrequency),
        ctx.currentTime + duration,
      )
    }

    const envelope = ctx.createGain()
    envelope.gain.setValueAtTime(0.0001, ctx.currentTime)
    envelope.gain.exponentialRampToValueAtTime(gain, ctx.currentTime + 0.004)
    envelope.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration)

    oscillator.connect(envelope)
    envelope.connect(this.master)
    oscillator.start()
    oscillator.stop(ctx.currentTime + duration)
  }

  shotgun(): void {
    this.noiseBurst(0.22, 0.9, 3200, 260)
    this.tone(140, 0.16, 0.35, 'square', 48)
  }

  pistol(): void {
    this.noiseBurst(0.09, 0.6, 4200, 700)
    this.tone(320, 0.06, 0.22, 'square', 120)
  }

  /** Acerto: curto e agudo, para destacar do proprio disparo. */
  hit(): void {
    this.noiseBurst(0.05, 0.45, 6000, 2200)
  }

  enemyPain(): void {
    this.tone(190 + Math.random() * 70, 0.12, 0.3, 'sawtooth', 90)
  }

  enemyDeath(): void {
    this.tone(150, 0.42, 0.34, 'sawtooth', 38)
    this.noiseBurst(0.3, 0.3, 1400, 180)
  }

  playerHurt(): void {
    this.tone(90, 0.2, 0.4, 'triangle', 55)
  }

  waveStart(): void {
    this.tone(330, 0.14, 0.28, 'square')
    window.setTimeout(() => this.tone(495, 0.22, 0.28, 'square'), 130)
  }

  gameOver(): void {
    this.tone(220, 0.7, 0.4, 'sawtooth', 55)
  }
}
