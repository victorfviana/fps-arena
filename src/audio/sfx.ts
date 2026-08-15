import { amostraCrua } from './samples'

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
 * ADR 0004: o disparo do jogador (e o do inimigo) agora e HIBRIDO. Duas
 * gravacoes (public/sounds/shotgun.wav e rifle.wav, ver samples.ts) entram
 * como CORPO do som e passam pela mesma acustica — saturacao, compressor,
 * reverb por convolucao, abafamento por distancia. A borda seca (<2 ms) e o
 * grave sintetico de pressao continuam por cima, gravados ou nao. Sem a
 * amostra (fetch falhou, ou ainda nao terminou de decodificar), o disparo
 * cai de volta na cadeia 100% sintetica de sempre — nunca quebra.
 */

/** Duracao da cauda do ambiente, em segundos. */
const REVERB_SEGUNDOS = 1.6

/** Buffer de ruido pre-gerado, para nao alocar a cada disparo. */
const RUIDO_SEGUNDOS = 2

/**
 * Constantes de calibracao do corpo hibrido (amostra gravada). Mexer aqui se
 * o Victor achar o tiro alto/baixo/estridente demais ao ouvir no jogo — nao
 * precisa mexer na estrutura da cadeia para isso.
 */
// Ganho do corpo (amostra) por arma. Mantido bem abaixo de 1: a gravacao ja
// vem com harmonicos fortes, e ganho alto aqui e o que faz o compressor
// bombear (ADR 0004 pede para nao acionar o limitador com a amostra).
// Medido no navegador em 14/08: com 0.6/0.52 o pico do disparo saia 10x acima
// do resto da mixagem (0,53 contra 0,055 do conjunto sintetico) e enterrava
// dor, passos e interface. Estes valores poem o corpo gravado ~4x acima do
// mix antigo — mais presenca sem apagar o resto.
const GANHO_CORPO_AMOSTRA_SHOTGUN = 0.42
const GANHO_CORPO_AMOSTRA_RIFLE = 0.36
// Proporcao enviada ao reverb quando o corpo e a amostra (nao a sintese).
// A gravacao ja carrega a propria sala (1,2-1,9 s de cauda no arquivo).
// Enviar muito dela para a convolucao soma sala sobre sala e o molhado
// ultrapassa o seco — medido: pico do envelope migrava para ~226 ms.
const REVERB_CORPO_AMOSTRA_JOGADOR = 0.15
const REVERB_CORPO_AMOSTRA_INIMIGO = 0.45
// Ganho do corpo do tiro inimigo (amostra), antes de escalar por `perto`.
const GANHO_CORPO_AMOSTRA_INIMIGO = 0.3

/** Amostra decodificada com o silencio de entrada ja medido. */
interface AmostraDecodificada {
  buffer: AudioBuffer
  /** Onde o som de fato comeca, em segundos. */
  inicioS: number
}

/**
 * Primeira passagem acima de 2% do pico, com 2 ms de folga. As gravacoes do
 * pack tem ~200 ms de silencio de entrada; sem o recorte, o tiro inteiro sai
 * esse atraso depois do gatilho — atraso que o jogador sente na mao.
 */
function inicioDoSom(buffer: AudioBuffer): number {
  const canal = buffer.getChannelData(0)
  let pico = 0
  for (let i = 0; i < canal.length; i++) pico = Math.max(pico, Math.abs(canal[i]!))
  const limiar = pico * 0.02
  for (let i = 0; i < canal.length; i++) {
    if (Math.abs(canal[i]!) >= limiar) return Math.max(0, i / buffer.sampleRate - 0.002)
  }
  return 0
}
// Faixa de variacao aleatoria de playbackRate por disparo do jogador — e o
// que evita dois tiros seguidos soarem identicos, ja que so ha uma gravacao
// por arma.
const JITTER_PLAYBACK_MIN = 0.96
const JITTER_PLAYBACK_MAX = 1.05

export type ShotKind = 'shotgun' | 'rifle'

export class Sfx {
  private context: BaseAudioContext | null = null
  private master: GainNode | null = null
  /**
   * Barramento seco, em paralelo ao compressor, direto para o destino.
   *
   * Nenhum caminho antigo escapava de saturacao+compressor: o ataque medido
   * do disparo ficava em 9-10 ms so por causa da cadeia, nao do envelope (que
   * sobe em 0,4 ms). Camadas curtissimas marcadas `seco: true` usam este
   * barramento para a borda do ataque chegar ao destino sem esperar os dois.
   */
  private dryBus: GainNode | null = null
  /** Entrada da cauda do ambiente; tudo que deve ecoar passa por aqui. */
  private reverbSend: GainNode | null = null
  private ruido: AudioBuffer | null = null
  private saturacao: WaveShaperNode | null = null
  private muted = false
  /** Amostras gravadas ja decodificadas NESTE contexto (decode e por contexto). */
  private amostras: Partial<Record<ShotKind, AmostraDecodificada>> = {}
  /**
   * Resolve quando a decodificacao das amostras (as que existirem no cache
   * de samples.ts) terminar. `resume()` dispara e nao espera — o jogo normal
   * nao pode atrasar o primeiro disparo por causa de um decode assincrono; o
   * proprio `shot()`/`enemyShot()` cai no sintetico se a amostra ainda nao
   * estiver pronta. So `medirTiro` (main.ts) precisa aguardar isto, para
   * medir o hibrido em vez da sintese pura.
   */
  private amostrasProntas: Promise<void> | null = null

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
      // Rede de seguranca, nao ferramenta de timbre.
      //
      // Com limiar em -9 dB as camadas somadas o acionavam a cada disparo: ele
      // abaixava o transiente e soltava logo depois, e o envelope terminava
      // com pico em 41 ms — bombeamento medido, nao suposto. Limiar alto e
      // taxa baixa deixam o compressor so aparar somas de varios disparos
      // simultaneos, que e para o que ele serve aqui.
      compressor.threshold.value = -3
      // Knee estreito de proposito: com 10 dB (e pior, com os 30 do default) a
      // compressao comeca bem abaixo do limiar e achata a dinamica do corpo
      // gravado — medido: o envelope virava plato e o pico migrava para
      // ~230 ms. Rede de seguranca so age perto do teto.
      compressor.knee.value = 4
      compressor.ratio.value = 3
      compressor.attack.value = 0.0008
      compressor.release.value = 0.25

      this.master = ctx.createGain()
      this.master.gain.value = 0.72
      this.master.connect(compressor)
      compressor.connect(ctx.destination)

      // Paralelo ao compressor, nao em serie: e assim que a borda seca escapa
      // do guarda-corpo sem herdar o releitor de 0,8 ms do compressor.
      this.dryBus = ctx.createGain()
      this.dryBus.gain.value = 0.9
      this.dryBus.connect(ctx.destination)

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

      // Dispara o decode das amostras gravadas (se o fetch em samples.ts ja
      // tiver terminado) sem esperar por ele: decode e assincrono, mas o
      // primeiro disparo nao pode ficar mudo ate ele terminar.
      this.amostrasProntas = this.decodificarAmostras()
    }

    // Contexto offline nao tem (nem precisa de) resume.
    if ('resume' in this.context) void (this.context as AudioContext).resume()
  }

  /**
   * Resolve quando o decode das amostras (se houver) tiver terminado.
   *
   * O jogo normal nunca chama isto. Existe para `medirTiro`: sem aguardar
   * aqui antes do disparo medido, a renderizacao offline mediria so a
   * sintese, mesmo com a amostra disponivel.
   */
  async aguardarAmostras(): Promise<void> {
    await this.amostrasProntas
  }

  /** Decodifica, uma vez por instancia/contexto, cada amostra que o cache de
   *  samples.ts tiver disponivel. Amostra ausente ou erro de decode: segue
   *  sem ela, o disparo correspondente cai no caminho sintetico. */
  private async decodificarAmostras(): Promise<void> {
    const ctx = this.context
    if (!ctx) return

    const kinds: ShotKind[] = ['shotgun', 'rifle']
    await Promise.all(
      kinds.map(async (kind) => {
        const bytesCrus = amostraCrua(kind)
        if (!bytesCrus) return
        try {
          const buffer = await ctx.decodeAudioData(bytesCrus)
          this.amostras[kind] = { buffer, inicioS: inicioDoSom(buffer) }
        } catch (erro) {
          console.warn(`[audio] falha ao decodificar a amostra de ${kind}; seguindo so com a sintese.`, erro)
        }
      }),
    )
  }

  /**
   * Retoma o contexto sozinho quando a aba volta a ficar visivel.
   *
   * Chrome e Safari suspendem o AudioContext ao trocar de aba; sem isso o
   * jogador volta e o jogo fica mudo ate o proximo gesto que dispare
   * `resume()` de novo. So registra o listener se `document` existir — o
   * contexto offline de `medirTiro` nao tem (nem precisa).
   */
  instalarAutoResume(): void {
    if (typeof document === 'undefined') return
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return
      const ctx = this.context
      if (ctx && 'state' in ctx && (ctx as AudioContext).state === 'suspended') this.resume()
    })
  }

  toggleMute(): boolean {
    this.muted = !this.muted
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.72
    // O dryBus e paralelo ao master, entao mudo nele nao silencia o dryBus.
    if (this.dryBus) this.dryBus.gain.value = this.muted ? 0 : 0.9
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
    /**
     * Quando true, pula saturacao+compressor e vai direto ao dryBus (destino
     * fixo). Nunca cria envio de reverb: a cauda so faz sentido para o som
     * molhado, e o barramento seco existe justamente para nao esperar por ela.
     */
    seco?: boolean
  }): void {
    const ctx = this.context
    if (!ctx || !this.ruido) return
    const destino = opcoes.seco ? this.dryBus : this.saturacao
    if (!destino) return

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
    panner.connect(destino)

    if (opcoes.reverb && this.reverbSend && !opcoes.seco) {
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
   * Corpo do disparo do jogador quando ha amostra gravada: fonte -> ganho ->
   * saturacao (cadeia molhada normal) + envio de reverb. Jitter de
   * playbackRate a cada chamada — e o que evita dois tiros identicos, ja que
   * so ha uma gravacao por arma.
   */
  private tocarCorpoAmostra(amostra: AmostraDecodificada, ganho: number, reverb: number): void {
    const ctx = this.context
    if (!ctx || !this.saturacao) return

    const fonte = ctx.createBufferSource()
    fonte.buffer = amostra.buffer
    fonte.playbackRate.value =
      JITTER_PLAYBACK_MIN + Math.random() * (JITTER_PLAYBACK_MAX - JITTER_PLAYBACK_MIN)

    const envelope = ctx.createGain()
    envelope.gain.value = ganho

    fonte.connect(envelope)
    // Direto ao master, SEM a saturacao — mesmo precedente do tom(). A
    // captacao de arma ja vem saturada de origem, e o tanh normalizado
    // levanta o trecho quieto ~2x: passava o corpo gravado por ele e o
    // envelope virava plato com pico em ~230 ms (medido).
    if (this.master) envelope.connect(this.master)

    if (reverb && this.reverbSend) {
      const envio = ctx.createGain()
      envio.gain.value = reverb
      envelope.connect(envio)
      envio.connect(this.reverbSend)
    }

    fonte.start(ctx.currentTime, amostra.inicioS)
  }

  /**
   * Corpo do disparo INIMIGO quando ha amostra gravada: fonte -> lowpass (a
   * mesma curva de abafamento por distancia do caminho sintetico) ->
   * panner -> saturacao + reverb mais molhado. Sem jitter aqui — o
   * afastamento e o pan ja bastam para diferenciar disparos inimigos entre
   * si, e a spec so pede jitter para o tiro do jogador.
   */
  private tocarCorpoAmostraInimigo(
    amostra: AmostraDecodificada,
    ganho: number,
    freqCorte: number,
    pan: number,
    reverb: number,
  ): void {
    const ctx = this.context
    if (!ctx || !this.saturacao) return

    const fonte = ctx.createBufferSource()
    fonte.buffer = amostra.buffer

    const filtro = ctx.createBiquadFilter()
    filtro.type = 'lowpass'
    filtro.frequency.value = freqCorte

    const envelope = ctx.createGain()
    envelope.gain.value = ganho

    const panner = ctx.createStereoPanner()
    panner.pan.value = pan

    fonte.connect(filtro)
    filtro.connect(envelope)
    envelope.connect(panner)
    // Mesmo desvio da saturacao do corpo do jogador — ver tocarCorpoAmostra.
    if (this.master) panner.connect(this.master)

    if (reverb && this.reverbSend) {
      const envio = ctx.createGain()
      envio.gain.value = reverb
      panner.connect(envio)
      envio.connect(this.reverbSend)
    }

    fonte.start(ctx.currentTime, amostra.inicioS)
  }

  /**
   * Disparo do jogador.
   *
   * As quatro camadas saem juntas, com pesos diferentes por arma. A escopeta
   * carrega nos graves e tem cauda longa; o rifle troca peso por estalo e
   * fecha mais rapido.
   *
   * ADR 0004: quando a amostra gravada da arma ja decodificou, ela substitui
   * SO as camadas sinteticas de corpo/estalo/onda de choque (a gravacao ja
   * carrega tudo isso). Borda seca, tom de pressao e mecanica continuam
   * sempre, gravado ou nao.
   */
  shot(kind: ShotKind): void {
    // Variacao de 6% no volume e no brilho entre disparos. Sem ela, a repeticao
    // denuncia a sintese em dois tiros seguidos.
    const v = 0.94 + Math.random() * 0.12
    const amostra = this.amostras[kind]

    if (kind === 'shotgun') {
      if (amostra) {
        // A gravacao e o corpo inteiro: onda de choque + corpo + estalo, tudo
        // que as tres camadas sinteticas abaixo faziam.
        this.tocarCorpoAmostra(amostra, GANHO_CORPO_AMOSTRA_SHOTGUN * v, REVERB_CORPO_AMOSTRA_JOGADOR)
      } else {
        // Onda de choque: grave, forte, com a frequencia caindo enquanto expande.
        this.camadaRuido({ duracao: 0.34, ganho: 0.55 * v, tipo: 'lowpass', freq: 900, freqFinal: 90, reverb: 0.85 })
        // Corpo: a faixa media que da volume ao estouro.
        this.camadaRuido({ duracao: 0.20, ganho: 0.32 * v, tipo: 'bandpass', freq: 1100, freqFinal: 380, q: 0.7, reverb: 0.7 })
        // Estalo: curtissimo e agudo, o que faz parecer perto.
        this.camadaRuido({ duracao: 0.05, ganho: 0.30 * v, tipo: 'highpass', freq: 2600, freqFinal: 6500, reverb: 0.3 })
      }
      // Borda seca: nao substitui o estalo acima (que da o corpo) — so cobre
      // os primeiros ~10 ms que saturacao+compressor atrasavam em 9-10 ms.
      this.camadaRuido({ duracao: 0.010, ganho: 0.16 * v, tipo: 'highpass', freq: 3200, seco: true })
      // Componente de pressao: quase infrassom, sentido mais que ouvido.
      this.tom({ freq: 118, duracao: 0.16, ganho: 0.26 * v, tipo: 'sine', freqFinal: 42, reverb: 0.5 })
      // Bomba da escopeta, 130 ms depois: dois cliques metalicos.
      //
      // Bem abaixo do disparo. Quando as camadas principais foram reduzidas e
      // estas nao, o clique de 240 ms virou o ponto mais alto do som inteiro —
      // medido no envelope. Mecanica de arma se ouve depois do tiro, nunca por
      // cima dele.
      this.camadaRuido({ duracao: 0.035, ganho: 0.055, tipo: 'bandpass', freq: 2400, q: 3, atraso: 0.13 })
      this.camadaRuido({ duracao: 0.045, ganho: 0.065, tipo: 'bandpass', freq: 1700, q: 3, atraso: 0.24 })
      return
    }

    if (kind === 'rifle') {
      if (amostra) {
        this.tocarCorpoAmostra(amostra, GANHO_CORPO_AMOSTRA_RIFLE * v, REVERB_CORPO_AMOSTRA_JOGADOR)
      } else {
        this.camadaRuido({ duracao: 0.19, ganho: 0.42 * v, tipo: 'lowpass', freq: 1500, freqFinal: 150, reverb: 0.8 })
        this.camadaRuido({ duracao: 0.11, ganho: 0.35 * v, tipo: 'bandpass', freq: 2400, freqFinal: 900, q: 0.9, reverb: 0.6 })
        // Estalo dominante: e o que separa rifle de escopeta ao ouvido.
        this.camadaRuido({ duracao: 0.045, ganho: 0.44 * v, tipo: 'highpass', freq: 3800, freqFinal: 9000, reverb: 0.35 })
      }
      // Borda seca: mesma logica da escopeta, ganho igual ao estalo molhado.
      this.camadaRuido({ duracao: 0.010, ganho: 0.16 * v, tipo: 'highpass', freq: 3200, seco: true })
      this.tom({ freq: 190, duracao: 0.09, ganho: 0.18 * v, tipo: 'sine', freqFinal: 70, reverb: 0.4 })
      // Ferrolho voltando, bem mais rapido que a bomba da escopeta.
      this.camadaRuido({ duracao: 0.03, ganho: 0.05, tipo: 'bandpass', freq: 3200, q: 4, atraso: 0.055 })
      return
    }
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

    // O evento de tiro inimigo nao carrega qual arma foi usada (so o
    // jogador troca de kind) — o rifle e o som padrao de tiro a distancia,
    // entao e a amostra usada aqui quando disponivel.
    const amostra = this.amostras.rifle
    if (amostra) {
      this.tocarCorpoAmostraInimigo(
        amostra,
        GANHO_CORPO_AMOSTRA_INIMIGO * perto,
        brilho,
        pan,
        REVERB_CORPO_AMOSTRA_INIMIGO,
      )
      return
    }

    this.camadaRuido({
      duracao: 0.16, ganho: 0.5 * perto, tipo: 'lowpass',
      freq: brilho, freqFinal: 160, reverb: 0.9, pan,
    })
    // perto ao quadrado e proposital: a absorcao do ar ja entra em `brilho`
    // (banda), e reforca-la tambem no ganho da banda aguda deixa a distancia
    // mais legivel ao ouvido do que modelar so uma vez.
    this.camadaRuido({
      duracao: 0.05, ganho: 0.3 * perto * perto, tipo: 'highpass',
      freq: 2600, freqFinal: 5200, reverb: 0.4, pan,
    })
  }

  /**
   * Passo do jogador: ruido curtissimo e baixo, so para dar presenca ao
   * andar sem competir com o resto da mixagem.
   *
   * Reusa `this.ruido` via `camadaRuido` (que ja le um trecho aleatorio do
   * buffer) — zero alocacao nova por passo. A pequena variacao de frequencia
   * entre chamadas evita o "clique metronomico" de repetir o mesmo som.
   */
  playerStep(): void {
    const variacao = 0.85 + Math.random() * 0.3
    this.camadaRuido({
      duracao: 0.04 + Math.random() * 0.02,
      ganho: 0.05 + Math.random() * 0.03,
      tipo: 'lowpass',
      freq: 650 * variacao,
      freqFinal: 140,
    })
  }

  /**
   * Passo de um inimigo, posicionado no estereo como o tiro dele.
   *
   * @param pan mesmo calculo do `enemyShot`: seno do angulo relativo.
   * @param perto mesma escala 0..1 de proximidade do `enemyShot`.
   *
   * Retorna cedo abaixo de 0,35: com ate 14 inimigos em cena, tocar passo de
   * quem esta longe vira cacofonia sem acrescentar leitura nenhuma.
   */
  enemyStep(pan: number, perto: number): void {
    if (perto < 0.35) return
    const variacao = 0.85 + Math.random() * 0.3
    this.camadaRuido({
      duracao: 0.035 + Math.random() * 0.015,
      ganho: (0.018 + Math.random() * 0.012) * perto,
      tipo: 'lowpass',
      freq: 550 * variacao,
      freqFinal: 130,
      pan,
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

  /**
   * Morte do jogador: impacto grave e curto seguido de tom descendente
   * rapido. Diferente de `playerHurt` (que e reversivel e repete a cada
   * dano) — este toca uma vez so, e precisa soar definitivo.
   */
  playerDeath(): void {
    this.camadaRuido({ duracao: 0.14, ganho: 0.5, tipo: 'lowpass', freq: 500, freqFinal: 70 })
    this.tom({ freq: 160, duracao: 0.32, ganho: 0.4, tipo: 'sawtooth', freqFinal: 28, reverb: 0.35 })
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
