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
  type Box,
} from '../src/world/arena'
import { closestPointOnSegment, moveWithCollision, segmentBlocked } from '../src/world/collision'
import {
  ONDA_DO_SARGENTO,
  WAVES_POR_SALA,
  waveComposition,
  waveQueue,
  type WaveComposition,
} from '../src/world/waves'
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
// Cenario decorado
// ---------------------------------------------------------------------------

/** Distancia do ponto ate a SUPERFICIE da caixa; 0 quando esta dentro dela. */
function distanciaAteBox(x: number, z: number, box: Box): number {
  const foraX = Math.max(Math.abs(x - box.x) - box.width / 2, 0)
  const foraZ = Math.max(Math.abs(z - box.z) - box.depth / 2, 0)
  return Math.hypot(foraX, foraZ)
}

/** As duas caixas se sobrepoem no plano? */
function seSobrepoem(a: Box, b: Box): boolean {
  return (
    Math.abs(a.x - b.x) < (a.width + b.width) / 2 &&
    Math.abs(a.z - b.z) < (a.depth + b.depth) / 2
  )
}

describe('cenario decorado', () => {
  const VISUAIS_VALIDOS = ['caixa', 'barril', 'mureta', 'municao']

  /**
   * Meia largura do vao de uma porta (128) mais uma folga de meia celula.
   *
   * O corredor de travessia e o unico trecho do mundo em que o jogador nao pode
   * ter de contornar nada: ele cruza correndo, de costas para a sala que acabou
   * de limpar.
   */
  const MEIO_CORREDOR = 192

  /** Ate onde, em Z, a regra do corredor vale para cada lado da porta. */
  const ALCANCE_DO_CORREDOR = 320

  it('declara so visuais conhecidos, e enfeita as tres salas', () => {
    const arena = createArena()

    for (const sala of arena.salas) {
      const decorados = sala.boxes.filter((box) => box.visual !== undefined)
      expect(decorados.length, sala.nome).toBeGreaterThan(0)

      for (const box of decorados) {
        expect(VISUAIS_VALIDOS, `${sala.nome} em (${box.x}, ${box.z})`).toContain(box.visual)
      }
    }
  })

  it('nao deixa nenhum objeto de cenario virar cobertura de IA', () => {
    // `escolherCobertura` (enemies/enemy.ts) so aceita abrigo com altura acima
    // da linha de tiro. Enquanto todo objeto decorado ficar abaixo dela, a
    // busca de cobertura enxerga exatamente os mesmos volumes de antes — que e
    // o que mantem a janela de sobrevivencia multi-semente valendo.
    const arena = createArena()

    for (const box of arena.boxes) {
      if (box.visual === undefined) continue
      expect(box.height, `objeto em (${box.x}, ${box.z})`).toBeLessThanOrEqual(SHOT_HEIGHT)
    }
  })

  it('mantem todo objeto longe dos pontos de nascimento', () => {
    // O teste de nascimentos ja cobre "nao esta DENTRO de obstaculo". Aqui a
    // exigencia e maior: o corpo inteiro do inimigo tem de nascer solto, senao
    // a resolucao de penetracao o expulsa no primeiro tic e ele parece pular.
    //
    // Vale so para o CENARIO. Os pilares do galpao nao entram porque a folga
    // apertada de 17,4 unidades entre eles e os nascimentos diagonais e heranca
    // medida e travada da arena calibrada (ver "nascimentos desenhados"); o que
    // este teste protege e que nenhum objeto novo repita aquele aperto.
    const arena = createArena()
    let conferidos = 0

    for (const sala of arena.salas) {
      for (const ponto of sala.spawnPoints) {
        for (const box of arena.boxes) {
          if (box.visual === undefined) continue
          conferidos++
          expect(
            distanciaAteBox(ponto.x, ponto.z, box),
            `${sala.nome}/${ponto.nome} contra a caixa em (${box.x}, ${box.z})`,
          ).toBeGreaterThan(ENEMIES.zombieman.radius * 2)
        }
      }
    }

    expect(conferidos).toBeGreaterThan(0)
  })

  it('deixa o corredor de travessia das portas inteiramente livre', () => {
    const arena = createArena()

    for (const porta of arena.portas) {
      const zPorta = porta.z1

      for (const box of arena.boxes) {
        const noCorredor = Math.abs(box.x) - box.width / 2 < MEIO_CORREDOR
        const naFrenteDaPorta = Math.abs(box.z - zPorta) < ALCANCE_DO_CORREDOR + box.depth / 2

        expect(
          noCorredor && naFrenteDaPorta,
          `caixa em (${box.x}, ${box.z}) atravanca o vao da porta ${porta.id}`,
        ).toBe(false)
      }
    }
  })

  it('nao empilha uma caixa dentro da outra', () => {
    // Duas caixas sobrepostas dariam parede dupla na colisao e geometria
    // dentro de geometria no render — o defeito classico de cenario montado
    // a mao, e invisivel ate alguem esbarrar num canto que nao existe.
    const arena = createArena()

    for (let i = 0; i < arena.boxes.length; i++) {
      for (let j = i + 1; j < arena.boxes.length; j++) {
        const a = arena.boxes[i]!
        const b = arena.boxes[j]!
        expect(
          seSobrepoem(a, b),
          `(${a.x}, ${a.z}) ${a.width}x${a.depth} contra (${b.x}, ${b.z}) ${b.width}x${b.depth}`,
        ).toBe(false)
      }
    }
  })

  it('mantem todo objeto dentro da sala a que pertence', () => {
    const arena = createArena()

    for (const sala of arena.salas) {
      for (const box of sala.boxes) {
        for (const [x, z] of [
          [box.x - box.width / 2, box.z - box.depth / 2],
          [box.x + box.width / 2, box.z + box.depth / 2],
        ] as const) {
          expect(
            dentroDeBounds(sala.bounds, x, z),
            `${sala.nome}: caixa em (${box.x}, ${box.z})`,
          ).toBe(true)
        }
      }
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

  it('poe mais imps nos corredores e mais atiradores no patio', () => {
    // AJUSTE DECLARADO: a assercao do patio media `zombieman` isolado, e passou
    // a medir zumbis MAIS sargentos. O motivo e que a fatia do sargento sai da
    // dos zumbis (ver WaveComposition.sergeant), entao contar so os zumbis
    // passaria a medir "quantos atiradores NAO foram promovidos" — o oposto do
    // que o teste quer travar. O que o patio precisa e de mais gente atirando
    // de longe que o galpao, e e exatamente isso que esta escrito aqui.
    const atiradores = (c: WaveComposition) => c.zombieman + c.sergeant

    for (let wave = 4; wave <= 9; wave++) {
      const galpao = waveComposition(wave, 1)
      const corredores = waveComposition(wave, 2)
      const patio = waveComposition(wave, 3)

      expect(corredores.imp, `onda ${wave}`).toBeGreaterThan(galpao.imp)
      expect(atiradores(patio), `onda ${wave}`).toBeGreaterThan(atiradores(galpao))
    }
  })

  it('mantem o mesmo total por onda, seja qual for a sala', () => {
    // A sala inclina a MISTURA, nao a quantidade: a curva de pressao continua
    // sendo uma so, e o teto de onda segue valendo. O sargento entra na conta
    // porque ele TOMA a vaga de um zumbi, nao soma um corpo a onda.
    for (let wave = 1; wave <= 12; wave++) {
      const total = (c: WaveComposition) => c.zombieman + c.imp + c.sergeant
      expect(total(waveComposition(wave, 2))).toBe(total(waveComposition(wave, 1)))
      expect(total(waveComposition(wave, 3))).toBe(total(waveComposition(wave, 1)))
    }
  })
})

// ---------------------------------------------------------------------------
// O sargento na composicao
// ---------------------------------------------------------------------------

describe('sargento nas ondas', () => {
  it('nunca poe um sargento na sala 1', () => {
    // A sala calibrada nao ganha inimigo novo. A janela de sobrevivencia parado
    // foi medida com zumbis e imps; um tipo que cospe tres chumbos por disparo
    // a invalidaria sem que nenhum outro teste reclamasse.
    for (let wave = 1; wave <= 20; wave++) {
      expect(waveComposition(wave, 1).sergeant, `onda ${wave}`).toBe(0)
      expect(waveQueue(wave, 1), `onda ${wave}`).not.toContain('sergeant')
    }
  })

  it('poe sargento no patio a partir da onda 2, e nenhum antes', () => {
    for (let wave = 1; wave < ONDA_DO_SARGENTO; wave++) {
      expect(waveComposition(wave, 3).sergeant, `onda ${wave}`).toBe(0)
      expect(waveQueue(wave, 3), `onda ${wave}`).not.toContain('sergeant')
    }

    for (let wave = ONDA_DO_SARGENTO; wave <= 20; wave++) {
      expect(waveComposition(wave, 3).sergeant, `onda ${wave}`).toBeGreaterThan(0)
      expect(waveQueue(wave, 3), `onda ${wave}`).toContain('sergeant')
    }
  })

  it('poe menos sargentos nos corredores do que no patio', () => {
    // "Poucos" e um adjetivo; o que da para travar e a ordem entre as salas.
    for (let wave = ONDA_DO_SARGENTO; wave <= 20; wave++) {
      expect(waveComposition(wave, 2).sergeant, `onda ${wave}`).toBeLessThan(
        waveComposition(wave, 3).sergeant,
      )
    }
  })

  it('entrega uma fila que bate com a composicao declarada, em toda sala', () => {
    // Sem isto, um sargento poderia sumir entre a composicao e a fila (ou
    // nascer no lugar de um imp) sem nenhum teste perceber.
    for (const sala of [1, 2, 3]) {
      for (let wave = 1; wave <= 20; wave++) {
        const composicao = waveComposition(wave, sala)
        const fila = waveQueue(wave, sala)
        const onde = `sala ${sala}, onda ${wave}`

        const conta = (kind: string) => fila.filter((k) => k === kind).length
        expect(conta('zombieman'), onde).toBe(composicao.zombieman)
        expect(conta('imp'), onde).toBe(composicao.imp)
        expect(conta('sergeant'), onde).toBe(composicao.sergeant)
      }
    }
  })

  it('nunca deixa a composicao negativa, nem no teto da curva', () => {
    for (const sala of [1, 2, 3]) {
      for (let wave = 1; wave <= 60; wave++) {
        const c = waveComposition(wave, sala)
        expect(c.zombieman, `sala ${sala}, onda ${wave}`).toBeGreaterThanOrEqual(0)
        expect(c.imp).toBeGreaterThanOrEqual(0)
        expect(c.sergeant).toBeGreaterThanOrEqual(0)
      }
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
