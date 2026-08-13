/**
 * Armas: cadencia, atraso ate o dano e dispersao.
 *
 * Estes numeros sao metade da rubrica de "feedback de tiro". Um atraso que
 * cresce sem querer e o defeito classico de FPS amador — o tiro passa a
 * parecer sem peso, e ninguem consegue apontar por que.
 */
import { describe, it, expect } from 'vitest'
import {
  averageDamagePerShot,
  canFire,
  createWeapon,
  tickWeapon,
  type FireEvent,
} from '../src/weapons/weapon'
import { hitscan, rayCircleDistance, type HitscanTarget } from '../src/weapons/hitscan'
import { createRandom } from '../src/core/random'
import { TIC_MS, VIEW_HEIGHT, WEAPONS } from '../src/core/doom'
import { createArena } from '../src/world/arena'
import type { Wall } from '../src/world/collision'

function fireAndCollect(
  weaponId: 'pistol' | 'shotgun',
  ticsToRun: number,
  holdTrigger: boolean,
): { events: Array<{ tic: number; event: FireEvent }> } {
  const weapon = createWeapon(weaponId)
  const random = createRandom(42)
  const events: Array<{ tic: number; event: FireEvent }> = []

  for (let tic = 0; tic < ticsToRun; tic++) {
    const wantsFire = holdTrigger || tic === 0
    const event = tickWeapon(weapon, wantsFire, random)
    if (event) events.push({ tic, event })
  }

  return { events }
}

describe('atraso ate o dano', () => {
  it('aplica o dano da pistola 4 tics apos o gatilho', () => {
    const { events } = fireAndCollect('pistol', 30, false)
    expect(events).toHaveLength(1)
    expect(events[0]!.tic).toBe(WEAPONS.pistol.delayTics)
  })

  it('aplica o dano da escopeta 3 tics apos o gatilho', () => {
    const { events } = fireAndCollect('shotgun', 60, false)
    expect(events).toHaveLength(1)
    expect(events[0]!.tic).toBe(WEAPONS.shotgun.delayTics)
  })

  it('mantem o atraso abaixo de 120 ms nas duas armas', () => {
    // Limiar da rubrica de responsividade: acima disso o tiro deixa de
    // parecer causado pelo clique.
    for (const definition of [WEAPONS.pistol, WEAPONS.shotgun]) {
      expect(definition.delayTics * TIC_MS).toBeLessThan(120)
    }
  })
})

describe('cadencia', () => {
  it('respeita o ciclo da pistola com o gatilho segurado', () => {
    const { events } = fireAndCollect('pistol', 100, true)

    expect(events.length).toBeGreaterThan(1)
    const gap = events[1]!.tic - events[0]!.tic
    expect(gap).toBe(WEAPONS.pistol.cycleTics)
  })

  it('deixa a escopeta bem mais lenta que a pistola', () => {
    expect(WEAPONS.shotgun.cycleTics).toBeGreaterThan(WEAPONS.pistol.cycleTics * 2)
  })

  it('nao dispara duas vezes no mesmo tic', () => {
    const { events } = fireAndCollect('pistol', 200, true)
    const tics = events.map((entry) => entry.tic)
    expect(new Set(tics).size).toBe(tics.length)
  })

  it('bloqueia o disparo enquanto a arma esta em recarga', () => {
    const weapon = createWeapon('pistol')
    const random = createRandom(1)

    tickWeapon(weapon, true, random)
    expect(canFire(weapon)).toBe(false)

    for (let i = 0; i < WEAPONS.pistol.cycleTics; i++) {
      tickWeapon(weapon, false, random)
    }
    expect(canFire(weapon)).toBe(true)
  })
})

describe('municao', () => {
  it('para de disparar quando acaba', () => {
    const weapon = createWeapon('pistol', 2)
    const random = createRandom(7)
    let shots = 0

    for (let tic = 0; tic < 200; tic++) {
      if (tickWeapon(weapon, true, random)) shots++
    }

    expect(shots).toBe(2)
    expect(weapon.ammo).toBe(0)
  })
})

describe('projeteis e dano', () => {
  it('dispara sete chumbos na escopeta e um na pistola', () => {
    expect(fireAndCollect('shotgun', 60, false).events[0]!.event.pellets).toHaveLength(7)
    expect(fireAndCollect('pistol', 30, false).events[0]!.event.pellets).toHaveLength(1)
  })

  it('sorteia dano de 5, 10 ou 15 por chumbo, como o original', () => {
    const weapon = createWeapon('shotgun')
    const random = createRandom(99)
    const seen = new Set<number>()

    for (let tic = 0; tic < 2000; tic++) {
      const event = tickWeapon(weapon, true, random)
      if (event) for (const pellet of event.pellets) seen.add(pellet.damage)
    }

    expect([...seen].sort((a, b) => a - b)).toEqual([5, 10, 15])
  })

  it('espalha a escopeta na horizontal, dentro do angulo declarado', () => {
    const { events } = fireAndCollect('shotgun', 60, false)
    const offsets = events[0]!.event.pellets.map((p) => p.angleOffset)
    const limit = (WEAPONS.shotgun.spreadDeg * Math.PI) / 180

    expect(Math.max(...offsets.map(Math.abs))).toBeLessThanOrEqual(limit)
    // Nem todos no mesmo lugar: sem isso a escopeta viraria uma pistola forte.
    expect(new Set(offsets).size).toBeGreaterThan(1)
  })

  it('nao espalha a pistola', () => {
    const { events } = fireAndCollect('pistol', 30, false)
    expect(events[0]!.event.pellets[0]!.angleOffset).toBe(0)
  })

  it('da a escopeta um dano medio muito maior, compensando a cadencia', () => {
    const pistol = averageDamagePerShot(WEAPONS.pistol)
    const shotgun = averageDamagePerShot(WEAPONS.shotgun)

    expect(pistol).toBe(10)
    expect(shotgun).toBe(70)
  })

  it('e reproduzivel com a mesma semente', () => {
    const first = fireAndCollect('shotgun', 60, false).events[0]!.event
    const second = fireAndCollect('shotgun', 60, false).events[0]!.event
    expect(first).toEqual(second)
  })
})

describe('tiro instantaneo', () => {
  const ROOM: Wall[] = [
    { ax: -1000, az: -1000, bx: 1000, bz: -1000 },
    { ax: 1000, az: -1000, bx: 1000, bz: 1000 },
    { ax: 1000, az: 1000, bx: -1000, bz: 1000 },
    { ax: -1000, az: 1000, bx: -1000, bz: -1000 },
  ]

  function target(id: number, x: number, z: number): HitscanTarget {
    return { id, x, z, radius: 20, alive: true }
  }

  it('mede a distancia ate o circulo pela frente, nao pelo centro', () => {
    const distance = rayCircleDistance(0, 0, 0, -1, 0, -100, 20)
    expect(distance).toBeCloseTo(80, 6)
  })

  it('ignora circulo que esta atras do atirador', () => {
    expect(rayCircleDistance(0, 0, 0, -1, 0, 100, 20)).toBeNull()
  })

  it('acerta o alvo alinhado com a mira', () => {
    const enemy = target(1, 0, -300)
    const result = hitscan(0, 0, 0, 2000, ROOM, [enemy])
    expect(result.target?.id).toBe(1)
  })

  it('erra o alvo que esta fora da linha', () => {
    const enemy = target(1, 400, -300)
    expect(hitscan(0, 0, 0, 2000, ROOM, [enemy]).target).toBeNull()
  })

  it('acerta o mais proximo quando dois estao enfileirados', () => {
    const near = target(1, 0, -200)
    const far = target(2, 0, -600)
    expect(hitscan(0, 0, 0, 2000, ROOM, [far, near]).target?.id).toBe(1)
  })

  it('nao atravessa parede para acertar quem esta atras dela', () => {
    const wall: Wall[] = [...ROOM, { ax: -200, az: -150, bx: 200, bz: -150 }]
    const enemy = target(1, 0, -300)
    expect(hitscan(0, 0, 0, 2000, wall, [enemy]).target).toBeNull()
  })

  it('ignora alvo ja morto', () => {
    const dead = { ...target(1, 0, -300), alive: false }
    expect(hitscan(0, 0, 0, 2000, ROOM, [dead]).target).toBeNull()
  })

  it('para o tiro na parede quando nao ha alvo', () => {
    const result = hitscan(0, 0, 0, 5000, ROOM, [])
    expect(result.target).toBeNull()
    expect(result.distance).toBeCloseTo(1000, 3)
  })

  describe('altura dos obstaculos', () => {
    const enemy = () => target(1, 0, -600)

    it('atira por cima do obstaculo mais baixo que a linha de visao', () => {
      const low: Wall[] = [...ROOM, { ax: -200, az: -300, bx: 200, bz: -300, height: 28 }]
      expect(hitscan(0, 0, 0, 2000, low, [enemy()]).target?.id).toBe(1)
    })

    it('e barrado por obstaculo mais alto que a linha de visao', () => {
      const high: Wall[] = [...ROOM, { ax: -200, az: -300, bx: 200, bz: -300, height: 200 }]
      expect(hitscan(0, 0, 0, 2000, high, [enemy()]).target).toBeNull()
    })

    it('trata parede sem altura declarada como do chao ao teto', () => {
      const solid: Wall[] = [...ROOM, { ax: -200, az: -300, bx: 200, bz: -300 }]
      expect(hitscan(0, 0, 0, 2000, solid, [enemy()]).target).toBeNull()
    })

    it('para o tiro sem alvo na parede alta, ignorando a baixa', () => {
      const mixed: Wall[] = [
        ...ROOM,
        { ax: -400, az: -200, bx: 400, bz: -200, height: 28 },
        { ax: -400, az: -500, bx: 400, bz: -500, height: 300 },
      ]
      const result = hitscan(0, 0, 0, 5000, mixed, [])
      expect(result.distance).toBeCloseTo(500, 3)
    })
  })
})

describe('obstaculo baixo na arena', () => {
  it('nao esconde o inimigo que esta atras dele', () => {
    // Regressao: os blocos nasceram com 64 de altura contra um olho a 41, o
    // que os tornava cobertura total plantada entre o centro e os pontos de
    // nascimento — o jogador no meio da arena nao acertava quase ninguem.
    const arena = createArena()
    const lowWalls = arena.walls.filter((wall) => wall.height !== undefined && wall.height < 64)

    expect(lowWalls.length).toBeGreaterThan(0)
    for (const wall of lowWalls) {
      expect(wall.height!).toBeLessThan(VIEW_HEIGHT)
    }
  })

  it('mantem os pilares altos o bastante para servirem de cobertura', () => {
    const arena = createArena()
    const pillars = arena.boxes.filter((box) => box.height >= arena.wallHeight)

    expect(pillars.length).toBeGreaterThanOrEqual(4)
    for (const pillar of pillars) {
      expect(pillar.height).toBeGreaterThan(VIEW_HEIGHT)
    }
  })
})
