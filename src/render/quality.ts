/**
 * Ajuste automatico de qualidade.
 *
 * Sombras, bloom e PBR custam quadros, e o custo depende da maquina — nao ha
 * numero fixo que sirva para todas. Em vez de escolher um teto conservador que
 * desperdica placa boa, ou um agressivo que engasga em placa fraca, o jogo
 * observa o proprio framerate e desce um degrau quando nao esta dando conta.
 *
 * Duas regras evitam o defeito classico desse tipo de ajuste:
 *   1. So desce, nunca sobe. Subir e descer alternadamente produz piscada de
 *      sombra e mudanca de brilho no meio do combate, pior que rodar feio.
 *   2. Espera uma janela inteira antes de decidir. Reagir a um unico quadro
 *      ruim rebaixaria o jogo por causa de um engasgo do sistema operacional.
 */

export type QualityLevel = 'alto' | 'medio' | 'baixo'

export interface QualitySettings {
  shadows: boolean
  shadowMapSize: number
  bloom: boolean
  /** Teto do devicePixelRatio. */
  pixelRatio: number
  anisotropy: number
}

export const QUALITY_PRESETS: Record<QualityLevel, QualitySettings> = {
  alto: { shadows: true, shadowMapSize: 2048, bloom: true, pixelRatio: 2, anisotropy: 8 },
  medio: { shadows: true, shadowMapSize: 1024, bloom: true, pixelRatio: 1.25, anisotropy: 4 },
  baixo: { shadows: false, shadowMapSize: 512, bloom: false, pixelRatio: 1, anisotropy: 1 },
}

const ORDEM: QualityLevel[] = ['alto', 'medio', 'baixo']

/** Alvo de framerate. Abaixo disso por uma janela inteira, desce um degrau. */
const ALVO_FPS = 50

/** Duracao da janela de observacao, em milissegundos. */
const JANELA_MS = 2000

/** Quadros iniciais ignorados: compilacao de shader sempre derruba o inicio. */
const AQUECIMENTO_MS = 2500

export class QualityGovernor {
  private nivelAtual: QualityLevel
  private quadros = 0
  private janelaInicio = 0
  private nascimento = 0
  private iniciado = false

  constructor(
    inicial: QualityLevel = 'alto',
    private readonly aoMudar: (nivel: QualityLevel, settings: QualitySettings) => void,
  ) {
    this.nivelAtual = inicial
  }

  get nivel(): QualityLevel {
    return this.nivelAtual
  }

  get settings(): QualitySettings {
    return QUALITY_PRESETS[this.nivelAtual]
  }

  /** Chamar uma vez por quadro. */
  registrarQuadro(agoraMs: number): void {
    if (!this.iniciado) {
      this.iniciado = true
      this.nascimento = agoraMs
      this.janelaInicio = agoraMs
      return
    }

    this.quadros++

    if (agoraMs - this.nascimento < AQUECIMENTO_MS) {
      this.janelaInicio = agoraMs
      this.quadros = 0
      return
    }

    const decorrido = agoraMs - this.janelaInicio
    if (decorrido < JANELA_MS) return

    const fps = (this.quadros * 1000) / decorrido
    this.quadros = 0
    this.janelaInicio = agoraMs

    if (fps >= ALVO_FPS) return

    const indice = ORDEM.indexOf(this.nivelAtual)
    if (indice >= ORDEM.length - 1) return // ja esta no minimo

    this.nivelAtual = ORDEM[indice + 1]!
    this.aoMudar(this.nivelAtual, this.settings)
  }

  /** Fixa um nivel e desliga o ajuste automatico. */
  forcar(nivel: QualityLevel): void {
    this.nivelAtual = nivel
    this.aoMudar(nivel, this.settings)
  }
}
