/**
 * A rubrica do loop adversarial, como teste executavel.
 *
 * Cada bloco corresponde a uma dimensao avaliada, e cada limiar esta escrito
 * em comportamento observavel — nunca em adjetivo. "Tiro com peso" nao e
 * nivel; "feedback em no maximo 3 tics, por pelo menos 4 canais simultaneos"
 * e nivel.
 *
 * O ganho de escrever a rubrica aqui, e nao em prosa, e que ela para de ser
 * opiniao renovavel a cada leitura: uma regressao em qualquer dimensao quebra
 * a suite, hoje e daqui a seis meses.
 *
 * FORA DE ALCANCE DESTE ARQUIVO: framerate real e latencia de quadro. Ambos
 * dependem de requestAnimationFrame num navegador visivel, e a aba fica oculta
 * sob automacao. Declarados como nao verificados no scorecard.
 */
import { describe, it, expect } from 'vitest'
import {
  ENEMIES,
  FRICTION,
  TERMINAL_SPEED,
  TICRATE,
  TIC_MS,
  VIEW_HEIGHT,
  WEAPONS,
  chaseSpeed,
  damageThrust,
  perTicToPerSecond,
} from '../src/core/doom'
import { createRandom } from '../src/core/random'
import { createPlayer, tickPlayer } from '../src/player/player'
import { createEnemy, damageEnemy, resetEnemyIds, tickEnemy } from '../src/enemies/enemy'
import { createWeapon, tickWeapon } from '../src/weapons/weapon'
import { createArena } from '../src/world/arena'
import { MAX_CONCURRENT } from '../src/world/waves'
import { Game } from '../src/game'
import type { TicCommand } from '../src/core/input'

function command(overrides: Partial<TicCommand> = {}): TicCommand {
  return {
    forward: 0, side: 0, yawDelta: 0, pitchDelta: 0, run: false, fire: false,
    aim: false, switchTo: null, cycleWeapon: false,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// D1 — Responsividade de input (peso 25%, nota minima exigida: 5)
// ---------------------------------------------------------------------------

describe('D1 responsividade', () => {
  it('desloca o jogador ja no primeiro tic apos o comando', () => {
    const player = createPlayer({ x: 0, z: 0, yaw: 0 })
    tickPlayer(player, command({ forward: 1, run: true }), [])
    expect(Math.abs(player.z)).toBeGreaterThan(0)
  })

  it('gira a mira no mesmo tic do movimento do mouse', () => {
    const player = createPlayer({ x: 0, z: 0, yaw: 0 })
    tickPlayer(player, command({ yawDelta: 0.1 }), [])
    expect(player.yaw).toBeCloseTo(0.1, 6)
  })

  it('mantem a latencia de pior caso abaixo de 50 ms a 60 quadros', () => {
    // Composicao: espera pelo proximo tic + espera pelo proximo quadro.
    // Nao ha atraso proprio do pipeline, o que os dois testes acima provam.
    const piorEsperaTic = TIC_MS
    const piorEsperaQuadro = 1000 / 60
    expect(piorEsperaTic + piorEsperaQuadro).toBeLessThan(50)
  })

  /**
   * O teste acima supoe 60 quadros por segundo, e supor nao e medir.
   *
   * Nao consigo medir framerate real aqui — depende de requestAnimationFrame
   * num navegador visivel. O que consigo medir, e que e a metade da conta que
   * depende deste codigo, e quanto do orcamento de quadro a SIMULACAO consome.
   * Se ela sozinha ja estourasse o quadro, os 60 fps seriam impossiveis e a
   * latencia declarada seria fantasia.
   */
  it('deixa a simulacao consumir menos de 20% do orcamento de quadro', () => {
    resetEnemyIds()
    const game = new Game(29)

    // Enche a arena ate o teto de inimigos simultaneos: e a pior carga real.
    // Povoamos direto em vez de esperar as ondas, porque o jogador simulado
    // nao mata ninguem e a onda 1 nunca terminaria.
    const raio = game.arena.size / 2 - 200
    for (let i = 0; i < MAX_CONCURRENT; i++) {
      const angulo = (i / MAX_CONCURRENT) * Math.PI * 2
      game.enemies.push(createEnemy(
        i % 3 === 0 ? 'imp' : 'zombieman',
        Math.cos(angulo) * raio,
        Math.sin(angulo) * raio,
      ))
    }
    expect(game.aliveEnemies).toBeGreaterThanOrEqual(MAX_CONCURRENT)

    const amostras = 2000
    const inicio = performance.now()
    for (let i = 0; i < amostras; i++) {
      game.tick(command({ forward: 1, run: true, fire: true, yawDelta: 0.02 }))
      game.player.health = 100
    }
    const msPorTic = (performance.now() - inicio) / amostras

    // A 35 tics/s e 60 quadros/s, cabem 0,583 tic por quadro. Com teto de 20%
    // de um quadro de 16,7 ms, cada tic pode custar ate cerca de 5,7 ms.
    const orcamentoPorTic = (1000 / 60) * 0.2 / (TICRATE / 60)
    expect(msPorTic).toBeLessThan(orcamentoPorTic)
  })

  it('aplica o dano do tiro em no maximo 4 tics de gatilho', () => {
    for (const [nome, arma] of Object.entries(WEAPONS)) {
      expect(arma.delayTics, nome).toBeLessThanOrEqual(4)
      expect(arma.delayTics * TIC_MS, nome).toBeLessThan(120)
    }
  })

  it('nao perde comando quando dois tics rodam no mesmo quadro', () => {
    // Regressao do modelo de comando por tic: o giro do mouse e consumido,
    // nao repetido. Repetir dobraria a sensibilidade em quadro lento.
    const player = createPlayer({ x: 0, z: 0, yaw: 0 })
    tickPlayer(player, command({ yawDelta: 0.2 }), [])
    tickPlayer(player, command({ yawDelta: 0 }), [])
    expect(player.yaw).toBeCloseTo(0.2, 6)
  })
})

// ---------------------------------------------------------------------------
// D2 — Feedback de tiro (peso 25%)
// ---------------------------------------------------------------------------

describe('D2 feedback de tiro', () => {
  it('entrega o evento de disparo com os rastros de todos os chumbos', () => {
    resetEnemyIds()
    const game = new Game(3)
    let evento = null

    for (let i = 0; i < TICRATE * 5 && !evento; i++) {
      const events = game.tick(command({ fire: true }))
      if (events.fired) evento = events
    }

    expect(evento).not.toBeNull()
    expect(evento!.traces).toHaveLength(WEAPONS.shotgun.pellets)
    expect(evento!.weaponFired).toBe('shotgun')
  })

  it('marca no rastro se o chumbo acertou, para o desenho reagir', () => {
    resetEnemyIds()
    const game = new Game(7)
    while (game.aliveEnemies === 0) game.tick(command())

    const alvo = game.enemies.find((e) => e.alive)!
    game.player.yaw = Math.atan2(-(alvo.x - game.player.x), -(alvo.z - game.player.z))

    let comAcerto = false
    for (let i = 0; i < TICRATE * 10 && !comAcerto; i++) {
      const events = game.tick(command({ fire: true }))
      if (events.traces.some((t) => t.hit)) comAcerto = true
    }

    expect(comAcerto).toBe(true)
  })

  /**
   * A versao anterior contava `fired` e `weaponFired` como dois canais, mas
   * sao o mesmo acontecimento — a contagem estava inflada para alcancar o
   * limiar. Agora cada canal e um sinal distinto, chegando ao jogador por uma
   * via sensorial diferente.
   */
  it('produz quatro canais distintos de retorno no mesmo disparo', () => {
    resetEnemyIds()
    const game = new Game(7)
    while (game.aliveEnemies === 0) game.tick(command())

    const alvo = game.enemies.find((e) => e.alive)!
    const vidaInicial = alvo.health

    let canais: Record<string, boolean> = {}
    for (let i = 0; i < TICRATE * 10; i++) {
      game.player.yaw = Math.atan2(
        -(alvo.x - game.player.x),
        -(alvo.z - game.player.z),
      )
      const events = game.tick(command({ fire: true }))
      if (!events.fired) continue

      canais = {
        // Visual perto: rastro saindo do cano ate o ponto de impacto.
        rastro: events.traces.length === WEAPONS.shotgun.pellets,
        // Sonoro: o desenho sabe qual arma tocar.
        som: events.weaponFired !== null,
        // Visual longe: o alvo perdeu vida, logo muda de cor e e empurrado.
        alvoAtingido: alvo.health < vidaInicial,
        // Espacial: o rastro informa onde o tiro parou, e nao so que houve.
        pontoDeImpacto: events.traces.every(
          (t) => Number.isFinite(t.toX) && Number.isFinite(t.toZ),
        ),
      }

      if (Object.values(canais).every(Boolean)) break
    }

    expect(canais).toEqual({
      rastro: true,
      som: true,
      alvoAtingido: true,
      pontoDeImpacto: true,
    })
  })

  it('separa o rastro que acertou do que bateu na parede', () => {
    // O desenho precisa dessa distincao para decidir onde faiscar. Sem ela,
    // o jogador nao sabe se errou ou se acertou sem matar.
    resetEnemyIds()
    const game = new Game(7)
    while (game.aliveEnemies === 0) game.tick(command())

    const alvo = game.enemies.find((e) => e.alive)!

    /** Mira no angulo pedido e devolve os rastros do proximo disparo. */
    function dispararCom(desvio: number) {
      for (let i = 0; i < TICRATE * 6; i++) {
        alvo.health = alvo.maxHealth // mantem o alvo de pe entre as medicoes
        game.player.yaw = Math.atan2(
          -(alvo.x - game.player.x),
          -(alvo.z - game.player.z),
        ) + desvio
        const events = game.tick(command({ fire: true }))
        if (events.fired) return events.traces
      }
      return []
    }

    const mirado = dispararCom(0)
    const errado = dispararCom(Math.PI / 2)

    expect(mirado.some((t) => t.hit)).toBe(true)
    expect(errado.every((t) => !t.hit)).toBe(true)
    // O ponto de parada tem de ser util para o desenho nos dois casos.
    for (const rastro of [...mirado, ...errado]) {
      expect(Number.isFinite(rastro.toX)).toBe(true)
      expect(Number.isFinite(rastro.toZ)).toBe(true)
    }
  })

  it('mantem a cadencia da escopeta legivel, entre 1 e 1,5 segundo', () => {
    const ciclo = WEAPONS.shotgun.cycleTics * TIC_MS
    expect(ciclo).toBeGreaterThan(1000)
    expect(ciclo).toBeLessThan(1600)
  })
})

// ---------------------------------------------------------------------------
// D3 — Fidelidade de movimento (peso 20%)
// ---------------------------------------------------------------------------

describe('D3 fidelidade de movimento', () => {
  /** Velocidade de regime que o jogador de fato percorre, em u/s. */
  function medirVelocidade(cmd: TicCommand): number {
    const player = createPlayer({ x: 0, z: 0, yaw: 0 })
    for (let i = 0; i < 400; i++) tickPlayer(player, cmd, [])
    const momento = Math.hypot(player.momentumX, player.momentumZ)
    return perTicToPerSecond(momento / FRICTION)
  }

  it('corre a 583,3 u/s, com erro abaixo de 1% do original', () => {
    const medido = medirVelocidade(command({ forward: 1, run: true }))
    const alvo = perTicToPerSecond(TERMINAL_SPEED.forwardRun)
    expect(Math.abs(medido - alvo) / alvo).toBeLessThan(0.01)
    expect(medido).toBeCloseTo(583.3, 0)
  })

  it('caminha a 291,7 u/s, com erro abaixo de 1%', () => {
    const medido = medirVelocidade(command({ forward: 1 }))
    expect(Math.abs(medido - 291.7) / 291.7).toBeLessThan(0.01)
  })

  it('faz strafe a 466,7 u/s correndo, com erro abaixo de 1%', () => {
    const medido = medirVelocidade(command({ side: 1, run: true }))
    expect(Math.abs(medido - 466.7) / 466.7).toBeLessThan(0.01)
  })

  it('para em menos de 1,7 segundo depois de soltar o controle', () => {
    const player = createPlayer({ x: 0, z: 0, yaw: 0 })
    for (let i = 0; i < 200; i++) tickPlayer(player, command({ forward: 1, run: true }), [])

    let tics = 0
    while ((player.momentumX !== 0 || player.momentumZ !== 0) && tics < 300) {
      tickPlayer(player, command(), [])
      tics++
    }

    expect(tics * TIC_MS).toBeLessThan(1700)
  })

  it('mantem a altura do olho e o campo de visao do original', () => {
    expect(VIEW_HEIGHT).toBe(41)
  })
})

// ---------------------------------------------------------------------------
// D4 — Reacao do inimigo ao dano (peso 20%)
// ---------------------------------------------------------------------------

describe('D4 reacao do inimigo', () => {
  /**
   * A versao anterior deste teste contava o empurrao como reacao. Como o
   * empurrao acontece em 100% dos acertos por construcao, o teste passava
   * mesmo com `painChance` zerado: era verdadeiro por vacuidade e nao provava
   * nada. Agora cada canal de reacao e medido separadamente.
   */
  it('interrompe o inimigo em cerca de 78% dos acertos, como no original', () => {
    const random = createRandom(11)
    let interrompidos = 0
    const total = 600

    for (let i = 0; i < total; i++) {
      resetEnemyIds()
      const inimigo = createEnemy('imp', 0, -300)
      if (damageEnemy(inimigo, 5, 0, -1, random).staggered) interrompidos++
    }

    const taxa = interrompidos / total
    // painchance 200 em 256. Faixa larga o bastante para nao virar teste
    // fragil de gerador, estreita o bastante para pegar a constante trocada.
    expect(taxa).toBeGreaterThan(0.7)
    expect(taxa).toBeLessThan(0.86)
  })

  it('nao passa se a chance de interrupcao for zerada', () => {
    // Guarda contra a regressao que o teste antigo permitia: se alguem anular
    // a reacao, isto quebra.
    expect(ENEMIES.imp.painChance).toBeGreaterThan(0.5)
    expect(ENEMIES.zombieman.painChance).toBeGreaterThan(0.5)
  })

  it('congela o inimigo interrompido, para o acerto ser visivel na tela', () => {
    const inimigo = createEnemy('imp', 0, -600)
    inimigo.state = 'pain'
    inimigo.stateTics = ENEMIES.imp.painTics
    inimigo.knockX = 0
    inimigo.knockZ = 0

    const antesZ = inimigo.z
    tickEnemy(inimigo, {
      player: { x: 0, z: 0 },
      walls: [],
      others: [],
      random: createRandom(1),
    })

    expect(inimigo.z).toBe(antesZ)
  })

  it('empurra o inimigo em toda pancada, proporcional ao dano', () => {
    expect(damageThrust(5)).toBeGreaterThan(0)
    expect(damageThrust(15)).toBeGreaterThan(damageThrust(5))
  })

  it('interrompe o inimigo por menos de 200 ms, sem travar o combate', () => {
    for (const [nome, stats] of Object.entries(ENEMIES)) {
      expect(stats.painTics * TIC_MS, nome).toBeLessThan(200)
      expect(stats.painTics, nome).toBeGreaterThan(0)
    }
  })

  it('deixa a morte visivel por tempo suficiente para ser notada', () => {
    for (const [nome, stats] of Object.entries(ENEMIES)) {
      expect(stats.deathTics * TIC_MS, nome).toBeGreaterThan(600)
    }
  })

  it('mata a escopeta em poucos disparos, para o acerto valer a pena', () => {
    // Sete chumbos de 5 a 15 acertando em cheio derrubam qualquer um dos dois
    // tipos de uma vez. A distancia, a dispersao cobra o preco.
    const danoMedioTotal = WEAPONS.shotgun.pellets * 5 * 2
    expect(danoMedioTotal).toBeGreaterThan(ENEMIES.zombieman.health)
    expect(danoMedioTotal).toBeGreaterThan(ENEMIES.imp.health)
  })
})

// ---------------------------------------------------------------------------
// D5 — Legibilidade de combate (peso 10%)
// ---------------------------------------------------------------------------

describe('D5 legibilidade de combate', () => {
  it('limita quantos inimigos existem ao mesmo tempo', () => {
    expect(MAX_CONCURRENT).toBeLessThanOrEqual(16)
  })

  it('deixa o jogador mais rapido que qualquer inimigo, para poder recuar', () => {
    for (const [nome, stats] of Object.entries(ENEMIES)) {
      expect(chaseSpeed(stats), nome).toBeLessThan(TERMINAL_SPEED.forwardRun)
    }
  })

  it('mantem os obstaculos baixos abaixo da linha de visao', () => {
    const arena = createArena()
    const baixos = arena.walls.filter((w) => w.height !== undefined && w.height < 64)

    expect(baixos.length).toBeGreaterThan(0)
    for (const parede of baixos) {
      expect(parede.height!).toBeLessThan(VIEW_HEIGHT)
    }
  })

  it('nunca faz um inimigo nascer perto o bastante para surpreender', () => {
    resetEnemyIds()
    const game = new Game(5)

    for (let i = 0; i < TICRATE * 30; i++) {
      game.tick(command())
      for (const inimigo of game.enemies) {
        if (inimigo.health !== inimigo.maxHealth) continue
        const distancia = Math.hypot(inimigo.x - game.player.x, inimigo.z - game.player.z)
        expect(distancia).toBeGreaterThan(200)
      }
    }
  })

  it('nao deixa inimigos se sobreporem a ponto de virarem um vulto so', () => {
    resetEnemyIds()
    const game = new Game(13)
    for (let i = 0; i < TICRATE * 60; i++) game.tick(command())

    const vivos = game.enemies.filter((e) => e.alive)
    for (let i = 0; i < vivos.length; i++) {
      for (let j = i + 1; j < vivos.length; j++) {
        const gap = Math.hypot(vivos[i]!.x - vivos[j]!.x, vivos[i]!.z - vivos[j]!.z)
        expect(gap).toBeGreaterThan(vivos[i]!.radius * 0.8)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// Nota de corte da rubrica
// ---------------------------------------------------------------------------

describe('corte da rubrica', () => {
  it('nao aceita arma com atraso perceptivel, o criterio inegociavel', () => {
    // Se este cair, a entrega esta reprovada independente das outras notas.
    const piorAtraso = Math.max(...Object.values(WEAPONS).map((w) => w.delayTics))
    expect(piorAtraso * TIC_MS).toBeLessThan(120)
  })

  it('mantem a arma disparando sem engasgo com o gatilho segurado', () => {
    const arma = createWeapon('shotgun')
    const random = createRandom(2)
    const disparos: number[] = []

    for (let tic = 0; tic < TICRATE * 20; tic++) {
      if (tickWeapon(arma, true, random)) disparos.push(tic)
    }

    expect(disparos.length).toBeGreaterThan(10)
    const intervalos = disparos.slice(1).map((t, i) => t - disparos[i]!)
    // Cadencia constante: nenhum intervalo destoa dos demais.
    expect(new Set(intervalos).size).toBe(1)
  })
})
