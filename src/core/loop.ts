/**
 * Loop de passo fixo.
 *
 * A simulacao roda a uma taxa constante (o "tic" do DOOM) e o desenho roda
 * na taxa do monitor, interpolando entre o estado anterior e o atual. Isso e
 * o que permite usar as constantes do DOOM literalmente, em unidades por tic,
 * sem que a fisica mude conforme o framerate da maquina.
 *
 * `advance` e puro e sincrono de proposito: e a peca que os testes exercitam
 * sem precisar de navegador nem de requestAnimationFrame.
 */

export interface LoopOptions {
  /** Taxa da simulacao, em tics por segundo. */
  tickRateHz: number
  /**
   * Teto de tics simulados num unico frame. Sem ele, uma pausa longa da aba
   * acumula milhares de tics e a proxima frame trava a pagina tentando
   * alcancar o tempo perdido.
   */
  maxTicksPerFrame?: number
  onTick: () => void
  /** @param alpha fracao entre o tic anterior e o proximo, de 0 a 1. */
  onRender: (alpha: number) => void
}

export class FixedTimestepLoop {
  readonly tickIntervalMs: number
  private readonly maxTicksPerFrame: number
  private accumulatorMs = 0
  private rafHandle: number | null = null
  private lastFrameMs = 0

  /** Tics simulados desde a criacao. Usado pelo diagnostico e pelos testes. */
  totalTicks = 0
  /** Tics descartados por estouro do teto. Diferente de zero indica travada. */
  droppedTicks = 0

  constructor(private readonly options: LoopOptions) {
    if (options.tickRateHz <= 0) {
      throw new Error('tickRateHz precisa ser positivo')
    }
    this.tickIntervalMs = 1000 / options.tickRateHz
    this.maxTicksPerFrame = options.maxTicksPerFrame ?? 8
  }

  /**
   * Consome um intervalo de tempo real, roda os tics que couberem nele e
   * desenha uma vez.
   *
   * @param deltaMs tempo decorrido desde a chamada anterior.
   * @returns quantidade de tics simulados nesta chamada.
   */
  advance(deltaMs: number): number {
    // Delta negativo ou NaN vem de relogio ajustado ou de aba suspensa;
    // tratar como zero e mais seguro do que propagar para a fisica.
    if (!Number.isFinite(deltaMs) || deltaMs < 0) deltaMs = 0

    this.accumulatorMs += deltaMs

    let ticks = 0
    while (this.accumulatorMs >= this.tickIntervalMs && ticks < this.maxTicksPerFrame) {
      this.options.onTick()
      this.accumulatorMs -= this.tickIntervalMs
      ticks++
      this.totalTicks++
    }

    if (this.accumulatorMs >= this.tickIntervalMs) {
      const overflow = Math.floor(this.accumulatorMs / this.tickIntervalMs)
      this.droppedTicks += overflow
      this.accumulatorMs -= overflow * this.tickIntervalMs
    }

    this.options.onRender(this.accumulatorMs / this.tickIntervalMs)
    return ticks
  }

  start(): void {
    if (this.rafHandle !== null) return
    this.lastFrameMs = performance.now()

    const frame = (nowMs: number) => {
      this.rafHandle = requestAnimationFrame(frame)
      this.advance(nowMs - this.lastFrameMs)
      this.lastFrameMs = nowMs
    }

    this.rafHandle = requestAnimationFrame(frame)
  }

  stop(): void {
    if (this.rafHandle === null) return
    cancelAnimationFrame(this.rafHandle)
    this.rafHandle = null
  }
}
