/**
 * Ajuste automatico de qualidade.
 *
 * Sombras, bloom e PBR custam quadros, e o custo depende da maquina — nao ha
 * numero fixo que sirva para todas. Em vez de escolher um teto conservador que
 * desperdica placa boa, ou um agressivo que engasga em placa fraca, o jogo
 * observa o proprio framerate e desce ou sobe um degrau conforme o desempenho.
 *
 * Regras que evitam o defeito classico desse tipo de ajuste:
 *   1. Descer e imediato: uma janela inteira abaixo do alvo ja derruba um
 *      degrau, porque o combate nao perdoa engasgo.
 *   2. Subir e cauteloso: exige 3 janelas CONSECUTIVAS com folga real acima do
 *      alvo (limiar + 8 fps, nao so cruzar o limiar) antes de arriscar mais
 *      carga na GPU.
 *   3. Anti-oscilacao: se a subida nao se sustenta — a proxima janela ja
 *      degrada de novo — o nivel alcancado vira teto permanente da sessao.
 *      Sem isso, uma maquina na fronteira ficaria alternando sombra
 *      ligada/desligada a cada poucos segundos, o que e pior que rodar no
 *      nivel baixo o tempo todo.
 *   4. Espera uma janela inteira antes de decidir. Reagir a um unico quadro
 *      ruim rebaixaria — ou subiria — o jogo por causa de um engasgo pontual
 *      do sistema operacional.
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

/**
 * Folga exigida para subir um degrau, em fps acima do alvo.
 *
 * Nao basta cruzar ALVO_FPS: um resultado bem em cima do limiar sobe, cai na
 * janela seguinte e nao ganha nada, so gasta duas trocas de qualidade a toa.
 * A folga garante que so sobe quando ha margem real.
 */
const RECUPERACAO_MARGEM_FPS = 8

/** Janelas boas consecutivas exigidas antes de subir um degrau. */
const JANELAS_PARA_SUBIR = 3

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

  /** Janelas seguidas com folga acima do alvo, rumo a proxima subida. */
  private janelasBoasConsecutivas = 0

  /**
   * Verdadeiro so na janela imediatamente seguinte a uma subida — usado para
   * detectar oscilacao. Consumido (voltando a falso) na primeira decisao
   * apos a subida, suba ela ou desca.
   */
  private subiuNaUltimaJanela = false

  /**
   * Teto permanente da sessao, travado pela regra de anti-oscilacao. Uma vez
   * definido, `subir()` nunca leva o nivel alem dele.
   */
  private teto: QualityLevel | null = null

  constructor(
    private readonly nivelInicial: QualityLevel = 'alto',
    private readonly aoMudar: (nivel: QualityLevel, settings: QualitySettings) => void,
  ) {
    this.nivelAtual = nivelInicial
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

    // Consumido nesta decisao, suba ela ou desca — a checagem de oscilacao
    // vale so para a janela que vem logo depois de uma subida.
    const pendenteDeOscilacao = this.subiuNaUltimaJanela
    this.subiuNaUltimaJanela = false

    if (fps < ALVO_FPS) {
      this.janelasBoasConsecutivas = 0
      if (pendenteDeOscilacao) {
        // A subida anterior nao se sustentou por uma janela sequer: trava o
        // nivel atual (o que acabamos de alcancar) como teto da sessao.
        this.teto = this.nivelAtual
      }
      this.degradar()
      return
    }

    if (fps >= ALVO_FPS + RECUPERACAO_MARGEM_FPS) {
      this.janelasBoasConsecutivas++
      if (this.janelasBoasConsecutivas >= JANELAS_PARA_SUBIR) {
        this.janelasBoasConsecutivas = 0
        this.subir()
      }
    } else {
      // Entre o alvo e a margem de recuperacao: nem degrada nem conta como
      // janela boa. Fps instavel ali nao deveria empurrar em nenhuma direcao.
      this.janelasBoasConsecutivas = 0
    }
  }

  private degradar(): void {
    const indice = ORDEM.indexOf(this.nivelAtual)
    if (indice >= ORDEM.length - 1) return // ja esta no minimo

    this.nivelAtual = ORDEM[indice + 1]!
    this.aoMudar(this.nivelAtual, this.settings)
  }

  private subir(): void {
    const indice = ORDEM.indexOf(this.nivelAtual)
    if (indice <= 0) return // ja esta no maximo

    let novoIndice = indice - 1
    if (this.teto) {
      // Indice menor = qualidade melhor. O teto trava o quao baixo (= bom)
      // o indice pode ir.
      novoIndice = Math.max(novoIndice, ORDEM.indexOf(this.teto))
    }
    if (novoIndice === indice) return // teto ja impede qualquer subida

    this.nivelAtual = ORDEM[novoIndice]!
    this.subiuNaUltimaJanela = true
    this.aoMudar(this.nivelAtual, this.settings)
  }

  /** Fixa um nivel e desliga o ajuste automatico ate a proxima decisao. */
  forcar(nivel: QualityLevel): void {
    this.nivelAtual = nivel
    this.aoMudar(nivel, this.settings)
  }

  /**
   * Restaura o estado inicial da sessao: nivel de partida, aquecimento e teto
   * de anti-oscilacao zerados.
   *
   * Chamado no restart da partida — sem isso, uma sessao anterior que travou
   * um teto baixo (por exemplo, por causa do engasgo de compilacao de shader
   * no primeiro combate) condenaria todas as partidas seguintes ao mesmo teto,
   * mesmo que a maquina desse conta de mais.
   */
  reset(): void {
    this.nivelAtual = this.nivelInicial
    this.quadros = 0
    this.janelaInicio = 0
    this.nascimento = 0
    this.iniciado = false
    this.janelasBoasConsecutivas = 0
    this.subiuNaUltimaJanela = false
    this.teto = null
    this.aoMudar(this.nivelAtual, this.settings)
  }
}
