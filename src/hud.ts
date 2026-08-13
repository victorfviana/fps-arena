/**
 * Painel do jogador.
 *
 * Escreve no DOM so quando o valor muda. Atualizar textContent a 144 quadros
 * por segundo forca recalculo de layout e derruba o framerate justamente
 * quando a arena esta cheia — que e quando o HUD mais importa.
 */

export interface HudElements {
  root: HTMLElement
  health: HTMLElement
  score: HTMLElement
  wave: HTMLElement
  remaining: HTMLElement
  damageFlash: HTMLElement
  toast: HTMLElement
}

export class Hud {
  private lastHealth = -1
  private lastScore = -1
  private lastWave = -1
  private lastRemaining = -1
  private toastTimer: number | null = null

  constructor(private readonly elements: HudElements) {}

  show(): void {
    this.elements.root.hidden = false
  }

  hide(): void {
    this.elements.root.hidden = true
  }

  update(state: {
    health: number
    score: number
    wave: number
    remaining: number
  }): void {
    const { elements } = this

    if (state.health !== this.lastHealth) {
      const health = Math.max(0, Math.round(state.health))
      elements.health.textContent = String(health)
      elements.health.classList.toggle('low', health <= 30)
      this.lastHealth = state.health
    }

    if (state.score !== this.lastScore) {
      elements.score.textContent = String(state.score)
      this.lastScore = state.score
    }

    if (state.wave !== this.lastWave) {
      elements.wave.textContent = String(state.wave)
      this.lastWave = state.wave
    }

    if (state.remaining !== this.lastRemaining) {
      elements.remaining.textContent = String(state.remaining)
      this.lastRemaining = state.remaining
    }
  }

  /** Pisca a vinheta de dano. */
  flashDamage(): void {
    const { damageFlash } = this.elements
    damageFlash.classList.add('on')
    // Um quadro ligado e o bastante: o desligar e que produz o esmaecimento.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => damageFlash.classList.remove('on'))
    })
  }

  /** Mensagem curta no centro da tela. */
  toast(message: string, durationMs = 1400): void {
    const { toast } = this.elements
    toast.textContent = message
    toast.classList.add('on')

    if (this.toastTimer !== null) window.clearTimeout(this.toastTimer)
    this.toastTimer = window.setTimeout(() => {
      toast.classList.remove('on')
      this.toastTimer = null
    }, durationMs)
  }

  reset(): void {
    this.lastHealth = -1
    this.lastScore = -1
    this.lastWave = -1
    this.lastRemaining = -1
  }
}
