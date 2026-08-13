/**
 * Entrada do jogador, no formato de comando por tic.
 *
 * O DOOM empacota a intencao do jogador num `ticcmd_t` consumido uma vez por
 * tic. Mantemos a ideia: os eventos do navegador so acumulam estado, e a
 * simulacao le um comando fechado por tic. Sem isso, um mouse de 1000 Hz
 * aplicaria oito vezes mais rotacao que um de 125 Hz no mesmo tic, e a mira
 * mudaria de sensibilidade conforme o hardware.
 */

export interface TicCommand {
  /** -1 a 1, positivo para a frente. */
  forward: number
  /** -1 a 1, positivo para a direita. */
  side: number
  /** Rotacao horizontal acumulada desde o tic anterior, em radianos. */
  yawDelta: number
  /** Rotacao vertical acumulada desde o tic anterior, em radianos. */
  pitchDelta: number
  run: boolean
  fire: boolean
}

const EMPTY_COMMAND: TicCommand = {
  forward: 0,
  side: 0,
  yawDelta: 0,
  pitchDelta: 0,
  run: false,
  fire: false,
}

export interface InputOptions {
  /** Radianos de rotacao por pixel de mouse. */
  sensitivity?: number
  invertPitch?: boolean
  /**
   * Aceitar comandos sem o ponteiro preso.
   *
   * Existe para medicao: o navegador so concede pointer lock a partir de um
   * gesto real do usuario, o que impede medir latencia de forma automatizada.
   * Ligado por `?test=1`, nunca no jogo normal.
   */
  allowUnlocked?: boolean
}

export class Input {
  private readonly pressed = new Set<string>()
  private pendingYaw = 0
  private pendingPitch = 0
  private firing = false
  private locked = false

  private readonly sensitivity: number
  private readonly pitchSign: number
  private readonly allowUnlocked: boolean

  constructor(
    private readonly canvas: HTMLCanvasElement,
    options: InputOptions = {},
  ) {
    this.sensitivity = options.sensitivity ?? 0.0022
    this.pitchSign = options.invertPitch ? 1 : -1
    this.allowUnlocked = options.allowUnlocked ?? false
  }

  /** A simulacao deve avancar? Pausa quando o ponteiro nao esta preso. */
  get isLocked(): boolean {
    return this.locked || this.allowUnlocked
  }

  attach(): void {
    document.addEventListener('keydown', this.onKeyDown)
    document.addEventListener('keyup', this.onKeyUp)
    document.addEventListener('pointerlockchange', this.onPointerLockChange)
    document.addEventListener('mousemove', this.onMouseMove)
    document.addEventListener('mousedown', this.onMouseDown)
    document.addEventListener('mouseup', this.onMouseUp)
    window.addEventListener('blur', this.onBlur)
  }

  detach(): void {
    document.removeEventListener('keydown', this.onKeyDown)
    document.removeEventListener('keyup', this.onKeyUp)
    document.removeEventListener('pointerlockchange', this.onPointerLockChange)
    document.removeEventListener('mousemove', this.onMouseMove)
    document.removeEventListener('mousedown', this.onMouseDown)
    document.removeEventListener('mouseup', this.onMouseUp)
    window.removeEventListener('blur', this.onBlur)
  }

  requestLock(): void {
    void this.canvas.requestPointerLock()
  }

  /**
   * Fecha o comando do tic e zera o que e acumulativo.
   *
   * O movimento do mouse e consumido: se dois tics rodarem no mesmo frame, o
   * segundo recebe rotacao zero em vez de repetir a do primeiro.
   */
  consume(): TicCommand {
    if (!this.isLocked) {
      this.pendingYaw = 0
      this.pendingPitch = 0
      return EMPTY_COMMAND
    }

    const command: TicCommand = {
      forward: this.axis('KeyW', 'ArrowUp', 'KeyS', 'ArrowDown'),
      side: this.axis('KeyD', 'ArrowRight', 'KeyA', 'ArrowLeft'),
      yawDelta: this.pendingYaw,
      pitchDelta: this.pendingPitch,
      run: this.pressed.has('ShiftLeft') || this.pressed.has('ShiftRight'),
      fire: this.firing,
    }

    this.pendingYaw = 0
    this.pendingPitch = 0

    return command
  }

  private axis(
    positiveA: string,
    positiveB: string,
    negativeA: string,
    negativeB: string,
  ): number {
    const positive = this.pressed.has(positiveA) || this.pressed.has(positiveB)
    const negative = this.pressed.has(negativeA) || this.pressed.has(negativeB)
    // Teclas opostas simultaneas se cancelam, como no original.
    return (positive ? 1 : 0) - (negative ? 1 : 0)
  }

  private readonly onKeyDown = (event: KeyboardEvent) => {
    this.pressed.add(event.code)
    // Setas e espaco rolam a pagina por baixo do canvas se deixarmos passar.
    if (event.code.startsWith('Arrow') || event.code === 'Space') event.preventDefault()
  }

  private readonly onKeyUp = (event: KeyboardEvent) => {
    this.pressed.delete(event.code)
  }

  private readonly onMouseMove = (event: MouseEvent) => {
    if (!this.isLocked) return
    this.pendingYaw -= event.movementX * this.sensitivity
    this.pendingPitch += this.pitchSign * event.movementY * this.sensitivity
  }

  private readonly onMouseDown = (event: MouseEvent) => {
    if (event.button === 0) this.firing = true
  }

  private readonly onMouseUp = (event: MouseEvent) => {
    if (event.button === 0) this.firing = false
  }

  private readonly onPointerLockChange = () => {
    this.locked = document.pointerLockElement === this.canvas
    if (!this.locked) this.releaseAll()
  }

  /**
   * Perder o foco com uma tecla apertada deixaria o jogador correndo sozinho
   * ao voltar, porque o keyup acontece fora da janela e nunca chega.
   */
  private readonly onBlur = () => {
    this.releaseAll()
  }

  private releaseAll(): void {
    this.pressed.clear()
    this.firing = false
    this.pendingYaw = 0
    this.pendingPitch = 0
  }
}
