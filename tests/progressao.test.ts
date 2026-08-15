/**
 * Progressao de salas: portas, avanco e nascimentos desenhados.
 *
 * O que este arquivo trava e a promessa do plano — "limpar a sala abre uma
 * porta" — em comportamento observavel, nunca em adjetivo: a porta fechada
 * barra corpo E visada, a sala limpa a abre, atravessar o vao acorda a sala
 * seguinte, e limpar a ultima ganha o jogo.
 *
 * Duas armadilhas motivaram testes que parecem redundantes:
 *
 * 1. Um ponto de nascimento pode estar geometricamente DENTRO de um obstaculo
 *    sem que nada quebre — a resolucao de penetracao expulsa o corpo no
 *    primeiro tic e o defeito so aparece como inimigo que "pula" ao nascer.
 *    Por isso a geometria de todos os pontos de todas as salas e conferida.
 * 2. A sala 1 e a que a rubrica, a legibilidade e a janela de sobrevivencia
 *    mediram. Ela e repetida aqui de proposito: se um dia alguem mexer na
 *    geometria dela para acomodar as salas novas, quero a quebra neste
 *    arquivo, ao lado da razao, e nao so no arquivo de calibracao.
 */
import { describe, it, expect } from 'vitest'
import { Game } from '../src/game'
import { BOB_AMPLITUDE, PLAYER_RADIUS, TICRATE, ENEMIES } from '../src/core/doom'
import { createRandom, type Random } from '../src/core/random'
import { damageEnemy, resetEnemyIds } from '../src/enemies/enemy'
import { SHOT_HEIGHT } from '../src/weapons/hitscan'
import {
  abrirPorta,
  createArena,
  dentroDeBounds,
  salaDoPonto,
  type Arena,
  type Bounds,
} from '../src/world/arena'
import { closestPointOnSegment, moveWithCollision, segmentBlocked } from '../src/world/collision'
import { WAVES_POR_SALA, waveComposition, waveQueue } from '../src/world/waves'
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

/**
 * Mata tudo que estiver de pe.
 *
 * E o unico jeito barato de chegar ao fim de uma sala: o jogador simulado nao
 * mira, e esperar que ele limpe tres ondas por pontaria custaria minutos de
 * simulacao e mediria a arma, nao a progressao.
 */
function matarTodos(game: Game, random: Random): void {
  for (const inimigo of game.enemies) {
    if (inimigo.alive) damageEnemy(inimigo, 1000, 0, -1, random)
  }
}

/** Roda ate a sala ativa acabar — porta aberta ou vitoria. */
function limparSalaAtiva(game: Game, maxTics = TICRATE * 400) {
  const random = createRandom(99)

  for (let i = 0; i < maxTics; i++) {
    const events = game.tick(command())
    game.player.health = 100
    matarTodos(game, random)
    if (events.doorOpened !== null || events.gameWon) return events
  }

  throw new Error(`sala ${game.salaAtiva} nao foi limpa em ${maxTics} tics`)
}

/**
 * Poe o jogador na frente do vao e o faz andar ate cruzar.
 *
 * Sem teleporte: ele atravessa pelo mesmo caminho que o jogador de verdade
 * atravessa, empurrado pelo comando de movimento, sujeito a colisao.
 */
function atravessar(game: Game, zDaPorta: number, maxTics = TICRATE * 10) {
  game.player.x = 0
  game.player.z = zDaPorta + 96
  game.player.momentumX = 0
  game.player.momentumZ = 0
  game.player.yaw = 0 // yaw 0 olha para -Z, o sentido do avanco

  for (let i = 0; i < maxTics; i++) {
    const events = game.tick(command({ forward: 1, run: true }))
    game.player.health = 100
    if (events.roomEntered !== null) return events
  }

  throw new Error(`o jogador nao cruzou o vao em z=${zDaPorta}`)
}

/** Menor distancia do ponto a qualquer segmento de parede. */
function folgaAteParede(x: number, z: number, arena: Arena): number {
  let menor = Infinity

  for (const parede of arena.walls) {
    const perto = closestPointOnSegment(x, z, parede.ax, parede.az, parede.bx, parede.bz)
    menor = Math.min(menor, Math.hypot(x - perto.x, z - perto.z))
  }

  return menor
}

/** O ponto esta dentro de algum obstaculo? */
function dentroDeObstaculo(x: number, z: number, arena: Arena): boolean {
  return arena.boxes.some(
    (box) =>
      Math.abs(x - box.x) < box.width / 2 && Math.abs(z - box.z) < box.depth / 2,
  )
}

function comMargem(bounds: Bounds, margem: number): Bounds {
  return {
    minX: bounds.minX + margem,
    maxX: bounds.maxX - margem,
    minZ: bounds.minZ + margem,
    maxZ: bounds.maxZ - margem,
  }
}

// ---------------------------------------------------------------------------
// A porta
// ---------------------------------------------------------------------------

describe('porta', () => {
  it('fechada, barra o corpo do jogador que anda contra ela', () => {
    const arena = createArena()
    const porta = arena.portas[0]!
    expect(porta.aberta).toBe(false)

    const destino = moveWithCollision(
      { x: 0, z: porta.z1 + 64 },
      { x: 0, z: -256 },
      PLAYER_RADIUS,
      arena.walls,
    )

    expect(destino.z).toBeGreaterThan(porta.z1)
    expect(salaDoPonto(arena, destino.x, destino.z)).toBe(1)
  })

  it('fechada, barra a visada e o tiro que atravessariam o vao', () => {
    const arena = createArena()
    const porta = arena.portas[0]!

    const bloqueada = segmentBlocked(
      0, porta.z1 + 96, 0, porta.z1 - 96, arena.walls, SHOT_HEIGHT,
    )
    expect(bloqueada).toBe(true)
  })

  it('aberta, some das duas checagens de uma vez', () => {
    const arena = createArena()
    const porta = arena.portas[0]!

    expect(abrirPorta(arena, porta.id)).toBe(true)
    expect(porta.aberta).toBe(true)

    const destino = moveWithCollision(
      { x: 0, z: porta.z1 + 64 },
      { x: 0, z: -256 },
      PLAYER_RADIUS,
      arena.walls,
    )
    expect(destino.z).toBeLessThan(porta.z1)
    expect(salaDoPonto(arena, destino.x, destino.z)).toBe(2)

    const bloqueada = segmentBlocked(
      0, porta.z1 + 96, 0, porta.z1 - 96, arena.walls, SHOT_HEIGHT,
    )
    expect(bloqueada).toBe(false)
  })

  it('abre sem trocar a referencia da lista de paredes', () => {
    // O Game e os inimigos guardam `arena.walls`. Se abrir a porta trocasse o
    // array, eles continuariam esbarrando numa porta que ja nao existe.
    const arena = createArena()
    const referencia = arena.walls
    const antes = arena.walls.length

    abrirPorta(arena, 1)

    expect(arena.walls).toBe(referencia)
    expect(arena.walls.length).toBe(antes - 1)
  })

  it('desenha um vao largo o bastante para um corpo passar', () => {
    const arena = createArena()

    for (const porta of arena.portas) {
      const largura = Math.hypot(porta.x2 - porta.x1, porta.z2 - porta.z1)
      expect(largura, `porta ${porta.id}`).toBeGreaterThan(ENEMIES.imp.radius * 4)
    }
  })

  it('liga cada sala a seguinte, sem atalho nem volta', () => {
    const arena = createArena()

    expect(arena.salas.map((sala) => sala.id)).toEqual([1, 2, 3])
    expect(arena.portas.map((p) => [p.salaDe, p.salaPara])).toEqual([[1, 2], [2, 3]])
  })
})

// ---------------------------------------------------------------------------
// Avanco
// ---------------------------------------------------------------------------

describe('avanco entre salas', () => {
  it('comeca na sala 1, com as portas fechadas', () => {
    const game = newGame()

    expect(game.salaAtiva).toBe(1)
    expect(game.arena.portas.every((porta) => !porta.aberta)).toBe(true)
  })

  it('abre a porta quando a sala e limpa, e avisa por evento', () => {
    const game = newGame(5)
    const events = limparSalaAtiva(game)

    expect(events.doorOpened).toBe(1)
    expect(events.gameWon).toBe(false)
    expect(game.arena.portas[0]!.aberta).toBe(true)
    // A porta abriu porque a sala inteira acabou, nao uma onda so.
    expect(game.wave).toBeGreaterThanOrEqual(WAVES_POR_SALA)
    // E a sala seguinte ainda nao acordou: quem manda nisso e o jogador.
    expect(game.salaAtiva).toBe(1)
  })

  it('nao faz nascer mais ninguem enquanto o jogador nao atravessa', () => {
    const game = newGame(5)
    limparSalaAtiva(game)

    const random = createRandom(7)
    matarTodos(game, random)

    for (let i = 0; i < TICRATE * 60; i++) {
      const events = game.tick(command())
      game.player.health = 100
      expect(events.waveStarted).toBeNull()
    }

    expect(game.aliveEnemies).toBe(0)
  })

  it('ativa a sala seguinte quando o jogador cruza o vao, e avisa por evento', () => {
    const game = newGame(5)
    limparSalaAtiva(game)

    const travessia = atravessar(game, game.arena.portas[0]!.z1)

    expect(travessia.roomEntered).toBe(2)
    expect(game.salaAtiva).toBe(2)
    expect(salaDoPonto(game.arena, game.player.x, game.player.z)).toBe(2)
  })

  it('faz a sala nova nascer nos pontos DELA, e nao nos da anterior', () => {
    const game = newGame(5)
    limparSalaAtiva(game)
    atravessar(game, game.arena.portas[0]!.z1)

    const corredores = game.arena.salas[1]!
    const pontos = corredores.spawnPoints
    // Fundo do corredor central: longe do vao, para a briga nao acontecer em
    // cima da divisa.
    game.player.z = -1536
    game.player.momentumZ = 0

    // O inimigo ja anda no mesmo tic em que nasce, entao ninguem e flagrado
    // exatamente sobre o ponto: a conferencia acontece na PRIMEIRA vez que o
    // id aparece, quando ele esta no maximo um passo longe dali.
    // Os corpos da sala 1 ainda estao em cena enquanto a animacao de morte
    // roda; sao ids antigos e nao entram na conta.
    const vistos = new Set<number>(game.enemies.map((inimigo) => inimigo.id))
    let nascidos = 0

    for (let i = 0; i < TICRATE * 90 && nascidos < 3; i++) {
      game.tick(command())
      game.player.health = 100

      for (const inimigo of game.enemies) {
        if (vistos.has(inimigo.id)) continue
        vistos.add(inimigo.id)
        nascidos++

        const doPonto = Math.min(
          ...pontos.map((ponto) => Math.hypot(inimigo.x - ponto.x, inimigo.z - ponto.z)),
        )
        expect(doPonto, `inimigo ${inimigo.id}`).toBeLessThan(32)
        expect(dentroDeBounds(corredores.bounds, inimigo.x, inimigo.z)).toBe(true)
      }
    }

    expect(nascidos).toBeGreaterThan(0)
  })

  it('ganha o jogo ao limpar a terceira sala', () => {
    const game = newGame(5)

    limparSalaAtiva(game)
    atravessar(game, game.arena.portas[0]!.z1)
    expect(game.salaAtiva).toBe(2)

    limparSalaAtiva(game)
    atravessar(game, game.arena.portas[1]!.z1)
    expect(game.salaAtiva).toBe(3)

    const fim = limparSalaAtiva(game)

    expect(fim.gameWon).toBe(true)
    expect(fim.doorOpened).toBeNull()
    expect(game.phase).toBe('won')
    // Vitoria congela a partida, como a derrota.
    const scoreFinal = game.score
    game.tick(command({ fire: true }))
    expect(game.score).toBe(scoreFinal)
  })
})

// ---------------------------------------------------------------------------
// Nascimentos desenhados
// ---------------------------------------------------------------------------

describe('nascimentos desenhados', () => {
  it('nao poe nenhum ponto dentro de parede ou obstaculo, em nenhuma sala', () => {
    const arena = createArena()
    let conferidos = 0

    for (const sala of arena.salas) {
      expect(sala.spawnPoints.length, sala.nome).toBeGreaterThan(0)

      for (const ponto of sala.spawnPoints) {
        conferidos++
        const onde = `${sala.nome}/${ponto.nome}`

        expect(dentroDeObstaculo(ponto.x, ponto.z, arena), onde).toBe(false)
        expect(salaDoPonto(arena, ponto.x, ponto.z), onde).toBe(sala.id)
        // Longe da divisa: um ponto colado na borda nasceria na sala vizinha
        // ao menor empurrao da separacao entre inimigos.
        expect(
          dentroDeBounds(comMargem(sala.bounds, ENEMIES.imp.radius * 2), ponto.x, ponto.z),
          onde,
        ).toBe(true)

        // Folga minima: 16 e o meio corpo do jogador. Os quatro pontos
        // diagonais do galpao ficam a 17,4 da quina dos pilares — heranca da
        // arena calibrada, medida e declarada aqui em vez de escondida.
        expect(folgaAteParede(ponto.x, ponto.z, arena), onde).toBeGreaterThan(16)
      }
    }

    expect(conferidos).toBeGreaterThanOrEqual(8 * 3)
  })

  it('deixa o corpo inteiro do inimigo caber nas salas novas', () => {
    const arena = createArena()

    for (const sala of arena.salas.slice(1)) {
      for (const ponto of sala.spawnPoints) {
        expect(
          folgaAteParede(ponto.x, ponto.z, arena),
          `${sala.nome}/${ponto.nome}`,
        ).toBeGreaterThan(ENEMIES.zombieman.radius)
      }
    }
  })

  it('espalha os pontos, em vez de amontoa-los num canto so', () => {
    const arena = createArena()

    for (const sala of arena.salas) {
      for (let i = 0; i < sala.spawnPoints.length; i++) {
        for (let j = i + 1; j < sala.spawnPoints.length; j++) {
          const a = sala.spawnPoints[i]!
          const b = sala.spawnPoints[j]!
          expect(
            Math.hypot(a.x - b.x, a.z - b.z),
            `${sala.nome}: ${a.nome} x ${b.nome}`,
          ).toBeGreaterThan(ENEMIES.imp.radius * 4)
        }
      }
    }
  })

  it('mantem todo obstaculo novo fora da faixa que o olho atravessa', () => {
    // Mesma regra que ja valia para a arena unica: cobertura ou e baixa o
    // bastante para se ver por cima, ou e alta o bastante para esconder. No
    // meio, o visual e a regra de acerto divergem.
    const arena = createArena()

    for (const box of arena.boxes) {
      const noMeio =
        box.height > SHOT_HEIGHT - BOB_AMPLITUDE && box.height < SHOT_HEIGHT + BOB_AMPLITUDE
      expect(noMeio).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------
// Composicao por sala
// ---------------------------------------------------------------------------

describe('ondas por sala', () => {
  it('nao muda uma virgula da composicao da sala 1', () => {
    for (let wave = 1; wave <= 12; wave++) {
      expect(waveComposition(wave, 1)).toEqual(waveComposition(wave))
      expect(waveQueue(wave, 1)).toEqual(waveQueue(wave))
    }
  })

  it('poe mais imps nos corredores e mais zombiemen no patio', () => {
    for (let wave = 4; wave <= 9; wave++) {
      const galpao = waveComposition(wave, 1)
      const corredores = waveComposition(wave, 2)
      const patio = waveComposition(wave, 3)

      expect(corredores.imp, `onda ${wave}`).toBeGreaterThan(galpao.imp)
      expect(patio.zombieman, `onda ${wave}`).toBeGreaterThan(galpao.zombieman)
    }
  })

  it('mantem o mesmo total por onda, seja qual for a sala', () => {
    // A sala inclina a MISTURA, nao a quantidade: a curva de pressao continua
    // sendo uma so, e o teto de onda segue valendo.
    for (let wave = 1; wave <= 12; wave++) {
      const total = (c: { zombieman: number; imp: number }) => c.zombieman + c.imp
      expect(total(waveComposition(wave, 2))).toBe(total(waveComposition(wave, 1)))
      expect(total(waveComposition(wave, 3))).toBe(total(waveComposition(wave, 1)))
    }
  })
})

// ---------------------------------------------------------------------------
// A sala 1 continua sendo a sala calibrada
// ---------------------------------------------------------------------------

describe('sala 1 preservada', () => {
  /**
   * Repeticao deliberada do teste de calibracao de game.test.ts.
   *
   * O mundo cresceu tres vezes; esta e a prova de que o jogador parado na
   * primeira sala continua vivendo o mesmo tanto que vivia quando so existia
   * ela. Se um dia a sala 1 for mexida, quebra aqui junto com o motivo.
   */
  it('deixa o jogador parado sobreviver entre 25 e 90 segundos, em toda semente', () => {
    for (const semente of [0x1d1a, 17, 1, 2, 3, 42, 99, 1234]) {
      const game = newGame(semente)
      let tics = 0

      while (game.phase !== 'over' && tics < TICRATE * 300) {
        game.tick(command())
        tics++
      }

      const seconds = tics / TICRATE
      expect(seconds, `semente ${semente}`).toBeGreaterThan(25)
      expect(seconds, `semente ${semente}`).toBeLessThan(90)
      // Parado nao mata ninguem, logo nao limpa a sala, logo nao abre porta.
      expect(game.salaAtiva, `semente ${semente}`).toBe(1)
      expect(game.arena.portas[0]!.aberta, `semente ${semente}`).toBe(false)
    }
  })

  it('mantem a geometria da arena publicada', () => {
    const arena = createArena()
    const galpao = arena.salas[0]!

    expect(arena.size).toBe(2048)
    expect(arena.wallHeight).toBe(256)
    expect(galpao.bounds).toEqual({ minX: -1024, maxX: 1024, minZ: -1024, maxZ: 1024 })
    expect(arena.playerStart).toEqual({ x: 0, z: 0, yaw: 0 })

    // Quatro pilares altos, quatro obstaculos baixos, no lugar de sempre.
    expect(galpao.boxes.filter((b) => b.height === arena.wallHeight)).toHaveLength(4)
    expect(galpao.boxes.filter((b) => b.height === 28)).toHaveLength(4)

    // O anel de nascimento: oito pontos, raio 832, angulos multiplos de 45.
    expect(galpao.spawnPoints).toHaveLength(8)
    for (let i = 0; i < 8; i++) {
      const angulo = (i / 8) * Math.PI * 2
      expect(galpao.spawnPoints[i]!.x).toBeCloseTo(Math.cos(angulo) * 832, 6)
      expect(galpao.spawnPoints[i]!.z).toBeCloseTo(Math.sin(angulo) * 832, 6)
    }
  })

  it('cobre o mundo inteiro com o envelope declarado', () => {
    const arena = createArena()

    for (const sala of arena.salas) {
      expect(sala.bounds.minX, sala.nome).toBeGreaterThanOrEqual(arena.boundsTotal.minX)
      expect(sala.bounds.maxX, sala.nome).toBeLessThanOrEqual(arena.boundsTotal.maxX)
      expect(sala.bounds.minZ, sala.nome).toBeGreaterThanOrEqual(arena.boundsTotal.minZ)
      expect(sala.bounds.maxZ, sala.nome).toBeLessThanOrEqual(arena.boundsTotal.maxZ)
    }

    // As salas se justapoem em Z, sem buraco entre uma e a seguinte.
    expect(arena.salas[0]!.bounds.minZ).toBe(arena.salas[1]!.bounds.maxZ)
    expect(arena.salas[1]!.bounds.minZ).toBe(arena.salas[2]!.bounds.maxZ)
  })
})
