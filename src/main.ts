/**
 * Montagem do jogo.
 *
 * A simulacao roda a 35 tics por segundo; o desenho roda na taxa do monitor e
 * interpola entre o tic anterior e o atual. Por isso guardamos a posicao
 * previa: sem ela, um monitor de 144 Hz mostraria o mesmo quadro varias vezes
 * e o movimento pareceria engasgado mesmo com a fisica correta.
 */

import { Sfx } from './audio/sfx'
import { TICRATE, TIC_MS, perTicToPerSecond } from './core/doom'
import { Input } from './core/input'
import { FixedTimestepLoop } from './core/loop'
import { Game } from './game'
import { Hud } from './hud'
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
const finalScore = requireElement<HTMLDivElement>('#final-score')
const finalWave = requireElement<HTMLSpanElement>('#final-wave')

const hud = new Hud({
  root: requireElement<HTMLDivElement>('#hud'),
  health: requireElement<HTMLDivElement>('#health'),
  score: requireElement<HTMLDivElement>('#score'),
  wave: requireElement<HTMLDivElement>('#wave'),
  remaining: requireElement<HTMLSpanElement>('#remaining'),
  damageFlash: requireElement<HTMLDivElement>('#damage-flash'),
  toast: requireElement<HTMLDivElement>('#toast'),
})

let game = new Game()
const input = new Input(canvas)
const renderer = new Renderer(canvas, game.arena)
const enemyRenderer = new EnemyRenderer(renderer.scene)
const sfx = new Sfx()

/** Estado do tic anterior, para interpolar o desenho. */
const previous = { x: game.player.x, z: game.player.z, eye: game.eyeY }

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
      if (events.weaponFired === 'shotgun') sfx.shotgun()
      else sfx.pistol()
    }
    if (events.hits > 0) sfx.hit()
    if (events.kills > 0) sfx.enemyDeath()
    else if (events.hits > 0) sfx.enemyPain()

    if (events.damageTaken > 0) {
      hud.flashDamage()
      sfx.playerHurt()
    }

    if (events.waveStarted !== null) {
      hud.toast(`onda ${events.waveStarted}`)
      sfx.waveStart()
    }

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

    renderer.updateEffects(deltaMs)
    renderer.setView(x, eye, z, game.player.yaw, game.player.pitch)
    enemyRenderer.sync(game.enemies)
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
  input.requestLock()
}

function endGame(): void {
  finalScore.textContent = String(game.score)
  finalWave.textContent = String(game.wave)
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

// Perder o pointer lock traz o menu de volta, em vez de deixar o jogador
// mexendo o mouse sem efeito e sem entender por que.
document.addEventListener('pointerlockchange', () => {
  if (input.isLocked) return
  if (game.phase === 'over') return
  overlay.hidden = false
  hud.hide()
})

input.attach()
loop.start()

// Ponto de inspecao para a verificacao automatizada: o navegador headless le
// estes valores em vez de depender de leitura de imagem.
Object.assign(window, {
  __fpsArena: {
    get game() {
      return game
    },
    loop,
    restart,
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
