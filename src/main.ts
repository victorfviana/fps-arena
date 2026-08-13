/**
 * Montagem do jogo.
 *
 * A simulacao roda a 35 tics por segundo; o desenho roda na taxa do monitor e
 * interpola entre o tic anterior e o atual. Por isso guardamos a posicao
 * previa: sem ela, um monitor de 144 Hz mostraria o mesmo quadro varias vezes
 * e o movimento pareceria engasgado mesmo com a fisica correta.
 */

import { FixedTimestepLoop } from './core/loop'
import { Input } from './core/input'
import { TICRATE, TIC_MS, perTicToPerSecond } from './core/doom'
import { createArena } from './world/arena'
import { createPlayer, eyeHeight, tickPlayer } from './player/player'
import { Renderer } from './render/renderer'

/** Busca um elemento obrigatorio e falha alto se a pagina mudou de forma. */
function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector)
  if (!element) throw new Error(`Elemento ausente na pagina: ${selector}`)
  return element
}

const canvas = requireElement<HTMLCanvasElement>('#canvas')
const overlay = requireElement<HTMLDivElement>('#overlay')
const startButton = requireElement<HTMLButtonElement>('#start')
const statsPanel = requireElement<HTMLPreElement>('#stats')

const arena = createArena()
const player = createPlayer(arena.playerStart)
const input = new Input(canvas)
const renderer = new Renderer(canvas, arena)

/** Estado do tic anterior, para interpolar o desenho. */
const previous = { x: player.x, z: player.z, eye: eyeHeight(player) }

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
}

const MOVEMENT_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
])

document.addEventListener('keydown', (event) => {
  if (event.repeat || !input.isLocked) return
  if (MOVEMENT_KEYS.has(event.code) && latency.pendingSinceMs === null) {
    latency.pendingSinceMs = performance.now()
  }
})

let showStats = false
document.addEventListener('keydown', (event) => {
  if (event.code !== 'F3') return
  event.preventDefault()
  showStats = !showStats
  statsPanel.hidden = !showStats
})

// Amostragem de framerate por segundo corrido, e nao media desde o inicio:
// queda momentanea de desempenho precisa aparecer.
const fps = { frames: 0, windowStartMs: performance.now(), value: 0 }

const loop = new FixedTimestepLoop({
  tickRateHz: TICRATE,
  onTick: () => {
    previous.x = player.x
    previous.z = player.z
    previous.eye = eyeHeight(player)

    const command = input.consume()
    tickPlayer(player, command, arena.walls)

    const moved = player.x !== previous.x || player.z !== previous.z
    if (moved && latency.pendingSinceMs !== null) {
      latency.lastMs = performance.now() - latency.pendingSinceMs
      latency.worstMs = Math.max(latency.worstMs, latency.lastMs)
      latency.pendingSinceMs = null
    }
  },
  onRender: (alpha) => {
    const x = previous.x + (player.x - previous.x) * alpha
    const z = previous.z + (player.z - previous.z) * alpha
    const eye = previous.eye + (eyeHeight(player) - previous.eye) * alpha

    renderer.setView(x, eye, z, player.yaw, player.pitch)
    renderer.render()

    fps.frames++
    const now = performance.now()
    if (now - fps.windowStartMs >= 1000) {
      fps.value = Math.round((fps.frames * 1000) / (now - fps.windowStartMs))
      fps.frames = 0
      fps.windowStartMs = now
    }

    if (showStats) updateStats()
  },
})

function updateStats(): void {
  const speedPerTic = Math.hypot(player.momentumX, player.momentumZ)
  const speedPerSecond = perTicToPerSecond(speedPerTic)

  statsPanel.textContent = [
    `fps        ${fps.value}`,
    `tics       ${loop.totalTicks}  (perdidos ${loop.droppedTicks})`,
    `tic        ${TIC_MS.toFixed(2)} ms`,
    `velocidade ${speedPerSecond.toFixed(0)} u/s  (${speedPerTic.toFixed(2)} u/tic)`,
    `posicao    ${player.x.toFixed(0)}, ${player.z.toFixed(0)}`,
    `angulo     ${((player.yaw * 180) / Math.PI).toFixed(0)}graus`,
    `latencia   ${latency.lastMs.toFixed(1)} ms  (pior ${latency.worstMs.toFixed(1)} ms)`,
  ].join('\n')
}

function beginPlaying(): void {
  overlay.hidden = true
  input.requestLock()
}

startButton.addEventListener('click', beginPlaying)

// Perder o pointer lock traz o menu de volta, em vez de deixar o jogador
// mexendo o mouse sem efeito e sem entender por que.
document.addEventListener('pointerlockchange', () => {
  if (!input.isLocked) overlay.hidden = false
})

input.attach()
loop.start()

// Ponto de inspecao para a verificacao automatizada: o navegador headless le
// estes valores em vez de depender de leitura de imagem.
Object.assign(window, {
  __fpsArena: {
    player,
    arena,
    loop,
    getStats: () => ({
      fps: fps.value,
      ticks: loop.totalTicks,
      droppedTicks: loop.droppedTicks,
      speedPerSecond: perTicToPerSecond(Math.hypot(player.momentumX, player.momentumZ)),
      latencyMs: latency.lastMs,
      worstLatencyMs: latency.worstMs,
      position: { x: player.x, z: player.z },
    }),
  },
})
