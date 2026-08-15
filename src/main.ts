/**
 * Montagem do jogo.
 *
 * A simulacao roda a 35 tics por segundo; o desenho roda na taxa do monitor e
 * interpola entre o tic anterior e o atual. Por isso guardamos a posicao
 * previa: sem ela, um monitor de 144 Hz mostraria o mesmo quadro varias vezes
 * e o movimento pareceria engasgado mesmo com a fisica correta.
 */

import { Sfx } from './audio/sfx'
import {
  FOV_HORIZONTAL_DEG,
  TERMINAL_SPEED,
  TICRATE,
  TIC_MS,
  perTicToPerSecond,
} from './core/doom'
import { currentWeapon, swapProgress } from './weapons/aiming'
import { LOADOUT, effectiveFov } from './weapons/loadout'
import { resetEnemyIds } from './enemies/enemy'
import { carregarAmostrasDeTiro } from './audio/samples'
import { carregarModelosInimigos } from './render/enemyModels'
import { carregarProps } from './render/worldProps'
import { carregarTexturasDeMundo } from './render/worldTextures'
import { Input } from './core/input'
import { FixedTimestepLoop } from './core/loop'
import { Game } from './game'
import { Hud } from './hud'
import { wirePointerLockOverlay } from './menu'
import { EnemyRenderer } from './render/enemyView'
import { Renderer } from './render/renderer'

/** Busca um elemento obrigatorio e falha alto se a pagina mudou de forma. */
function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector)
  if (!element) throw new Error(`Elemento ausente na pagina: ${selector}`)
  return element
}

const canvas = requireElement<HTMLCanvasElement>('#canvas')
const overlay = requireElement<HTMLDivElement>('#overlay')
const gameOverScreen = requireElement<HTMLDivElement>('#gameover')
const startButton = requireElement<HTMLButtonElement>('#start')
const restartButton = requireElement<HTMLButtonElement>('#restart')
const statsPanel = requireElement<HTMLPreElement>('#stats')
const scope = requireElement<HTMLDivElement>('#scope')
const crosshair = requireElement<HTMLDivElement>('#crosshair')
const weaponLabel = requireElement<HTMLDivElement>('#weapon')
const finalScore = requireElement<HTMLDivElement>('#final-score')
const finalKills = requireElement<HTMLSpanElement>('#final-kills')
const deathCause = requireElement<HTMLParagraphElement>('#death-cause')
const fimTitulo = requireElement<HTMLHeadingElement>('#fim-titulo')
const waveLabel = requireElement<HTMLDivElement>('#wave-label')

const hud = new Hud({
  root: requireElement<HTMLDivElement>('#hud'),
  health: requireElement<HTMLDivElement>('#health'),
  score: requireElement<HTMLDivElement>('#score'),
  wave: requireElement<HTMLDivElement>('#wave'),
  remaining: requireElement<HTMLSpanElement>('#remaining'),
  damageFlash: requireElement<HTMLDivElement>('#damage-flash'),
  damageArc: requireElement<HTMLDivElement>('#damage-arc'),
  toast: requireElement<HTMLDivElement>('#toast'),
})

/** `?test=1` dispensa o pointer lock, para permitir medicao automatizada. */
const measurementMode = new URLSearchParams(location.search).get('test') === '1'

let game = new Game()
const input = new Input(canvas, { allowUnlocked: measurementMode })
const renderer = new Renderer(canvas, game.arena)
const enemyRenderer = new EnemyRenderer(renderer.scene)
const sfx = new Sfx()
// O navegador pode suspender o contexto de audio fora do fluxo de clique
// (aba em segundo plano); sem isto o jogo ficaria mudo pelo resto da sessao.
sfx.instalarAutoResume()

// Os modelos dos inimigos chegam por rede. O botao de jogar espera por eles
// (ou pela decisao de fallback) para nenhuma view nascer procedural e trocar
// de formato no meio da partida. Falha de rede nao trava nada: o proprio
// carregarModelosInimigos resolve com null e o jogo segue procedural.
startButton.disabled = true
const rotuloJogar = startButton.textContent
startButton.textContent = 'carregando...'
const modelosProntos = Promise.all([
  carregarModelosInimigos(),
  carregarAmostrasDeTiro(),
  carregarTexturasDeMundo(),
  carregarProps(),
]).then(([modelos, , texturas, props]) => {
  if (modelos) enemyRenderer.usarModelos(modelos)
  if (texturas) renderer.usarTexturasDeMundo(texturas)
  if (props) renderer.usarProps(props)
  startButton.disabled = false
  startButton.textContent = rotuloJogar
})

/** Estado do tic anterior, para interpolar o desenho. */
const previous = { x: game.player.x, z: game.player.z, eye: game.eyeY }

/** ~3,6 passos/s a 583 u/s de corrida (TERMINAL_SPEED a 35 tics). */
const PASSO_STRIDE = 160
let passoAcumulado = 0

/** Igual ao STRIDE de render/enemyView.ts (62) — mantenha os dois em sincronia. */
const PASSO_STRIDE_INIMIGO = 62
const passosInimigo = new Map<number, number>()

/** Giro do mouse do ultimo tic, que o desenho usa para o atraso da arma. */
const giroSuavizado = { x: 0, y: 0 }

/**
 * Medidor de latencia de entrada.
 *
 * A rubrica exige responsividade em numero, nao em impressao. Marcamos quando
 * a tecla de movimento desce e paramos quando o jogador de fato se desloca.
 * O valor inclui a espera pelo proximo tic, que e a latencia que o jogador
 * sente — nao so o tempo de processamento.
 */
const latency = {
  pendingSinceMs: null as number | null,
  lastMs: 0,
  worstMs: 0,
  samples: [] as number[],
}

const MOVEMENT_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
])

let showStats = false

document.addEventListener('keydown', (event) => {
  if (event.code === 'F3') {
    event.preventDefault()
    showStats = !showStats
    statsPanel.hidden = !showStats
    return
  }

  if (event.code === 'KeyM') {
    hud.toast(sfx.toggleMute() ? 'som desligado' : 'som ligado', 900)
    return
  }

  if (event.repeat || !input.isLocked) return
  if (MOVEMENT_KEYS.has(event.code) && latency.pendingSinceMs === null) {
    latency.pendingSinceMs = performance.now()
  }
})

// Amostragem de framerate por segundo corrido, e nao media desde o inicio:
// queda momentanea de desempenho precisa aparecer.
const fps = { frames: 0, windowStartMs: performance.now(), value: 0, worst: Infinity }
let lastFrameMs = performance.now()

const loop = new FixedTimestepLoop({
  tickRateHz: TICRATE,
  onTick: () => {
    previous.x = game.player.x
    previous.z = game.player.z
    previous.eye = game.eyeY

    // Sem o ponteiro preso, a partida congela: nada avanca enquanto o jogador
    // esta com o menu aberto ou fora da aba.
    if (!input.isLocked) return

    const command = input.consume()
    const events = game.tick(command)

    // `previous` ainda guarda a posicao pre-tic neste ponto.
    passoAcumulado += Math.hypot(game.player.x - previous.x, game.player.z - previous.z)
    if (passoAcumulado >= PASSO_STRIDE) {
      passoAcumulado %= PASSO_STRIDE
      sfx.playerStep()
    }

    if (events.fired) {
      renderer.onFire(events.traces, game.eyeY)
      sfx.shot(events.weaponFired === 'rifle' ? 'rifle' : 'shotgun')
    }
    if (events.hits > 0) sfx.hit()
    if (events.kills > 0) sfx.enemyDeath()
    else if (events.hits > 0) sfx.enemyPain()

    for (const queda of events.killPositions) {
      renderer.onEnemyDeath(queda.x, queda.y, queda.z)
    }

    if (events.enemyShots.length > 0) {
      renderer.onEnemyFire(events.enemyShots, game.eyeY)

      // Aponta para o golpe mais forte do tic. Varios avisos simultaneos
      // competindo pela mesma borda da tela nao informam nada. Tiro que errou
      // (damage 0) nao acende o aviso vermelho — o traco e o som ja informam.
      const acertos = events.enemyShots.filter((tiro) => tiro.damage > 0)
      if (acertos.length > 0) {
        const pior = acertos.reduce((a, b) => (b.damage > a.damage ? b : a))
        hud.showDamageDirection(anguloRelativo(pior.fromX, pior.fromZ))
      }

      // O mesmo aviso pelo ouvido, que costuma chegar antes do olho: o disparo
      // toca no lado de onde veio, abafado conforme a distancia.
      for (const tiro of events.enemyShots) {
        if (tiro.melee) continue
        const distancia = Math.hypot(
          tiro.fromX - game.player.x,
          tiro.fromZ - game.player.z,
        )
        sfx.enemyShot(
          anguloRelativo(tiro.fromX, tiro.fromZ),
          distancia,
          tiro.kind === 'sergeant' ? 'shotgun' : 'rifle',
        )
      }
    }

    // Passos dos inimigos, no mesmo compasso da animacao das pernas: um som a
    // cada STRIDE percorrido, panorizado e atenuado como o tiro inimigo.
    for (const enemy of game.enemies) {
      if (!enemy.alive) continue
      const passos = Math.floor(enemy.distanceWalked / PASSO_STRIDE_INIMIGO)
      const anterior = passosInimigo.get(enemy.id) ?? 0
      if (passos > anterior) {
        passosInimigo.set(enemy.id, passos)
        const distancia = Math.hypot(enemy.x - game.player.x, enemy.z - game.player.z)
        const perto = Math.max(0.22, Math.min(1, 900 / Math.max(120, distancia)))
        const pan = Math.max(-1, Math.min(1, Math.sin(anguloRelativo(enemy.x, enemy.z))))
        sfx.enemyStep(pan, perto)
      }
    }

    if (events.damageTaken > 0) {
      hud.flashDamage()
      sfx.playerHurt()
    }

    if (events.waveStarted !== null) {
      hud.toast(`onda ${events.waveStarted}`)
      sfx.waveStart()
    }

    if (events.doorOpened !== null) {
      renderer.onDoorOpened(events.doorOpened)
      sfx.porta()
      hud.toast('a porta abriu — avance', 1800)
    }

    if (events.roomEntered !== null) {
      renderer.aoEntrarNaSala(events.roomEntered)
      waveLabel.textContent = `Sala ${events.roomEntered}/3 · onda`
      hud.toast(`sala ${events.roomEntered}/3`, 1600)
    }

    if (events.gameWon) winGame()

    if (events.weaponSwapped) {
      renderer.setWeapon(events.weaponSwapped)
      weaponLabel.textContent = LOADOUT[events.weaponSwapped].label
      sfx.weaponSwap()
    }

    // Acumula o giro do mouse deste tic para o atraso da arma no desenho.
    giroSuavizado.x = command.yawDelta * 5
    giroSuavizado.y = command.pitchDelta * 5

    if (events.playerDied) endGame()

    const moved = game.player.x !== previous.x || game.player.z !== previous.z
    if (moved && latency.pendingSinceMs !== null) {
      latency.lastMs = performance.now() - latency.pendingSinceMs
      latency.worstMs = Math.max(latency.worstMs, latency.lastMs)
      latency.samples.push(latency.lastMs)
      if (latency.samples.length > 200) latency.samples.shift()
      latency.pendingSinceMs = null
    }
  },
  onRender: (alpha) => {
    const now = performance.now()
    const deltaMs = now - lastFrameMs
    lastFrameMs = now

    const x = previous.x + (game.player.x - previous.x) * alpha
    const z = previous.z + (game.player.z - previous.z) * alpha
    const eye = previous.eye + (game.eyeY - previous.eye) * alpha

    const arma = currentWeapon(game.aim)
    const ads = game.aim.adsProgress
    const velocidade = Math.min(
      1,
      Math.hypot(game.player.momentumX, game.player.momentumZ) / TERMINAL_SPEED.forwardRun,
    )

    renderer.updateEffects(deltaMs, {
      swapProgress: swapProgress(game.aim),
      velocidadeNormalizada: velocidade,
      giroMouse: giroSuavizado,
    })
    renderer.setView(
      x, eye, z,
      game.player.yaw, game.player.pitch,
      ads,
      effectiveFov(arma, ads, FOV_HORIZONTAL_DEG),
    )
    enemyRenderer.sync(game.enemies, deltaMs)

    // A luneta so entra quando a mira esta quase fechada: aparecer no meio da
    // transicao esconderia o mundo antes de o zoom compensar a perda de visao.
    //
    // Decidido ANTES de desenhar. Aplicar depois deixava a arma aparecer
    // dentro da luneta por um quadro — visivel, porque a luneta abre de uma
    // vez e o olho pega exatamente esse instante.
    const comLuneta = arma.ads.scoped && ads > 0.72
    scope.classList.toggle('on', comLuneta)
    crosshair.style.opacity = comLuneta || ads > 0.5 ? '0' : '0.85'
    renderer.viewModel.visivel = !comLuneta

    renderer.render()

    hud.update({
      health: game.player.health,
      score: game.score,
      wave: game.wave,
      remaining: game.aliveEnemies,
    })

    fps.frames++
    if (now - fps.windowStartMs >= 1000) {
      fps.value = Math.round((fps.frames * 1000) / (now - fps.windowStartMs))
      // O pior segundo importa mais que a media: engasgo em onda cheia e o
      // que estraga a partida, e some numa media de sessao inteira.
      if (loop.totalTicks > TICRATE * 3) fps.worst = Math.min(fps.worst, fps.value)
      fps.frames = 0
      fps.windowStartMs = now
    }

    if (showStats) updateStats()
  },
})

/**
 * Angulo de um ponto do mundo em relacao a direcao em que o jogador olha.
 *
 * Zero na frente, positivo para a direita. E o que o marcador de dano precisa
 * para girar ate a origem real do golpe.
 */
function anguloRelativo(x: number, z: number): number {
  const anguloAbsoluto = Math.atan2(-(x - game.player.x), -(z - game.player.z))
  let relativo = game.player.yaw - anguloAbsoluto

  // Normaliza para -PI..PI, senao o marcador da a volta pelo caminho longo.
  while (relativo > Math.PI) relativo -= Math.PI * 2
  while (relativo < -Math.PI) relativo += Math.PI * 2

  return relativo
}

function updateStats(): void {
  const speedPerTic = Math.hypot(game.player.momentumX, game.player.momentumZ)
  const sorted = [...latency.samples].sort((a, b) => a - b)
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)]! : 0

  statsPanel.textContent = [
    `fps        ${fps.value}  (pior ${Number.isFinite(fps.worst) ? fps.worst : '-'})`,
    `tics       ${loop.totalTicks}  (perdidos ${loop.droppedTicks})`,
    `tic        ${TIC_MS.toFixed(2)} ms`,
    `velocidade ${perTicToPerSecond(speedPerTic).toFixed(0)} u/s`,
    `posicao    ${game.player.x.toFixed(0)}, ${game.player.z.toFixed(0)}`,
    `latencia   ${latency.lastMs.toFixed(1)} ms  mediana ${median.toFixed(1)}  pior ${latency.worstMs.toFixed(1)}`,
    `inimigos   ${game.aliveEnemies} vivos / ${game.enemies.length} na cena`,
    `onda       ${game.wave}  fase ${game.phase}`,
  ].join('\n')
}

function beginPlaying(): void {
  overlay.hidden = true
  gameOverScreen.hidden = true
  hud.show()
  sfx.resume()
  // Em medicao nao pedimos o ponteiro: o navegador recusaria fora de um gesto
  // do usuario, e a recusa deixaria a partida congelada.
  if (!measurementMode) input.requestLock()
}

/** Frase que explica a morte, em vez de so informar a onda. */
function descreverMorte(): string {
  const causa = game.lastDamage
  if (!causa) return `Voce caiu na onda ${game.wave}.`

  const nome =
    causa.kind === 'imp' ? 'Um imp'
    : causa.kind === 'sergeant' ? 'Um sargento de escopeta'
    : 'Um zumbi'
  const onde = causa.melee
    ? 'chegou perto e te alcancou'
    : `atirou de longe, a ${Math.round(causa.distance)} passos`

  return `${nome} ${onde}. Voce caiu na onda ${game.wave}.`
}

function endGame(): void {
  finalScore.textContent = String(game.score)
  finalKills.textContent = String(game.kills)
  fimTitulo.textContent = 'Fim'
  deathCause.textContent = descreverMorte()
  gameOverScreen.hidden = false
  hud.hide()
  // O golpe final soa distinto do dano comum, antes do jingle de encerramento.
  sfx.playerDeath()
  sfx.gameOver()
  if (document.pointerLockElement) document.exitPointerLock()
}

/** Fim feliz: as tres salas limpas. Reusa a tela de fim com outro texto. */
function winGame(): void {
  finalScore.textContent = String(game.score)
  finalKills.textContent = String(game.kills)
  fimTitulo.textContent = 'Vitoria'
  deathCause.textContent = 'As tres salas estao limpas. A arena e sua.'
  gameOverScreen.hidden = false
  hud.hide()
  sfx.vitoria()
  if (document.pointerLockElement) document.exitPointerLock()
}

function restart(): void {
  game = new Game()
  // Zera os medidores junto com a partida: manter o pior fps de uma sessao
  // anterior faria o diagnostico mentir.
  latency.samples.length = 0
  latency.worstMs = 0
  latency.lastMs = 0
  fps.worst = Infinity
  renderer.resetQualidade()
  renderer.resetPortas()
  renderer.aoEntrarNaSala(1)
  waveLabel.textContent = 'Sala 1/3 · onda'
  hud.reset()
  enemyRenderer.sync([], 0)
  resetEnemyIds()
  passoAcumulado = 0
  passosInimigo.clear()
  previous.x = game.player.x
  previous.z = game.player.z
  previous.eye = game.eyeY
  beginPlaying()
}

startButton.addEventListener('click', beginPlaying)
restartButton.addEventListener('click', restart)

// Perder o ponteiro traz o menu de volta. A decisao e o historico do bug de
// ordem de ouvintes vivem em menu.ts, onde ha teste de regressao com DOM falso.
// `estado` e funcao porque `game` e reatribuido no restart.
wirePointerLockOverlay(
  document,
  {
    overlay,
    lockTarget: canvas,
    hideHud: () => hud.hide(),
    toast: (message, durationMs) => hud.toast(message, durationMs),
  },
  () => ({ phase: game.phase, measurementMode }),
)

input.attach()
loop.start()

if (measurementMode) void modelosProntos.then(beginPlaying)

// Ponto de inspecao para a verificacao automatizada: o navegador headless le
// estes valores em vez de depender de leitura de imagem.
Object.assign(window, {
  __fpsArena: {
    get game() {
      return game
    },
    loop,
    restart,
    renderer,
    /**
     * Troca de arma pelo mesmo caminho que o jogador percorre.
     *
     * Existe porque mexer em `game.aim` direto contorna o tratador de eventos
     * do loop, e a verificacao passa a medir um estado que o jogo real nunca
     * atinge — o rotulo do painel e o modelo na tela ficam para tras.
     */
    /**
     * Renderiza um disparo fora do tempo real e mede o sinal.
     *
     * "Soa real" nao e verificavel por escuta minha, mas a ESTRUTURA e: um
     * disparo tem ataque abaixo de um milissegundo, pico logo no inicio, cauda
     * que decai por mais de um segundo e energia espalhada por toda a banda.
     * Se qualquer um desses numeros estiver errado, o som e outra coisa.
     */
    medirTiro: async (kind: 'shotgun' | 'rifle' = 'shotgun') => {
      const taxa = 48000
      const segundos = 3
      const offline = new OfflineAudioContext(2, taxa * segundos, taxa)

      const aferidor = new Sfx(offline)
      aferidor.resume()
      // Sem este await a amostra ainda nao decodificou e a medicao cairia na
      // sintese pura — mediria o fallback, nao o som que o jogador ouve.
      await aferidor.aguardarAmostras()

      // O disparo sai em t=0,4 s, nao em t=0: o DynamicsCompressor parte de
      // estado frio num contexto recem-criado e engole o inicio do som numa
      // rampa de centenas de ms (medido: primeira janela 0,008 contra 0,181
      // sem compressor). No jogo real ele esta quente ha minutos — atirar no
      // t=0 media um artefato do aferidor, nao o que o jogador ouve.
      const inicioDisparoS = 0.4
      const suspensao = offline.suspend(inicioDisparoS).then(() => {
        aferidor.shot(kind)
        return offline.resume()
      })
      const [rendered] = await Promise.all([offline.startRendering(), suspensao])
      const canal = rendered.getChannelData(0).subarray(Math.floor(taxa * inicioDisparoS))

      /**
       * Envelope por RMS em janelas de 1 ms.
       *
       * Medir o ataque pela maior AMOSTRA nao funciona em sinal ruidoso: o
       * valor instantaneo do ruido e aleatorio, e o maior deles cai em
       * qualquer lugar dentro da envoltoria. A primeira versao deste aferidor
       * fazia isso e reportou "ataque em 37 ms" para um som cujo envelope sobe
       * em menos de um milissegundo — quase me levou a corrigir o que nao
       * estava quebrado.
       */
      const janelaRms = Math.floor(taxa * 0.001)
      const envelope: number[] = []
      for (let inicio = 0; inicio + janelaRms <= canal.length; inicio += janelaRms) {
        let soma = 0
        for (let i = inicio; i < inicio + janelaRms; i++) soma += canal[i]! * canal[i]!
        envelope.push(Math.sqrt(soma / janelaRms))
      }

      let pico = 0
      let indicePico = 0
      for (let i = 0; i < envelope.length; i++) {
        if (envelope[i]! > pico) { pico = envelope[i]!; indicePico = i }
      }

      // As 6 janelas mais fortes (ms e valor), para diagnosticar de ONDE vem
      // um pico de envelope fora do lugar — sem isso o numero unico engana.
      const topoMs = envelope
        .map((valor, ms) => ({ ms, valor: Number(valor.toFixed(4)) }))
        .sort((a, b) => b.valor - a.valor)
        .slice(0, 6)

      const perfilInicial = [2, 8, 15, 25, 35, 50, 80, 120, 160, 200, 240].map((ms) => ({
        ms,
        valor: Number((envelope[ms] ?? 0).toFixed(4)),
      }))

      let picoAmostra = 0
      for (let i = 0; i < canal.length; i++) {
        const v = Math.abs(canal[i]!)
        if (v > picoAmostra) picoAmostra = v
      }

      // Tempo ate o envelope cair 60 dB abaixo do pico: a cauda percebida.
      const limiar = pico * 0.001
      let ultimaJanelaAcima = 0
      for (let i = envelope.length - 1; i >= 0; i--) {
        if (envelope[i]! > limiar) { ultimaJanelaAcima = i; break }
      }
      const ultimoAcimaDoLimiar = ultimaJanelaAcima * janelaRms

      // Energia por banda, por cruzamentos de zero em janelas curtas: caro
      // fazer FFT aqui, e a taxa de cruzamento ja separa grave de agudo.
      //
      // O limiar de energia e relativo ao pico. Fixo em 1e-6, janelas de cauda
      // quase inaudivel entravam na conta com zero cruzamentos e o brilho do
      // meio e do fim saia zerado, o que nao media nada.
      const janela = Math.floor(taxa * 0.02)
      const limiarEnergia = pico * pico * janela * 0.002
      const bandas: number[] = []
      for (let inicio = 0; inicio + janela < canal.length; inicio += janela) {
        let cruzamentos = 0
        let energia = 0
        for (let i = inicio + 1; i < inicio + janela; i++) {
          if ((canal[i]! >= 0) !== (canal[i - 1]! >= 0)) cruzamentos++
          energia += canal[i]! * canal[i]!
        }
        if (energia > limiarEnergia) {
          bandas.push(Math.round((cruzamentos * taxa) / (2 * janela)))
        }
      }

      return {
        picoEnvelope: +pico.toFixed(4),
        picoAmostra: +picoAmostra.toFixed(4),
        // Janelas de 1 ms, entao o indice ja e o tempo em milissegundos.
        ataqueMs: indicePico,
        topoMs,
        perfilInicial,
        caudaMs: +((ultimoAcimaDoLimiar / taxa) * 1000).toFixed(0),
        // Frequencia dominante estimada no inicio, no meio e no fim.
        brilhoInicioHz: bandas[0] ?? 0,
        brilhoMeioHz: bandas[Math.floor(bandas.length / 2)] ?? 0,
        brilhoFimHz: bandas[bandas.length - 1] ?? 0,
        janelasComEnergia: bandas.length,
      }
    },

    trocarArma: (id: 'shotgun' | 'rifle') => {
      const events = game.tick({
        forward: 0, side: 0, yawDelta: 0, pitchDelta: 0,
        run: false, fire: false, aim: false, switchTo: id, cycleWeapon: false,
      })
      if (events.weaponSwapped) {
        renderer.setWeapon(events.weaponSwapped)
        weaponLabel.textContent = LOADOUT[events.weaponSwapped].label
      }
      return events.weaponSwapped
    },
    getStats: () => ({
      fps: fps.value,
      worstFps: Number.isFinite(fps.worst) ? fps.worst : null,
      ticks: loop.totalTicks,
      droppedTicks: loop.droppedTicks,
      speedPerSecond: perTicToPerSecond(
        Math.hypot(game.player.momentumX, game.player.momentumZ),
      ),
      latencyMs: latency.lastMs,
      worstLatencyMs: latency.worstMs,
      latencySamples: latency.samples.length,
      position: { x: game.player.x, z: game.player.z },
      health: game.player.health,
      score: game.score,
      wave: game.wave,
      phase: game.phase,
      enemiesAlive: game.aliveEnemies,
      enemiesInScene: game.enemies.length,
    }),
  },
})
