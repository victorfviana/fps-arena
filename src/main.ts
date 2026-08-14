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
import { Input } from './core/input'
import { FixedTimestepLoop } from './core/loop'
import { Game } from './game'
import { Hud } from './hud'
import { shouldShowMenu } from './menu'
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

/** Estado do tic anterior, para interpolar o desenho. */
const previous = { x: game.player.x, z: game.player.z, eye: game.eyeY }

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
      // competindo pela mesma borda da tela nao informam nada.
      const pior = events.enemyShots.reduce((a, b) => (b.damage > a.damage ? b : a))
      const angulo = anguloRelativo(pior.fromX, pior.fromZ)
      hud.showDamageDirection(angulo)

      // O mesmo aviso pelo ouvido, que costuma chegar antes do olho: o disparo
      // toca no lado de onde veio, abafado conforme a distancia.
      for (const tiro of events.enemyShots) {
        if (tiro.melee) continue
        const distancia = Math.hypot(
          tiro.fromX - game.player.x,
          tiro.fromZ - game.player.z,
        )
        sfx.enemyShot(anguloRelativo(tiro.fromX, tiro.fromZ), distancia)
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
    enemyRenderer.sync(game.enemies)

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

  const nome = causa.kind === 'imp' ? 'Um imp' : 'Um zumbi'
  const onde = causa.melee
    ? 'chegou perto e te alcancou'
    : `atirou de longe, a ${Math.round(causa.distance)} passos`

  return `${nome} ${onde}. Voce caiu na onda ${game.wave}.`
}

function endGame(): void {
  finalScore.textContent = String(game.score)
  finalKills.textContent = String(game.kills)
  deathCause.textContent = descreverMorte()
  gameOverScreen.hidden = false
  hud.hide()
  sfx.gameOver()
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
  hud.reset()
  enemyRenderer.sync([])
  previous.x = game.player.x
  previous.z = game.player.z
  previous.eye = game.eyeY
  beginPlaying()
}

startButton.addEventListener('click', beginPlaying)
restartButton.addEventListener('click', restart)

/**
 * Perder o ponteiro traz o menu de volta, em vez de deixar o jogador mexendo
 * o mouse sem efeito e sem entender por que.
 *
 * Consulta o DOM em vez de perguntar ao Input. A versao anterior lia
 * `input.isLocked`, e este ouvinte estava registrado ANTES do ouvinte do
 * proprio Input — entao, no instante em que o navegador concedia o ponteiro,
 * este rodava primeiro, ainda via `false` e reexibia o menu. Como o menu tem
 * fundo quase opaco, o jogo comecava atras de uma tela escura com os botoes
 * por cima. Depender de ordem de registro entre ouvintes do mesmo evento e
 * fragil; perguntar ao DOM nao tem essa armadilha.
 */
document.addEventListener('pointerlockchange', () => {
  const mostrar = shouldShowMenu({
    pointerLocked: document.pointerLockElement === canvas,
    phase: game.phase,
    measurementMode,
  })

  if (!mostrar) return
  overlay.hidden = false
  hud.hide()
})

/**
 * O navegador pode recusar o ponteiro — foco perdido, pedido logo apos uma
 * saida, politica da pagina. Sem tratar, o jogador clicava em "jogar" e nada
 * acontecia, sem explicacao na tela.
 */
document.addEventListener('pointerlockerror', () => {
  overlay.hidden = false
  hud.hide()
  hud.toast('clique na tela para capturar o mouse', 2500)
})

input.attach()
loop.start()

if (measurementMode) beginPlaying()

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
    medirTiro: async (kind: 'shotgun' | 'rifle' | 'pistol' = 'shotgun') => {
      const taxa = 48000
      const segundos = 2.2
      const offline = new OfflineAudioContext(2, taxa * segundos, taxa)

      const aferidor = new Sfx(offline)
      aferidor.resume()
      aferidor.shot(kind)

      const rendered = await offline.startRendering()
      const canal = rendered.getChannelData(0)

      let pico = 0
      let indicePico = 0
      for (let i = 0; i < canal.length; i++) {
        const v = Math.abs(canal[i]!)
        if (v > pico) { pico = v; indicePico = i }
      }

      // Tempo ate cair 60 dB abaixo do pico: a duracao percebida da cauda.
      const limiar = pico * 0.001
      let ultimoAcimaDoLimiar = 0
      for (let i = canal.length - 1; i >= 0; i--) {
        if (Math.abs(canal[i]!) > limiar) { ultimoAcimaDoLimiar = i; break }
      }

      // Energia por banda, por cruzamentos de zero em janelas curtas: caro
      // fazer FFT aqui, e a taxa de cruzamento ja separa grave de agudo.
      const janela = Math.floor(taxa * 0.02)
      const bandas: number[] = []
      for (let inicio = 0; inicio + janela < canal.length; inicio += janela) {
        let cruzamentos = 0
        let energia = 0
        for (let i = inicio + 1; i < inicio + janela; i++) {
          if ((canal[i]! >= 0) !== (canal[i - 1]! >= 0)) cruzamentos++
          energia += canal[i]! * canal[i]!
        }
        if (energia > 1e-6) bandas.push(Math.round((cruzamentos * taxa) / (2 * janela)))
      }

      return {
        pico: +pico.toFixed(4),
        ataqueMs: +((indicePico / taxa) * 1000).toFixed(2),
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
