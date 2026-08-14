/**
 * Efeitos sonoros sintetizados, com estrutura acustica de arma de fogo.
 *
 * A versao anterior era um estouro de ruido com envelope simples — soava como
 * "psh". Um disparo real nao e um som: sao quatro acontecimentos quase
 * simultaneos, e o cerebro reconhece a arma pela RELACAO entre eles.
 *
 *   1. Onda de choque (muzzle blast). Os gases saem a mais que a velocidade do
 *      som e produzem um pico de pressao. Ataque abaixo de 1 ms, energia
 *      concentrada nos graves. E o "peso".
 *   2. Estalo (crack). Banda alta, ainda mais curto. E o que corta o ambiente
 *      e faz o tiro parecer perto.
 *   3. Mecanica. Ferrolho, martelo, bomba. Chega alguns milissegundos depois e
 *      e o que identifica o TIPO de arma.
 *   4. Cauda do ambiente. O som bate nas paredes e volta. Numa arena fechada
 *      de concreto, essa cauda e mais da metade do que se ouve.
 *
 * A cauda e feita por convolucao com uma resposta ao impulso gerada aqui
 * mesmo — e o item que mais aproxima do real, e o que faltava por inteiro.
 *
 * Continua sem nenhum arquivo de audio.
 */

/** Duracao da cauda do ambiente, em segundos. */
const REVERB_SEGUNDOS = 1.6

/** Buffer de ruido pre-gerado, para nao alocar a cada disparo. */
const RUIDO_SEGUNDOS = 2

export type ShotKind = 'shotgun' | 'rifle' | 'pistol'

export class Sfx {
  private context: BaseAudioContext | null = null
  private master: GainNode | null = null
  /** Entrada da cauda do ambiente; tudo que deve ecoar passa por aqui. */
  private reverbSend: GainNode | null = null
  private ruido: AudioBuffer | null = null
  private saturacao: WaveShaperNode | null = null
  private muted = false

  /**
   * @param contextoExterno usado para medicao: passando um `OfflineAudioContext`
   *   da para renderizar um disparo e medir ataque, duracao e distribuicao de
   *   energia por banda. Sem isso, "soa real" seria opiniao — e opiniao sobre
   *   som e ainda mais escorregadia que sobre imagem.
   */
  constructor(private readonly contextoExterno?: BaseAudioContext) {}

  /** Chamar dentro de um gesto do usuario (o clique de comecar). */
  resume(): void {
    if (!this.context) {
      const ctx = this.contextoExterno ?? criarContexto()
      if (!ctx) return // navegador sem WebAudio: o jogo segue mudo
      this.context = ctx

      // Compressor no fim da cadeia: varios disparos somados estouram o
      // limite digital e viram distorcao suja. O compressor segura os picos
      // sem achatar o ataque, que e justamente o que da impacto.
      const compressor = ctx.createDynamicsCompressor()
      compressor.threshold.value = -9
      compressor.knee.value = 8
      compressor.ratio.value = 4
      // Ataque de meio milissegundo: com os 2 ms anteriores, o compressor
      // chegava depois do pico e achatava justamente o transiente que da
      // impacto — o oposto do que se quer dele.
      compressor.attack.value = 0.0005
      compressor.release.value = 0.16

      this.master = ctx.createGain()
      this.master.gain.value = 0.5
      this.master.connect(compressor)
      compressor.connect(ctx.destination)

      this.saturacao = ctx.createWaveShaper()
      this.saturacao.curve = curvaDeSaturacao(2.2)
      this.saturacao.oversample = '2x'
      this.saturacao.connect(this.master)

      this.ruido = criarRuido(ctx, RUIDO_SEGUNDOS)

      const convolver = ctx.createConvolver()
      convolver.buffer = criarRespostaAoImpulso(ctx, REVERB_SEGUNDOS)
      this.reverbSend = ctx.createGain()
      this.reverbSend.gain.value = 1
      this.reverbSend.connect(convolver)

      const retornoReverb = ctx.createGain()
      // O ambiente acompanha o disparo, nao compete com ele.
      retornoReverb.gain.value = 0.3
      convolver.connect(retornoReverb)
      retornoReverb.connect(this.master)
    }

    // Contexto offline nao tem (nem precisa de) resume.
    if ('resume' in this.context) void (this.context as AudioContext).resume()
  }

  toggleMute(): boolean {
    this.muted = !this.muted
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.5
    return this.muted
  }

  /**
   * Uma camada de ruido filtrado.
   *
   * Le um trecho aleatorio do buffer pre-gerado em vez de criar um novo — dois
   * disparos seguidos pegam pedacos diferentes e nao soam identicos, que e
   * metade da sensacao de som gravado.
   *
   * @param pan -1 esquerda, 1 direita.
   */
  private camadaRuido(opcoes: {
    duracao: number
    ganho: number
    tipo: BiquadFilterType
    freq: number
    freqFinal?: number
    q?: number
    atraso?: number
    reverb?: number
    pan?: number
  }): void {
    const ctx = this.context
    if (!ctx || !this.ruido || !this.saturacao) return

    const inicio = ctx.currentTime + (opcoes.atraso ?? 0)
    const fonte = ctx.createBufferSource()
    fonte.buffer = this.ruido
    fonte.loop = true
    // Ponto de leitura aleatorio: e daqui que vem a variacao entre disparos.
    const deslocamento = Math.random() * (RUIDO_SEGUNDOS - opcoes.duracao - 0.05)

    const filtro = ctx.createBiquadFilter()
    filtro.type = opcoes.tipo
    filtro.frequency.setValueAtTime(opcoes.freq, inicio)
    if (opcoes.freqFinal !== undefined) {
      filtro.frequency.exponentialRampToValueAtTime(
        Math.max(20, opcoes.freqFinal),
        inicio + opcoes.duracao,
      )
    }
    if (opcoes.q !== undefined) filtro.Q.value = opcoes.q

    const envelope = ctx.createGain()
    // Ataque de 0,4 ms. E o numero que separa "tiro" de "sopro": qualquer
    // coisa acima de uns 5 ms ja soa como alguem batendo num tambor.
    envelope.gain.setValueAtTime(0.0001, inicio)
    envelope.gain.exponentialRampToValueAtTime(opcoes.ganho, inicio + 0.0004)
    envelope.gain.exponentialRampToValueAtTime(0.0001, inicio + opcoes.duracao)

    const panner = ctx.createStereoPanner()
    panner.pan.value = opcoes.pan ?? 0

    fonte.connect(filtro)
    filtro.connect(envelope)
    envelope.connect(panner)
    panner.connect(this.saturacao)

    if (opcoes.reverb && this.reverbSend) {
      const envio = ctx.createGain()
      envio.gain.value = opcoes.reverb
      panner.connect(envio)
      envio.connect(this.reverbSend)
    }

    fonte.start(inicio, deslocamento)
    fonte.stop(inicio + opcoes.duracao + 0.02)
  }

  /** Um tom curto, para as partes mecanicas e para os avisos. */
  private tom(opcoes: {
    freq: number
    duracao: number
    ganho: number
    tipo?: OscillatorType
    freqFinal?: number
    atraso?: number
    reverb?: number
    pan?: number
  }): void {
    const ctx = this.context
    if (!ctx || !this.master) return

    const inicio = ctx.currentTime + (opcoes.atraso ?? 0)
    const osc = ctx.createOscillator()
    osc.type = opcoes.tipo ?? 'square'
    osc.frequency.setValueAtTime(opcoes.freq, inicio)
    if (opcoes.freqFinal !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(
        Math.max(1, opcoes.freqFinal),
        inicio + opcoes.duracao,
      )
    }

    const envelope = ctx.createGain()
    envelope.gain.setValueAtTime(0.0001, inicio)
    envelope.gain.exponentialRampToValueAtTime(opcoes.ganho, inicio + 0.002)
    envelope.gain.exponentialRampToValueAtTime(0.0001, inicio + opcoes.duracao)

    const panner = ctx.createStereoPanner()
    panner.pan.value = opcoes.pan ?? 0

    osc.connect(envelope)
    envelope.connect(panner)
    panner.connect(this.master)

    if (opcoes.reverb && this.reverbSend) {
      const envio = ctx.createGain()
      envio.gain.value = opcoes.reverb
      panner.connect(envio)
      envio.connect(this.reverbSend)
    }

    osc.start(inicio)
    osc.stop(inicio + opcoes.duracao + 0.02)
  }

  /**
   * Disparo do jogador.
   *
   * As quatro camadas saem juntas, com pesos diferentes por arma. A escopeta
   * carrega nos graves e tem cauda longa; o rifle troca peso por estalo e
   * fecha mais rapido.
   */
  shot(kind: ShotKind): void {
    // Variacao de 6% no volume e no brilho entre disparos. Sem ela, a repeticao
    // denuncia a sintese em dois tiros seguidos.
    const v = 0.94 + Math.random() * 0.12

    if (kind === 'shotgun') {
      // Onda de choque: grave, forte, com a frequencia caindo enquanto expande.
      this.camadaRuido({ duracao: 0.34, ganho: 0.95 * v, tipo: 'lowpass', freq: 900, freqFinal: 90, reverb: 0.85 })
      // Corpo: a faixa media que da volume ao estouro.
      this.camadaRuido({ duracao: 0.20, ganho: 0.55 * v, tipo: 'bandpass', freq: 1100, freqFinal: 380, q: 0.7, reverb: 0.7 })
      // Estalo: curtissimo e agudo, o que faz parecer perto.
      this.camadaRuido({ duracao: 0.05, ganho: 0.5 * v, tipo: 'highpass', freq: 2600, freqFinal: 6500, reverb: 0.3 })
      // Componente de pressao: quase infrassom, sentido mais que ouvido.
      this.tom({ freq: 118, duracao: 0.16, ganho: 0.45 * v, tipo: 'sine', freqFinal: 42, reverb: 0.5 })
      // Bomba da escopeta, 130 ms depois: dois cliques metalicos.
      this.camadaRuido({ duracao: 0.035, ganho: 0.16, tipo: 'bandpass', freq: 2400, q: 3, atraso: 0.13 })
      this.camadaRuido({ duracao: 0.045, ganho: 0.19, tipo: 'bandpass', freq: 1700, q: 3, atraso: 0.24 })
      return
    }

    if (kind === 'rifle') {
      this.camadaRuido({ duracao: 0.19, ganho: 0.72 * v, tipo: 'lowpass', freq: 1500, freqFinal: 150, reverb: 0.8 })
      this.camadaRuido({ duracao: 0.11, ganho: 0.6 * v, tipo: 'bandpass', freq: 2400, freqFinal: 900, q: 0.9, reverb: 0.6 })
      // Estalo dominante: e o que separa rifle de escopeta ao ouvido.
      this.camadaRuido({ duracao: 0.045, ganho: 0.72 * v, tipo: 'highpass', freq: 3800, freqFinal: 9000, reverb: 0.35 })
      this.tom({ freq: 190, duracao: 0.09, ganho: 0.3 * v, tipo: 'sine', freqFinal: 70, reverb: 0.4 })
      // Ferrolho voltando, bem mais rapido que a bomba da escopeta.
      this.camadaRuido({ duracao: 0.03, ganho: 0.14, tipo: 'bandpass', freq: 3200, q: 4, atraso: 0.055 })
      return
    }

    this.camadaRuido({ duracao: 0.12, ganho: 0.6 * v, tipo: 'lowpass', freq: 1800, freqFinal: 240, reverb: 0.6 })
    this.camadaRuido({ duracao: 0.04, ganho: 0.45 * v, tipo: 'highpass', freq: 3000, freqFinal: 7000, reverb: 0.3 })
    this.tom({ freq: 240, duracao: 0.06, ganho: 0.22 * v, tipo: 'sine', freqFinal: 90 })
  }

  /**
   * Disparo de um inimigo, posicionado no estereo.
   *
   * @param anguloRelativo radianos em relacao a direcao do olhar; 0 e a frente.
   * @param distancia em map units.
   *
   * Direcao e distancia no som fazem o mesmo trabalho que o marcador na tela:
   * dizem de onde veio. Aqui o ouvido costuma chegar antes do olho.
   */
  enemyShot(anguloRelativo: number, distancia: number): void {
    // Quem esta a frente ou atras fica no centro; o maximo de lateralidade
    // acontece a noventa graus. O seno do angulo entrega exatamente isso.
    const pan = Math.max(-1, Math.min(1, Math.sin(anguloRelativo)))

    // Queda com a distancia, com piso para nao sumir de vez: tiro inaudivel e
    // o mesmo problema de tiro invisivel.
    const perto = Math.max(0.22, Math.min(1, 900 / Math.max(120, distancia)))

    // O ar absorve agudo antes de grave: longe, o tiro chega abafado. E essa
    // diferenca de timbre que o ouvido usa para estimar distancia.
    const brilho = 2200 * perto + 400

    this.camadaRuido({
      duracao: 0.16, ganho: 0.5 * perto, tipo: 'lowpass',
      freq: brilho, freqFinal: 160, reverb: 0.9, pan,
    })
    this.camadaRuido({
      duracao: 0.05, ganho: 0.3 * perto * perto, tipo: 'highpass',
      freq: 2600, freqFinal: 5200, reverb: 0.4, pan,
    })
  }

  /** Chumbo ou bala batendo em superficie dura. */
  hit(): void {
    this.camadaRuido({ duracao: 0.045, ganho: 0.4, tipo: 'highpass', freq: 4200, freqFinal: 1800, reverb: 0.25 })
  }

  enemyPain(): void {
    this.tom({
      freq: 170 + Math.random() * 80, duracao: 0.14, ganho: 0.3,
      tipo: 'sawtooth', freqFinal: 80, reverb: 0.3,
    })
  }

  enemyDeath(): void {
    this.tom({ freq: 150, duracao: 0.45, ganho: 0.34, tipo: 'sawtooth', freqFinal: 36, reverb: 0.5 })
    this.camadaRuido({ duracao: 0.32, ganho: 0.28, tipo: 'lowpass', freq: 1200, freqFinal: 150, reverb: 0.5 })
  }

  playerHurt(): void {
    this.tom({ freq: 88, duracao: 0.22, ganho: 0.42, tipo: 'triangle', freqFinal: 52 })
    this.camadaRuido({ duracao: 0.1, ganho: 0.2, tipo: 'lowpass', freq: 700, freqFinal: 200 })
  }

  /** Troca de arma: dois cliques mecanicos. */
  weaponSwap(): void {
    this.camadaRuido({ duracao: 0.03, ganho: 0.16, tipo: 'bandpass', freq: 2800, q: 4 })
    this.camadaRuido({ duracao: 0.04, ganho: 0.2, tipo: 'bandpass', freq: 1900, q: 3, atraso: 0.11 })
  }

  waveStart(): void {
    this.tom({ freq: 330, duracao: 0.15, ganho: 0.26, reverb: 0.6 })
    this.tom({ freq: 495, duracao: 0.24, ganho: 0.26, atraso: 0.13, reverb: 0.6 })
  }

  gameOver(): void {
    this.tom({ freq: 220, duracao: 0.8, ganho: 0.4, tipo: 'sawtooth', freqFinal: 50, reverb: 0.8 })
  }
}

/** Cria o contexto de audio do navegador, se houver suporte. */
function criarContexto(): AudioContext | null {
  const Ctor = window.AudioContext ?? (window as unknown as {
    webkitAudioContext?: typeof AudioContext
  }).webkitAudioContext

  return Ctor ? new Ctor() : null
}

/** Ruido branco em estereo, gerado uma vez e reaproveitado. */
function criarRuido(ctx: BaseAudioContext, segundos: number): AudioBuffer {
  const quadros = Math.floor(ctx.sampleRate * segundos)
  const buffer = ctx.createBuffer(2, quadros, ctx.sampleRate)

  for (let canal = 0; canal < 2; canal++) {
    const dados = buffer.getChannelData(canal)
    for (let i = 0; i < quadros; i++) dados[i] = Math.random() * 2 - 1
  }

  return buffer
}

/**
 * Resposta ao impulso de um galpao de concreto.
 *
 * Duas partes, e as duas importam:
 *
 *   Reflexoes iniciais — poucos ecos discretos nos primeiros 60 ms, vindos das
 *   paredes mais proximas. Sao elas que informam ao ouvido o TAMANHO do lugar.
 *   Sem elas o reverbo soa como efeito de pedal, nao como sala.
 *
 *   Cauda difusa — ruido decaindo exponencialmente, com os agudos morrendo
 *   antes dos graves, porque o ar e as superficies absorvem mais agudo.
 */
function criarRespostaAoImpulso(ctx: BaseAudioContext, segundos: number): AudioBuffer {
  const taxa = ctx.sampleRate
  const quadros = Math.floor(taxa * segundos)
  const buffer = ctx.createBuffer(2, quadros, taxa)

  // Atrasos das primeiras reflexoes, em milissegundos, e sua forca.
  // Forcas bem abaixo do som direto. Na primeira versao chegavam a 0,62 e o
  // pico do disparo caia na reflexao de 23 ms, medido — ou seja, a arena soava
  // mais alto que a propria arma. E o som de quem esta longe do tiro, nao de
  // quem atirou.
  const reflexoes: Array<[number, number]> = [
    [11, 0.26], [17, 0.20], [23, 0.23], [31, 0.15],
    [43, 0.12], [57, 0.10], [73, 0.075],
  ]

  for (let canal = 0; canal < 2; canal++) {
    const dados = buffer.getChannelData(canal)
    // Pequena diferenca entre os canais: identico nos dois soa dentro da
    // cabeca, e nao em volta.
    const desvio = canal === 0 ? 1 : 1.06

    let suavizado = 0
    for (let i = 0; i < quadros; i++) {
      const t = i / quadros
      const decaimento = Math.pow(1 - t, 2.6)
      const branco = Math.random() * 2 - 1

      // Passa-baixa de um polo, cada vez mais fechado com o tempo: e assim que
      // o brilho da cauda morre antes do corpo.
      const abertura = 0.55 - t * 0.42
      suavizado += (branco - suavizado) * Math.max(0.06, abertura)
      dados[i] = suavizado * decaimento * 0.55
    }

    for (const [ms, forca] of reflexoes) {
      const indice = Math.floor((ms * desvio * taxa) / 1000)
      if (indice < quadros) {
        dados[indice] = dados[indice]! + (Math.random() > 0.5 ? forca : -forca)
      }
    }
  }

  return buffer
}

/**
 * Curva de saturacao suave.
 *
 * Arma de fogo de perto satura qualquer microfone, e o ouvido espera essa
 * compressao no pico. Sem ela o disparo soa limpo demais — correto, e falso.
 */
function curvaDeSaturacao(intensidade: number): Float32Array<ArrayBuffer> {
  const amostras = 1024
  const curva = new Float32Array(new ArrayBuffer(amostras * 4))

  for (let i = 0; i < amostras; i++) {
    const x = (i * 2) / amostras - 1
    curva[i] = Math.tanh(x * intensidade) / Math.tanh(intensidade)
  }

  return curva
}
