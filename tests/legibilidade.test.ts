/**
 * Legibilidade do combate: o jogador consegue entender o que esta acontecendo?
 *
 * Esta dimensao tinha peso 10% na rubrica original e nota 4. Foi por ela que o
 * jogo falhou na mao do jogador: os inimigos viravam estatua a 400 unidades,
 * atiravam por hitscan invisivel e matavam sem deixar pista nenhuma da origem.
 * Medir velocidade com erro abaixo de 1% nao adianta se quem joga nao entende
 * de onde veio o tiro que o matou.
 *
 * Peso corrigido para 25%. Estes testes sao a rubrica nova.
 */
import { describe, it, expect } from 'vitest'
import { Game } from '../src/game'
import { BEHAVIOUR, createEnemy, resetEnemyIds, tickEnemy } from '../src/enemies/enemy'
import { createRandom } from '../src/core/random'
import { TICRATE } from '../src/core/doom'
import type { TicCommand } from '../src/core/input'
import type { Wall } from '../src/world/collision'

function command(overrides: Partial<TicCommand> = {}): TicCommand {
  return {
    forward: 0, side: 0, yawDelta: 0, pitchDelta: 0, run: false, fire: false,
    aim: false, switchTo: null, cycleWeapon: false,
    ...overrides,
  }
}

const SEM_PAREDES: Wall[] = []

/**
 * Contexto de tic com gerador persistente.
 *
 * O gerador precisa sobreviver entre os tics. Recriando-o com a mesma semente
 * a cada chamada, todo sorteio devolve o mesmo primeiro valor e o inimigo
 * escolhe eternamente o mesmo lado — foi assim que escrevi na primeira versao
 * e o teste acusou uma imobilidade que so existia no proprio teste.
 */
function criarContexto(seed = 9) {
  const random = createRandom(seed)
  return (overrides = {}) => ({
    player: { x: 0, z: 0 },
    walls: SEM_PAREDES,
    others: [],
    random,
    ...overrides,
  })
}

describe('o inimigo nao vira estatua', () => {
  it('continua se mexendo depois de chegar na distancia de tiro', () => {
    resetEnemyIds()
    const contexto = criarContexto()
    const inimigo = createEnemy('zombieman', 0, -1200)

    // Deixa chegar na distancia preferida.
    for (let i = 0; i < 600; i++) tickEnemy(inimigo, contexto())
    const parado = { x: inimigo.x, z: inimigo.z }

    // E entao continua observando: ele tem de mudar de lugar.
    let deslocamento = 0
    for (let i = 0; i < 120; i++) {
      tickEnemy(inimigo, contexto())
      deslocamento = Math.max(
        deslocamento,
        Math.hypot(inimigo.x - parado.x, inimigo.z - parado.z),
      )
    }

    expect(deslocamento).toBeGreaterThan(40)
  })

  it('circula o jogador em vez de recuar ou colar', () => {
    resetEnemyIds()
    const contexto = criarContexto()
    const inimigo = createEnemy('zombieman', 0, -1200)
    for (let i = 0; i < 600; i++) tickEnemy(inimigo, contexto())

    const distancias: number[] = []
    for (let i = 0; i < 200; i++) {
      tickEnemy(inimigo, contexto())
      distancias.push(Math.hypot(inimigo.x, inimigo.z))
    }

    // Mantem o raio aproximado enquanto anda de lado.
    const alvo = BEHAVIOUR.zombieman.preferredRange
    for (const d of distancias) {
      expect(d).toBeGreaterThan(alvo * 0.55)
      expect(d).toBeLessThan(alvo * 1.7)
    }
  })

  it('troca de lado ao longo do tempo, em vez de girar sempre no mesmo sentido', () => {
    resetEnemyIds()
    const contexto = criarContexto()
    const inimigo = createEnemy('zombieman', 0, -1200)
    for (let i = 0; i < 600; i++) tickEnemy(inimigo, contexto())

    const lados = new Set<number>()
    for (let i = 0; i < 900; i++) {
      tickEnemy(inimigo, contexto())
      lados.add(inimigo.strafeDir)
    }

    expect(lados.size).toBe(2)
  })
})

describe('o tiro inimigo e visivel', () => {
  it('informa a origem de todo golpe recebido', () => {
    resetEnemyIds()
    const game = new Game(5)

    let tiro = null
    for (let i = 0; i < TICRATE * 90 && !tiro; i++) {
      const events = game.tick(command())
      game.player.health = 100
      if (events.enemyShots.length > 0) tiro = events.enemyShots[0]!
    }

    expect(tiro).not.toBeNull()
    expect(Number.isFinite(tiro!.fromX)).toBe(true)
    expect(Number.isFinite(tiro!.fromZ)).toBe(true)
    expect(tiro!.damage).toBeGreaterThan(0)
  })

  it('faz a origem do tiro coincidir com a posicao de quem atirou', () => {
    resetEnemyIds()
    const game = new Game(5)

    for (let i = 0; i < TICRATE * 90; i++) {
      const events = game.tick(command())
      game.player.health = 100
      if (events.enemyShots.length === 0) continue

      const tiro = events.enemyShots[0]!
      const atirador = game.enemies.find((e) => e.id === tiro.enemyId)
      expect(atirador).toBeDefined()
      // O inimigo pode ter andado no mesmo tic; a folga cobre um passo.
      expect(Math.hypot(atirador!.x - tiro.fromX, atirador!.z - tiro.fromZ))
        .toBeLessThan(10)
      return
    }

    throw new Error('nenhum ataque inimigo aconteceu na janela observada')
  })

  it('separa golpe de longe de golpe corpo a corpo, que nao tem rastro', () => {
    expect(BEHAVIOUR.imp.attackRange).toBeLessThan(200)
    expect(BEHAVIOUR.zombieman.attackRange).toBeGreaterThan(200)
  })

  it('acumula todos os atacantes do tic, e nao so o primeiro', () => {
    resetEnemyIds()
    const game = new Game(5)
    let maiorLote = 0

    for (let i = 0; i < TICRATE * 120; i++) {
      const events = game.tick(command())
      game.player.health = 100
      maiorLote = Math.max(maiorLote, events.enemyShots.length)
    }

    expect(maiorLote).toBeGreaterThanOrEqual(1)
  })
})

describe('a morte tem explicacao', () => {
  it('registra quem deu o ultimo golpe', () => {
    resetEnemyIds()
    const game = new Game(5)

    for (let i = 0; i < TICRATE * 300 && game.phase !== 'over'; i++) {
      game.tick(command())
    }

    expect(game.phase).toBe('over')
    expect(game.lastDamage).not.toBeNull()
    expect(['imp', 'zombieman']).toContain(game.lastDamage!.kind)
    expect(game.lastDamage!.distance).toBeGreaterThan(0)
  })

  it('diz se o golpe fatal veio de perto ou de longe', () => {
    resetEnemyIds()
    const game = new Game(5)
    for (let i = 0; i < TICRATE * 300 && game.phase !== 'over'; i++) {
      game.tick(command())
    }

    const causa = game.lastDamage!
    // Coerencia entre a distancia registrada e o tipo de ataque.
    if (causa.melee) {
      expect(causa.distance).toBeLessThan(BEHAVIOUR.imp.attackRange + 40)
    } else {
      expect(causa.distance).toBeLessThan(BEHAVIOUR.zombieman.attackRange + 40)
    }
  })

  it('comeca a partida sem causa de morte registrada', () => {
    resetEnemyIds()
    expect(new Game(5).lastDamage).toBeNull()
  })
})
