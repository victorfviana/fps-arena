/**
 * Dados que a animacao consome.
 *
 * A animacao em si e geometria e nao roda sob teste, mas o que a alimenta e
 * simulacao pura e pode ser travado: a distancia percorrida a pe, a duracao da
 * pose de ataque e as posicoes de queda. Sao esses tres que, errados, produzem
 * inimigo pedalando parado ou pose que pisca por um tic.
 */
import { describe, it, expect } from 'vitest'
import {
  ATTACK_POSE_TICS,
  createEnemy,
  damageEnemy,
  resetEnemyIds,
  tickEnemy,
} from '../src/enemies/enemy'
import { createRandom } from '../src/core/random'
import { ENEMIES, TICRATE, TIC_MS, chaseSpeed } from '../src/core/doom'
import { Game } from '../src/game'
import type { TicCommand } from '../src/core/input'
import type { Wall } from '../src/world/collision'

function command(overrides: Partial<TicCommand> = {}): TicCommand {
  return {
    forward: 0, side: 0, yawDelta: 0, pitchDelta: 0, run: false, fire: false,
    aim: false, switchTo: null, cycleWeapon: false,
    ...overrides,
  }
}

function criarContexto(walls: Wall[] = []) {
  const random = createRandom(4)
  return () => ({ player: { x: 0, z: 0 }, walls, others: [], random })
}

describe('distancia percorrida a pe', () => {
  it('comeca zerada', () => {
    resetEnemyIds()
    expect(createEnemy('imp', 0, -900).distanceWalked).toBe(0)
  })

  it('cresce enquanto o inimigo caminha', () => {
    resetEnemyIds()
    const contexto = criarContexto()
    const inimigo = createEnemy('imp', 0, -900)

    for (let i = 0; i < 30; i++) tickEnemy(inimigo, contexto())
    expect(inimigo.distanceWalked).toBeGreaterThan(0)
  })

  it('acompanha o deslocamento real, e nao a velocidade pretendida', () => {
    resetEnemyIds()
    const contexto = criarContexto()
    const inimigo = createEnemy('imp', 0, -900)
    const partida = { x: inimigo.x, z: inimigo.z }

    for (let i = 0; i < 40; i++) tickEnemy(inimigo, contexto())

    const linhaReta = Math.hypot(inimigo.x - partida.x, inimigo.z - partida.z)
    // Andou em linha quase reta, entao o acumulado bate com a distancia.
    expect(inimigo.distanceWalked).toBeGreaterThanOrEqual(linhaReta - 1)
    expect(inimigo.distanceWalked).toBeLessThan(linhaReta * 1.35)
  })

  /**
   * A razao de existir do campo: preso contra parede, o inimigo nao pode
   * continuar acumulando passo. Se acumulasse, as pernas pedalariam no lugar —
   * o defeito que denuncia animacao mal feita a qualquer jogador.
   */
  it('para de crescer quando o inimigo esta travado contra parede', () => {
    resetEnemyIds()
    // Parede entre o inimigo e o jogador, colada nele.
    const walls: Wall[] = [{ ax: -400, az: -300, bx: 400, bz: -300 }]
    const contexto = criarContexto(walls)
    const inimigo = createEnemy('imp', 0, -340)

    for (let i = 0; i < 60; i++) tickEnemy(inimigo, contexto())
    const acumuladoNoBloqueio = inimigo.distanceWalked

    for (let i = 0; i < 60; i++) tickEnemy(inimigo, contexto())
    const depois = inimigo.distanceWalked

    // Alguma folga para o deslizar lateral, mas nada perto de andar livre.
    const andariaLivre = chaseSpeed(ENEMIES.imp) * 60
    expect(depois - acumuladoNoBloqueio).toBeLessThan(andariaLivre * 0.5)
  })

  it('nao acumula enquanto o inimigo esta em dor', () => {
    resetEnemyIds()
    const contexto = criarContexto()
    const inimigo = createEnemy('imp', 0, -900)
    for (let i = 0; i < 20; i++) tickEnemy(inimigo, contexto())

    inimigo.state = 'pain'
    inimigo.stateTics = ENEMIES.imp.painTics
    inimigo.knockX = 0
    inimigo.knockZ = 0
    const antes = inimigo.distanceWalked

    tickEnemy(inimigo, contexto())
    expect(inimigo.distanceWalked).toBe(antes)
  })
})

describe('pose de ataque', () => {
  it('dura mais que um tic, para nao piscar', () => {
    expect(ATTACK_POSE_TICS).toBeGreaterThan(1)
    // Acima de 150 ms: abaixo disso o olho nao registra num combate cheio.
    expect(ATTACK_POSE_TICS * TIC_MS).toBeGreaterThan(150)
  })

  it('permanece no estado de ataque depois do golpe', () => {
    resetEnemyIds()
    const contexto = criarContexto()
    const inimigo = createEnemy('zombieman', 0, -500)

    const golpe = tickEnemy(inimigo, contexto())
    expect(golpe).not.toBeNull()
    expect(inimigo.state).toBe('attack')

    // Alguns tics depois ainda esta na pose, mesmo ja em recarga.
    tickEnemy(inimigo, contexto())
    tickEnemy(inimigo, contexto())
    expect(inimigo.state).toBe('attack')
  })

  it('volta a perseguir quando a pose termina', () => {
    resetEnemyIds()
    const contexto = criarContexto()
    const inimigo = createEnemy('zombieman', 0, -500)

    tickEnemy(inimigo, contexto())
    for (let i = 0; i < ATTACK_POSE_TICS + 2; i++) tickEnemy(inimigo, contexto())

    expect(inimigo.state).toBe('chase')
  })

  it('nao trava o inimigo na pose para sempre', () => {
    resetEnemyIds()
    const contexto = criarContexto()
    const inimigo = createEnemy('zombieman', 0, -1400)

    let emAtaque = 0
    for (let i = 0; i < TICRATE * 20; i++) {
      tickEnemy(inimigo, contexto())
      if (inimigo.state === 'attack') emAtaque++
    }

    // Ataca de tempos em tempos, mas passa a maior parte do tempo se movendo.
    expect(emAtaque).toBeLessThan(TICRATE * 20 * 0.75)
  })
})

describe('marcacao da queda', () => {
  it('informa onde cada inimigo caiu', () => {
    resetEnemyIds()
    const game = new Game(7)
    while (game.aliveEnemies === 0) game.tick(command())

    const alvo = game.enemies.find((e) => e.alive)!
    let quedas: Array<{ x: number; y: number; z: number }> = []

    for (let i = 0; i < TICRATE * 25 && quedas.length === 0; i++) {
      game.player.yaw = Math.atan2(
        -(alvo.x - game.player.x),
        -(alvo.z - game.player.z),
      )
      const events = game.tick(command({ fire: true }))
      if (events.killPositions.length) quedas = events.killPositions
    }

    expect(quedas.length).toBeGreaterThan(0)
    for (const queda of quedas) {
      expect(Number.isFinite(queda.x)).toBe(true)
      expect(Number.isFinite(queda.z)).toBe(true)
      // Na altura do corpo, nao no chao nem no teto.
      expect(queda.y).toBeGreaterThan(0)
      expect(queda.y).toBeLessThan(ENEMIES.imp.height)
    }
  })

  it('conta uma posicao por abate', () => {
    resetEnemyIds()
    const game = new Game(11)
    let kills = 0
    let posicoes = 0

    for (let i = 0; i < TICRATE * 60; i++) {
      const alvo = game.enemies.find((e) => e.alive)
      if (alvo) {
        game.player.yaw = Math.atan2(
          -(alvo.x - game.player.x),
          -(alvo.z - game.player.z),
        )
      }
      const events = game.tick(command({ fire: true }))
      game.player.health = 100
      kills += events.kills
      posicoes += events.killPositions.length
    }

    expect(kills).toBeGreaterThan(0)
    expect(posicoes).toBe(kills)
  })

  it('nao marca queda quando o inimigo so leva dano', () => {
    resetEnemyIds()
    const inimigo = createEnemy('imp', 0, -300)
    const resultado = damageEnemy(inimigo, 5, 0, -1, createRandom(3))

    expect(resultado.killed).toBe(false)
    expect(inimigo.alive).toBe(true)
  })
})
