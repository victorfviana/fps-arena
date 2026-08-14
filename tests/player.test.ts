/**
 * Fisica do jogador.
 *
 * Estes testes sao o instrumento da rubrica de "fidelidade de movimento": o
 * jogador simulado precisa chegar as mesmas velocidades derivadas do source
 * do DOOM, e nao a um valor que apenas pareca bom.
 */
import { describe, it, expect } from 'vitest'
import { createPlayer, forwardVector, rightVector, tickPlayer } from '../src/player/player'
import { TERMINAL_SPEED, perTicToPerSecond, PLAYER_RADIUS } from '../src/core/doom'
import type { TicCommand } from '../src/core/input'
import type { Wall } from '../src/world/collision'

const OPEN_FIELD: Wall[] = []

/** Sala de 4096 unidades de lado: espaco de sobra para atingir o regime. */
const ROOM: Wall[] = [
  { ax: -2048, az: -2048, bx: 2048, bz: -2048 },
  { ax: 2048, az: -2048, bx: 2048, bz: 2048 },
  { ax: 2048, az: 2048, bx: -2048, bz: 2048 },
  { ax: -2048, az: 2048, bx: -2048, bz: -2048 },
]

function command(overrides: Partial<TicCommand> = {}): TicCommand {
  return {
    forward: 0,
    side: 0,
    yawDelta: 0,
    pitchDelta: 0,
    run: false,
    fire: false,
    aim: false,
    switchTo: null,
    cycleWeapon: false,
    ...overrides,
  }
}

function runTics(
  count: number,
  cmd: TicCommand,
  walls: readonly Wall[] = OPEN_FIELD,
  start = { x: 0, z: 0, yaw: 0 },
) {
  const player = createPlayer(start)
  for (let i = 0; i < count; i++) tickPlayer(player, cmd, walls)
  return player
}

describe('orientacao', () => {
  it('olha para -Z com angulo zero', () => {
    const forward = forwardVector(0)
    expect(forward.x).toBeCloseTo(0, 10)
    expect(forward.z).toBeCloseTo(-1, 10)
  })

  it('tem a direita em +X com angulo zero', () => {
    const right = rightVector(0)
    expect(right.x).toBeCloseTo(1, 10)
    expect(right.z).toBeCloseTo(0, 10)
  })

  it('mantem frente e direita perpendiculares em qualquer angulo', () => {
    for (const yaw of [0, 0.7, 1.9, 3.3, 5.6]) {
      const f = forwardVector(yaw)
      const r = rightVector(yaw)
      expect(f.x * r.x + f.z * r.z).toBeCloseTo(0, 10)
    }
  })
})

describe('velocidade em campo aberto', () => {
  it('chega a velocidade de corrida derivada do DOOM', () => {
    const player = runTics(300, command({ forward: 1, run: true }))
    const speed = Math.hypot(player.momentumX, player.momentumZ)

    // O momento guardado ja passou pela friccao; o deslocamento do tic e ele
    // dividido pelo fator de friccao. Comparamos na mesma base do benchmark.
    const travelPerTic = speed / 0.90625
    expect(perTicToPerSecond(travelPerTic)).toBeCloseTo(583.33, 0)
  })

  it('anda a metade da velocidade quando nao esta correndo', () => {
    const running = runTics(300, command({ forward: 1, run: true }))
    const walking = runTics(300, command({ forward: 1, run: false }))

    const runSpeed = Math.hypot(running.momentumX, running.momentumZ)
    const walkSpeed = Math.hypot(walking.momentumX, walking.momentumZ)

    expect(runSpeed / walkSpeed).toBeCloseTo(2, 2)
  })

  it('faz o strafe mais lento que o avanco, como no original', () => {
    const forward = runTics(300, command({ forward: 1, run: true }))
    const strafe = runTics(300, command({ side: 1, run: true }))

    expect(Math.hypot(strafe.momentumX, strafe.momentumZ)).toBeLessThan(
      Math.hypot(forward.momentumX, forward.momentumZ),
    )
  })

  it('anda para tras na direcao oposta', () => {
    const player = runTics(60, command({ forward: -1, run: true }))
    expect(player.z).toBeGreaterThan(0)
  })
})

describe('resposta ao comando', () => {
  it('desloca ja no primeiro tic, sem atraso de partida', () => {
    const player = runTics(1, command({ forward: 1, run: true }))
    expect(player.z).toBeLessThan(0)
    expect(Math.abs(player.z)).toBeGreaterThan(0.5)
  })

  it('para quando o comando cessa, em vez de deslizar para sempre', () => {
    const player = createPlayer({ x: 0, z: 0, yaw: 0 })
    const forward = command({ forward: 1, run: true })
    for (let i = 0; i < 100; i++) tickPlayer(player, forward, OPEN_FIELD)

    const idle = command()
    let ticsToStop = 0
    while ((player.momentumX !== 0 || player.momentumZ !== 0) && ticsToStop < 200) {
      tickPlayer(player, idle, OPEN_FIELD)
      ticsToStop++
    }

    expect(ticsToStop).toBeLessThan(60)
    expect(player.momentumX).toBe(0)
    expect(player.momentumZ).toBe(0)
  })
})

describe('mira', () => {
  it('mantem o angulo horizontal dentro de uma volta completa', () => {
    const player = createPlayer({ x: 0, z: 0, yaw: 0 })
    for (let i = 0; i < 500; i++) {
      tickPlayer(player, command({ yawDelta: 0.5 }), OPEN_FIELD)
    }
    expect(player.yaw).toBeGreaterThanOrEqual(0)
    expect(player.yaw).toBeLessThan(Math.PI * 2)
  })

  it('trava o olhar vertical antes de virar a cabeca de cabeca para baixo', () => {
    const up = runTics(200, command({ pitchDelta: 0.5 }))
    const down = runTics(200, command({ pitchDelta: -0.5 }))

    expect(up.pitch).toBeLessThan(Math.PI / 2)
    expect(down.pitch).toBeGreaterThan(-Math.PI / 2)
  })
})

describe('colisao', () => {
  it('nao atravessa a parede nem correndo em linha reta', () => {
    const player = createPlayer({ x: 0, z: 0, yaw: 0 })
    const forward = command({ forward: 1, run: true })

    for (let i = 0; i < 400; i++) {
      tickPlayer(player, forward, ROOM)
      expect(Math.abs(player.x)).toBeLessThanOrEqual(2048 - PLAYER_RADIUS + 0.01)
      expect(Math.abs(player.z)).toBeLessThanOrEqual(2048 - PLAYER_RADIUS + 0.01)
    }
  })

  it('mata o momento contra a parede em vez de acumular empurrao', () => {
    const player = createPlayer({ x: 0, z: -2000, yaw: 0 })
    const forward = command({ forward: 1, run: true })
    for (let i = 0; i < 60; i++) tickPlayer(player, forward, ROOM)

    // Encostado na parede norte: nada de momento guardado para disparar
    // o jogador quando ele virar.
    expect(Math.abs(player.momentumZ)).toBeLessThan(1)
  })

  it('desliza pela parede quando o jogador corre na diagonal contra ela', () => {
    const player = createPlayer({ x: 0, z: -2000, yaw: 0 })
    const diagonal = command({ forward: 1, side: 1, run: true })
    for (let i = 0; i < 60; i++) tickPlayer(player, diagonal, ROOM)

    // Bloqueado no eixo Z, mas o componente lateral sobreviveu.
    expect(player.x).toBeGreaterThan(200)
  })
})

describe('balanco da camera', () => {
  it('oscila enquanto anda e descansa quando para', () => {
    const player = createPlayer({ x: 0, z: 0, yaw: 0 })
    const forward = command({ forward: 1, run: true })

    const samples: number[] = []
    for (let i = 0; i < 40; i++) {
      tickPlayer(player, forward, OPEN_FIELD)
      samples.push(player.viewBob)
    }
    expect(Math.max(...samples)).toBeGreaterThan(0.5)
    expect(Math.min(...samples)).toBeLessThan(-0.5)

    const idle = command()
    for (let i = 0; i < 120; i++) tickPlayer(player, idle, OPEN_FIELD)
    expect(player.viewBob).toBe(0)
  })

  it('nao passa da amplitude do original', () => {
    const player = createPlayer({ x: 0, z: 0, yaw: 0 })
    const forward = command({ forward: 1, run: true })

    for (let i = 0; i < 200; i++) {
      tickPlayer(player, forward, OPEN_FIELD)
      expect(Math.abs(player.viewBob)).toBeLessThanOrEqual(8.0001)
    }
  })
})

describe('estabilidade numerica', () => {
  it('sobrevive a uma sessao longa e erratica sem virar NaN', () => {
    const player = createPlayer({ x: 0, z: 0, yaw: 0 })

    for (let i = 0; i < 3000; i++) {
      const cmd = command({
        forward: (i % 3) - 1,
        side: (i % 5) - 2,
        yawDelta: Math.sin(i * 0.31) * 0.2,
        pitchDelta: Math.cos(i * 0.17) * 0.1,
        run: i % 2 === 0,
      })
      tickPlayer(player, cmd, ROOM)
    }

    for (const value of [player.x, player.z, player.yaw, player.pitch, player.viewBob]) {
      expect(Number.isFinite(value)).toBe(true)
    }
    expect(perTicToPerSecond(Math.hypot(player.momentumX, player.momentumZ)))
      .toBeLessThan(perTicToPerSecond(TERMINAL_SPEED.forwardRun) * 1.5)
  })
})
