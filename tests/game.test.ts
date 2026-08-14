/**
 * Partida completa, sem navegador.
 *
 * O valor deste arquivo e simular minutos de jogo em milissegundos e travar
 * as propriedades que so apareceriam jogando: a onda fecha, a pontuacao cresce,
 * o jogador morre se nao fizer nada, e nada disso trava.
 */
import { describe, it, expect } from 'vitest'
import { Game } from '../src/game'
import { resetEnemyIds } from '../src/enemies/enemy'
import { INTERMISSION_TICS, MAX_CONCURRENT, waveComposition, waveQueue } from '../src/world/waves'
import { TICRATE } from '../src/core/doom'
import type { TicCommand } from '../src/core/input'

function command(overrides: Partial<TicCommand> = {}): TicCommand {
  return {
    forward: 0, side: 0, yawDelta: 0, pitchDelta: 0, run: false, fire: false,
    aim: false, switchTo: null, cycleWeapon: false,
    ...overrides,
  }
}

function newGame(seed = 1): Game {
  resetEnemyIds()
  return new Game(seed)
}

/** Roda tics e devolve o acumulado dos acontecimentos. */
function run(game: Game, tics: number, cmd: TicCommand) {
  const totals = { fired: 0, hits: 0, kills: 0, damageTaken: 0, waves: [] as number[] }

  for (let i = 0; i < tics; i++) {
    const events = game.tick(cmd)
    if (events.fired) totals.fired++
    totals.hits += events.hits
    totals.kills += events.kills
    totals.damageTaken += events.damageTaken
    if (events.waveStarted !== null) totals.waves.push(events.waveStarted)
  }

  return totals
}

describe('curva das ondas', () => {
  it('cresce sem salto absurdo entre ondas vizinhas', () => {
    for (let wave = 1; wave < 20; wave++) {
      const current = waveComposition(wave)
      const next = waveComposition(wave + 1)
      const currentTotal = current.zombieman + current.imp
      const nextTotal = next.zombieman + next.imp

      expect(nextTotal).toBeGreaterThanOrEqual(currentTotal)
      expect(nextTotal - currentTotal).toBeLessThanOrEqual(3)
    }
  })

  it('aumenta a proporcao de inimigos de perto ao longo do jogo', () => {
    const early = waveComposition(1)
    const late = waveComposition(12)

    const earlyShare = early.imp / (early.imp + early.zombieman)
    const lateShare = late.imp / (late.imp + late.zombieman)

    expect(lateShare).toBeGreaterThan(earlyShare)
  })

  it('intercala os tipos em vez de agrupar por bloco', () => {
    const queue = waveQueue(8)
    const firstImp = queue.indexOf('imp')

    expect(firstImp).toBeGreaterThanOrEqual(0)
    expect(firstImp).toBeLessThan(queue.length / 2)
  })

  it('tem teto no tamanho da onda', () => {
    const huge = waveComposition(999)
    expect(huge.zombieman + huge.imp).toBeLessThanOrEqual(26)
  })
})

describe('partida', () => {
  it('comeca em intervalo e entra na primeira onda', () => {
    const game = newGame()
    expect(game.phase).toBe('intermission')

    const totals = run(game, INTERMISSION_TICS + 5, command())
    expect(totals.waves).toContain(1)
    expect(game.phase).toBe('fighting')
  })

  it('faz inimigos nascerem depois que a onda comeca', () => {
    const game = newGame()
    run(game, INTERMISSION_TICS + TICRATE * 3, command())
    expect(game.aliveEnemies).toBeGreaterThan(0)
  })

  it('respeita o teto de inimigos vivos ao mesmo tempo', () => {
    const game = newGame()
    for (let i = 0; i < TICRATE * 90; i++) {
      game.tick(command())
      expect(game.aliveEnemies).toBeLessThanOrEqual(MAX_CONCURRENT)
    }
  })

  it('nao faz nascer inimigo em cima do jogador', () => {
    const game = newGame()

    for (let i = 0; i < TICRATE * 20; i++) {
      game.tick(command())
      for (const enemy of game.enemies) {
        // No tic em que nasce, todo inimigo precisa estar longe.
        if (enemy.health === enemy.maxHealth && enemy.state === 'chase') {
          const distance = Math.hypot(enemy.x - game.player.x, enemy.z - game.player.z)
          expect(distance).toBeGreaterThan(200)
        }
      }
    }
  })

  it('mata o jogador parado que nao reage', () => {
    const game = newGame()
    run(game, TICRATE * 180, command())

    expect(game.player.health).toBeLessThanOrEqual(0)
    expect(game.phase).toBe('over')
  })

  /**
   * Janela de sobrevivencia do jogador que nao faz nada.
   *
   * E a medida mais barata de dificuldade que existe, e serve de rede contra
   * as duas falhas opostas: morrer antes de entender o que aconteceu, ou uma
   * arena tao inofensiva que ficar parado seja viavel. A primeira versao
   * matava em 13 segundos na onda 1 — tempo em que o jogador nem localizou de
   * onde vinha o tiro.
   */
  it('deixa o jogador parado sobreviver entre 30 e 90 segundos', () => {
    const game = newGame(17)
    let tics = 0
    while (game.phase !== 'over' && tics < TICRATE * 300) {
      game.tick(command())
      tics++
    }

    const seconds = tics / TICRATE
    expect(seconds).toBeGreaterThan(30)
    expect(seconds).toBeLessThan(90)
  })

  it('para de simular depois do fim de jogo', () => {
    const game = newGame()
    run(game, TICRATE * 120, command())

    const scoreAtDeath = game.score
    run(game, TICRATE * 10, command({ fire: true }))
    expect(game.score).toBe(scoreAtDeath)
  })
})

describe('tiro em combate', () => {
  it('acerta e mata o inimigo em quem o jogador mira', () => {
    // Mira apontada de proposito. A versao anterior girava a esmo torcendo
    // para cruzar alguem, e media sorte: o alvo ocupa cerca de 2 graus a 600
    // unidades, e o jogador morre antes de acumular disparos suficientes.
    const game = newGame(7)

    while (game.aliveEnemies === 0) game.tick(command())
    const target = game.enemies.find((enemy) => enemy.alive)!

    let hits = 0
    let kills = 0

    for (let i = 0; i < TICRATE * 20 && target.alive; i++) {
      // Reaponta a cada tic: o alvo se move enquanto atiramos.
      game.player.yaw = Math.atan2(
        -(target.x - game.player.x),
        -(target.z - game.player.z),
      )
      const events = game.tick(command({ fire: true }))
      hits += events.hits
      kills += events.kills
    }

    expect(hits).toBeGreaterThan(0)
    expect(kills).toBeGreaterThan(0)
    expect(game.score).toBeGreaterThan(0)
  })

  it('produz um rastro por chumbo disparado', () => {
    const game = newGame(3)
    let traced = false

    for (let i = 0; i < TICRATE * 10; i++) {
      const events = game.tick(command({ fire: true }))
      if (events.fired) {
        expect(events.traces).toHaveLength(7) // escopeta
        traced = true
      }
    }

    expect(traced).toBe(true)
  })

  it('remove o corpo da cena depois da animacao de morte', () => {
    const game = newGame(11)
    run(game, TICRATE * 100, command({ fire: true, yawDelta: 0.03 }))

    for (const enemy of game.enemies) {
      expect(enemy.state).not.toBe('dead')
    }
  })
})

describe('estabilidade', () => {
  it('sobrevive a uma partida longa e caotica sem quebrar', () => {
    const game = newGame(23)

    for (let i = 0; i < TICRATE * 300; i++) {
      game.tick(command({
        forward: (i % 3) - 1,
        side: (i % 5) - 2,
        yawDelta: Math.sin(i * 0.07) * 0.15,
        run: i % 2 === 0,
        fire: i % 7 < 3,
      }))
    }

    expect(Number.isFinite(game.player.x)).toBe(true)
    expect(Number.isFinite(game.player.z)).toBe(true)
    expect(Number.isFinite(game.score)).toBe(true)
    // A lista de inimigos nao pode crescer sem limite ao longo do tempo.
    expect(game.enemies.length).toBeLessThanOrEqual(MAX_CONCURRENT + 6)
  })

  it('mantem o jogador dentro da arena a partida inteira', () => {
    const game = newGame(31)
    const limit = game.arena.size / 2

    for (let i = 0; i < TICRATE * 120; i++) {
      game.tick(command({
        forward: 1,
        side: i % 4 < 2 ? 1 : -1,
        yawDelta: 0.05,
        run: true,
      }))

      expect(Math.abs(game.player.x)).toBeLessThan(limit)
      expect(Math.abs(game.player.z)).toBeLessThan(limit)
    }
  })
})
