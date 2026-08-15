/**
 * IA estrategica: cobertura, flanco e o sargento de escopeta.
 *
 * O que estes testes travam nao e "o inimigo parece esperto" — isso e opiniao.
 * E o comportamento observavel que o plano prometeu, cada um com um sinal que a
 * maquina le sozinha:
 *
 * - cobertura: depois de atirar, o zombieman anda ate um ponto de onde
 *   `segmentBlocked` responde TRUE. A visada cortada e o criterio; "atras do
 *   pilar" e so a aparencia disso.
 * - flanco: a trajetoria do imp se afasta da reta que liga o ponto de partida
 *   ao jogador, e o afastamento e medido em map units, nao adjetivado.
 * - sargento: as constantes conferem com o benchmark e o dano de um disparo
 *   fica entre um e tres chumbos.
 * - determinismo: mesma semente, mesmas trajetorias, casa decimal por casa
 *   decimal. E a propriedade que sustenta todos os outros testes seedados do
 *   projeto; IA nova que sorteasse fora do gerador quebraria aqui.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  BEHAVIOUR,
  createEnemy,
  resetEnemyIds,
  tickEnemy,
  type Enemy,
  type EnemyTickContext,
} from '../src/enemies/enemy'
import { createRandom } from '../src/core/random'
import {
  ATTACK_CYCLE_TICS,
  ENEMIES,
  SPOS_PELLETS,
  TICRATE,
  chaseSpeed,
} from '../src/core/doom'
import { SHOT_HEIGHT } from '../src/weapons/hitscan'
import { createArena } from '../src/world/arena'
import { segmentBlocked, type Wall } from '../src/world/collision'
import { Game } from '../src/game'
import type { TicCommand } from '../src/core/input'

const SEM_PAREDES: Wall[] = []

function command(overrides: Partial<TicCommand> = {}): TicCommand {
  return {
    forward: 0, side: 0, yawDelta: 0, pitchDelta: 0, run: false, fire: false,
    aim: false, switchTo: null, cycleWeapon: false,
    ...overrides,
  }
}

/**
 * Contexto com gerador PERSISTENTE entre os tics.
 *
 * Recriar o gerador a cada chamada devolveria sempre o mesmo primeiro valor e
 * congelaria toda escolha aleatoria — a armadilha que ja mordeu
 * tests/legibilidade.test.ts.
 */
function contextoFabrica(base: Partial<EnemyTickContext> = {}, seed = 9) {
  const random = createRandom(seed)
  return (overrides: Partial<EnemyTickContext> = {}): EnemyTickContext => ({
    player: { x: 0, z: 0 },
    walls: SEM_PAREDES,
    others: [],
    random,
    ...base,
    ...overrides,
  })
}

beforeEach(() => resetEnemyIds())

// ---------------------------------------------------------------------------
// Cobertura
// ---------------------------------------------------------------------------

describe('cobertura entre tiros', () => {
  /**
   * Cenario tirado da arena de verdade, e nao de uma caixa inventada: pilar do
   * galpao em (512, -512), 128 x 128 e altura cheia. O zombieman comeca ao lado
   * dele, com a visada do jogador (na origem) livre por cima do pilar — logo
   * atira no primeiro tic — e o ponto que corta essa visada fica a menos de 100
   * unidades, ao alcance de uma recarga de caminhada.
   */
  function cenarioDoPilar() {
    const arena = createArena()
    const galpao = arena.salas[0]!
    const contexto = contextoFabrica({
      walls: arena.walls,
      coberturas: galpao.boxes,
    })
    const inimigo = createEnemy('zombieman', 600, -420)
    return { arena, contexto, inimigo }
  }

  it('escolhe, ao atirar, um ponto que corta a visada do jogador', () => {
    const { arena, contexto, inimigo } = cenarioDoPilar()

    // Antes de atirar ele nao esta se cobrindo: a cobertura e consequencia do
    // disparo, nao um estado permanente.
    expect(inimigo.coverX).toBeNull()
    expect(
      segmentBlocked(inimigo.x, inimigo.z, 0, 0, arena.walls, SHOT_HEIGHT),
      'o cenario exige visada livre no inicio, senao ele nem atira',
    ).toBe(false)

    const tiro = tickEnemy(inimigo, contexto())
    expect(tiro).not.toBeNull()

    expect(inimigo.coverX).not.toBeNull()
    // O ponto escolhido ja e, por definicao, um lugar de visada cortada.
    expect(
      segmentBlocked(inimigo.coverX!, inimigo.coverZ!, 0, 0, arena.walls, SHOT_HEIGHT),
    ).toBe(true)
  })

  it('caminha ate la e chega com a visada de fato bloqueada', () => {
    const { arena, contexto, inimigo } = cenarioDoPilar()

    tickEnemy(inimigo, contexto())
    const alvoX = inimigo.coverX!
    const alvoZ = inimigo.coverZ!
    const faltaNoInicio = Math.hypot(alvoX - inimigo.x, alvoZ - inimigo.z)

    let chegou = false
    let escondido = false
    for (let i = 0; i < 90 && !chegou; i++) {
      tickEnemy(inimigo, contexto())
      const falta = Math.hypot(alvoX - inimigo.x, alvoZ - inimigo.z)
      if (falta <= 24) {
        chegou = true
        escondido = segmentBlocked(inimigo.x, inimigo.z, 0, 0, arena.walls, SHOT_HEIGHT)
      }
    }

    expect(faltaNoInicio).toBeGreaterThan(24)
    expect(chegou, 'nao chegou a cobertura dentro do orcamento').toBe(true)
    expect(escondido, 'chegou ao ponto mas continuou a vista').toBe(true)
  })

  it('nao dispara enquanto esta abrigado, e volta a disparar depois', () => {
    const { contexto, inimigo } = cenarioDoPilar()

    expect(tickEnemy(inimigo, contexto())).not.toBeNull()

    let tirosDepois = 0
    let ticsAbrigado = 0
    for (let i = 0; i < TICRATE * 8; i++) {
      if (tickEnemy(inimigo, contexto())) tirosDepois++
      if (inimigo.coverX !== null) ticsAbrigado++
    }

    // Passou tempo real atras do obstaculo...
    expect(ticsAbrigado).toBeGreaterThan(20)
    // ...e ainda assim voltou a brigar, em vez de ficar escondido para sempre.
    expect(tirosDepois).toBeGreaterThan(0)
  })

  /**
   * O que garante isto e o criterio operacional (visada cortada), e nao a
   * comparacao de altura em `escolherCobertura` — apagar aquela comparacao nao
   * quebra este teste, porque um ponto ao lado de um obstaculo de altura 28
   * simplesmente nao bloqueia `segmentBlocked` na altura do tiro. A comparacao
   * de altura e atalho de custo, e este teste prova que os dois concordam.
   */
  it('ignora obstaculo baixo, que barra o corpo mas nao a visada', () => {
    const arena = createArena()
    const galpao = arena.salas[0]!
    const baixos = galpao.boxes.filter((box) => box.height <= SHOT_HEIGHT)
    expect(baixos.length, 'o galpao precisa ter obstaculo baixo').toBeGreaterThan(0)

    const contexto = contextoFabrica({ walls: arena.walls, coberturas: baixos })
    const inimigo = createEnemy('zombieman', 600, -420)

    expect(tickEnemy(inimigo, contexto())).not.toBeNull()
    expect(inimigo.coverX).toBeNull()
  })

  it('sem cobertura ao alcance, mantem o comportamento antigo', () => {
    // Mesmo cenario, sem lista de coberturas: e o contexto que os testes
    // anteriores a esta etapa montam, e o inimigo tem de se comportar como
    // sempre se comportou — aproximar-se ate a distancia preferida.
    const arena = createArena()
    const contexto = contextoFabrica({ walls: arena.walls })
    const inimigo = createEnemy('zombieman', 600, -420)

    tickEnemy(inimigo, contexto())
    expect(inimigo.coverX).toBeNull()

    for (let i = 0; i < 400; i++) tickEnemy(inimigo, contexto())

    const distancia = Math.hypot(inimigo.x, inimigo.z)
    expect(distancia).toBeLessThan(BEHAVIOUR.zombieman.preferredRange * 1.7)
  })
})

// ---------------------------------------------------------------------------
// Flanco
// ---------------------------------------------------------------------------

/** Trajetoria de um imp solto, do ponto de partida ate onde ele parar. */
function correr(inimigo: Enemy, contexto: () => EnemyTickContext, tics: number) {
  const caminho: Array<{ x: number; z: number }> = []
  for (let i = 0; i < tics; i++) {
    tickEnemy(inimigo, contexto())
    caminho.push({ x: inimigo.x, z: inimigo.z })
  }
  return caminho
}

describe('flanco do imp', () => {
  it('a 600 unidades, sai visivelmente da reta ate o jogador', () => {
    const contexto = contextoFabrica()
    const inimigo = createEnemy('imp', 0, -600)

    // A reta de referencia e o eixo Z: partida em (0,-600), jogador em (0,0).
    // O afastamento dela e, portanto, o proprio |x|.
    const caminho = correr(inimigo, contexto, 150)
    const afastamentoMaximo = Math.max(...caminho.map((p) => Math.abs(p.x)))

    expect(afastamentoMaximo).toBeGreaterThan(40)
  })

  it('converge no fim: chega a distancia de ataque e ataca', () => {
    const contexto = contextoFabrica()
    const inimigo = createEnemy('imp', 0, -600)

    let atacou = false
    for (let i = 0; i < 600; i++) {
      if (tickEnemy(inimigo, contexto())) atacou = true
    }

    expect(atacou, 'o desvio de flanco nao pode impedir o imp de fechar').toBe(true)
    // Terminou orbitando a distancia preferida, e nao circulando de longe: o
    // desvio derrete perto, em vez de virar uma orbita permanente.
    expect(Math.hypot(inimigo.x, inimigo.z)).toBeLessThan(BEHAVIOUR.imp.preferredRange * 1.7)
  })

  it('de perto anda para cima do jogador, sem desvio nenhum', () => {
    const contexto = contextoFabrica()
    const inimigo = createEnemy('imp', 0, -280) // dentro de flancoConverge

    const antes = { x: inimigo.x, z: inimigo.z }
    tickEnemy(inimigo, contexto())

    const passoX = inimigo.x - antes.x
    const passoZ = inimigo.z - antes.z
    const paraJogador = Math.hypot(antes.x, antes.z)
    const alinhamento =
      (passoX * -antes.x + passoZ * -antes.z) / (Math.hypot(passoX, passoZ) * paraJogador)

    // Coseno do angulo entre o passo dado e a direcao do jogador: 1 e reta.
    expect(alinhamento).toBeGreaterThan(0.999)
  })

  it('manda ids pares por um lado e impares pelo outro', () => {
    const par = createEnemy('imp', 0, -600)
    const impar = createEnemy('imp', 0, -600)
    expect(par.id % 2).toBe(1) // ids comecam em 1
    expect(impar.id % 2).toBe(0)

    // Contextos independentes e `others` vazio: o que separa os dois e o lado
    // do flanco, e nao o empurrao entre corpos.
    const contextoA = contextoFabrica()
    const contextoB = contextoFabrica()
    for (let i = 0; i < 100; i++) {
      tickEnemy(par, contextoA())
      tickEnemy(impar, contextoB())
    }

    expect(Math.abs(par.x)).toBeGreaterThan(20)
    expect(Math.abs(impar.x)).toBeGreaterThan(20)
    expect(Math.sign(par.x)).toBe(-Math.sign(impar.x))
  })

  it('o lado nao muda no meio do caminho', () => {
    const contexto = contextoFabrica()
    const inimigo = createEnemy('imp', 0, -900)

    const caminho = correr(inimigo, contexto, 200)
    // Enquanto esta longe (fora da convergencia), o sinal do afastamento e um
    // so: lado sorteado por tic desenharia zigue-zague, e nao flanco.
    const longe = caminho.filter((p) => Math.hypot(p.x, p.z) > BEHAVIOUR.imp.flancoConverge)
    const sinais = new Set(longe.filter((p) => Math.abs(p.x) > 1).map((p) => Math.sign(p.x)))

    expect(longe.length).toBeGreaterThan(20)
    expect(sinais.size).toBe(1)
  })

  it('nao atravessa parede ao flanquear', () => {
    const arena = createArena()
    const contexto = contextoFabrica({ walls: arena.walls })
    const inimigo = createEnemy('imp', 832, -832)

    for (let i = 0; i < 400; i++) {
      tickEnemy(inimigo, contexto())
      // Dentro do galpao, e nunca dentro de um pilar (128 x 128 nos ±512).
      expect(Math.abs(inimigo.x)).toBeLessThanOrEqual(1024)
      expect(Math.abs(inimigo.z)).toBeLessThanOrEqual(1024)

      for (const pilar of arena.salas[0]!.boxes.filter((b) => b.height > SHOT_HEIGHT)) {
        const dentro =
          Math.abs(inimigo.x - pilar.x) < pilar.width / 2 &&
          Math.abs(inimigo.z - pilar.z) < pilar.depth / 2
        expect(dentro).toBe(false)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// Sargento de escopeta
// ---------------------------------------------------------------------------

describe('sargento de escopeta', () => {
  it('tem o corpo do SPOS: vida 30, geometria do POSS, painchance 170', () => {
    expect(ENEMIES.sergeant.health).toBe(30)
    expect(ENEMIES.sergeant.radius).toBe(ENEMIES.zombieman.radius)
    expect(ENEMIES.sergeant.height).toBe(ENEMIES.zombieman.height)
    expect(ENEMIES.sergeant.painChance).toBeCloseTo(170 / 256, 10)
    // speed 8 como o POSS: a velocidade derivada tem de bater na virgula.
    expect(chaseSpeed(ENEMIES.sergeant)).toBe(chaseSpeed(ENEMIES.zombieman))
  })

  it('declara tres chumbos por disparo, como A_SPosAttack', () => {
    expect(SPOS_PELLETS).toBe(3)
    expect(BEHAVIOUR.sergeant.chumbos).toBe(3)
  })

  it('confere alcance e distancia preferida do desenho', () => {
    expect(BEHAVIOUR.sergeant.attackRange).toBe(700)
    expect(BEHAVIOUR.sergeant.preferredRange).toBe(300)
    // Escopeta chega mais perto que o rifle do zumbi, e alcanca menos.
    expect(BEHAVIOUR.sergeant.preferredRange).toBeLessThan(BEHAVIOUR.zombieman.preferredRange)
    expect(BEHAVIOUR.sergeant.attackRange).toBeLessThan(BEHAVIOUR.zombieman.attackRange)
  })

  it('reproduz a derivacao da cadencia mais lenta', () => {
    const derivado = Math.round(
      (BEHAVIOUR.zombieman.attackCooldownTics * ATTACK_CYCLE_TICS.spos) / ATTACK_CYCLE_TICS.poss,
    )
    expect(derivado).toBe(58)
    expect(BEHAVIOUR.sergeant.attackCooldownTics).toBe(derivado)
    expect(BEHAVIOUR.sergeant.attackCooldownTics)
      .toBeGreaterThan(BEHAVIOUR.zombieman.attackCooldownTics)
  })

  it('mantem a MESMA curva de acerto por distancia do zombieman', () => {
    // rollHit divide a queda pelo attackRange; igualar a razao e o que faz a
    // chance a X unidades ser identica nos dois tipos.
    const doSargento = BEHAVIOUR.sergeant.acertoQueda / BEHAVIOUR.sergeant.attackRange
    const doZumbi = BEHAVIOUR.zombieman.acertoQueda / BEHAVIOUR.zombieman.attackRange

    expect(BEHAVIOUR.sergeant.acertoBase).toBe(BEHAVIOUR.zombieman.acertoBase)
    expect(doSargento).toBeCloseTo(doZumbi, 12)
  })

  it('agrega os chumbos num unico golpe, entre 1x e 3x o dano unitario', () => {
    const unitario = BEHAVIOUR.sergeant.damage
    expect(unitario).toBe(BEHAVIOUR.zombieman.damage)

    const contexto = contextoFabrica({}, 31)
    const inimigo = createEnemy('sergeant', 0, -300)
    const danos: number[] = []

    for (let i = 0; i < BEHAVIOUR.sergeant.attackCooldownTics * 80; i++) {
      // Ancorado na distancia preferida: o que se mede aqui e a agregacao dos
      // chumbos, nao o passeio dele pela arena.
      inimigo.x = 0
      inimigo.z = -300
      const golpe = tickEnemy(inimigo, contexto())
      if (golpe?.hit) danos.push(golpe.damage)
    }

    expect(danos.length).toBeGreaterThan(20)
    for (const dano of danos) {
      expect(dano).toBeGreaterThanOrEqual(unitario)
      expect(dano).toBeLessThanOrEqual(unitario * SPOS_PELLETS)
      expect(dano % unitario).toBe(0)
    }

    // Os dois extremos aparecem: se so aparecesse um valor, a agregacao seria
    // decorativa e um unico chumbo estaria decidindo tudo.
    expect(Math.min(...danos)).toBe(unitario)
    expect(Math.max(...danos)).toBe(unitario * SPOS_PELLETS)
  })

  it('nao acerta atraves de parede, como qualquer outro', () => {
    const walls: Wall[] = [{ ax: -400, az: -150, bx: 400, bz: -150 }]
    const contexto = contextoFabrica({ walls })
    const inimigo = createEnemy('sergeant', 0, -300)

    expect(tickEnemy(inimigo, contexto())).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Determinismo
// ---------------------------------------------------------------------------

describe('determinismo da IA nova', () => {
  /** Trajetoria de todos os inimigos, tic a tic, de uma partida seedada. */
  function trajetorias(semente: number): string[] {
    resetEnemyIds()
    const game = new Game(semente)
    const registro: string[] = []

    for (let i = 0; i < TICRATE * 45; i++) {
      game.tick(command({
        forward: i % 90 < 45 ? 1 : 0,
        side: i % 60 < 30 ? 1 : -1,
        yawDelta: Math.sin(i * 0.05) * 0.1,
        fire: i % 11 < 4,
      }))

      for (const inimigo of game.enemies) {
        registro.push(
          `${i}:${inimigo.id}:${inimigo.kind}:${inimigo.x.toFixed(6)}:` +
          `${inimigo.z.toFixed(6)}:${inimigo.state}:${inimigo.coverX ?? '-'}`,
        )
      }
    }

    return registro
  }

  it('duas partidas com a mesma semente tem trajetorias identicas', () => {
    const primeira = trajetorias(0x1d1a)
    const segunda = trajetorias(0x1d1a)

    expect(primeira.length).toBeGreaterThan(1000)
    expect(segunda).toEqual(primeira)
  })

  it('sementes diferentes divergem, senao o teste acima seria vazio', () => {
    expect(trajetorias(0x1d1a)).not.toEqual(trajetorias(4242))
  })
})
