import { describe, it, expect } from 'vitest'
import {
  closestPointOnSegment,
  moveWithCollision,
  resolvePenetration,
  segmentBlocked,
  type Wall,
} from '../src/world/collision'

/** Sala quadrada de 512x512 unidades, centrada na origem. */
const ROOM: Wall[] = [
  { ax: -256, az: -256, bx: 256, bz: -256 },
  { ax: 256, az: -256, bx: 256, bz: 256 },
  { ax: 256, az: 256, bx: -256, bz: 256 },
  { ax: -256, az: 256, bx: -256, bz: -256 },
]

const RADIUS = 16

describe('closestPointOnSegment', () => {
  it('projeta na perpendicular quando o ponto esta ao lado do segmento', () => {
    const result = closestPointOnSegment(50, 10, 0, 0, 100, 0)
    expect(result).toEqual({ x: 50, z: 0 })
  })

  it('grampeia na extremidade quando a projecao cai fora do segmento', () => {
    expect(closestPointOnSegment(-50, 0, 0, 0, 100, 0)).toEqual({ x: 0, z: 0 })
    expect(closestPointOnSegment(500, 0, 0, 0, 100, 0)).toEqual({ x: 100, z: 0 })
  })

  it('nao divide por zero em segmento degenerado', () => {
    const result = closestPointOnSegment(10, 10, 7, 7, 7, 7)
    expect(result).toEqual({ x: 7, z: 7 })
  })
})

describe('resolvePenetration', () => {
  it('deixa em paz quem nao encosta em nada', () => {
    const result = resolvePenetration({ x: 0, z: 0 }, RADIUS, ROOM)
    expect(result).toEqual({ x: 0, z: 0 })
  })

  it('empurra para fora ate ficar exatamente encostado na parede', () => {
    const result = resolvePenetration({ x: 0, z: 250 }, RADIUS, ROOM)
    expect(result.z).toBeCloseTo(256 - RADIUS, 5)
  })

  it('resolve quina sem deixar penetracao residual em nenhuma das paredes', () => {
    const result = resolvePenetration({ x: 250, z: 250 }, RADIUS, ROOM)
    expect(result.x).toBeCloseTo(240, 5)
    expect(result.z).toBeCloseTo(240, 5)
  })
})

describe('moveWithCollision', () => {
  it('move livremente quando nao ha obstaculo no caminho', () => {
    const result = moveWithCollision({ x: 0, z: 0 }, { x: 10, z: 5 }, RADIUS, ROOM)
    expect(result.x).toBeCloseTo(10, 5)
    expect(result.z).toBeCloseTo(5, 5)
  })

  it('nao atravessa a parede num passo maior que o proprio diametro', () => {
    // 400 unidades num tic e mais que o dobro do diametro do jogador: e aqui
    // que uma implementacao sem subpassos deixa o jogador vazar para fora.
    const result = moveWithCollision({ x: 0, z: 0 }, { x: 0, z: 400 }, RADIUS, ROOM)
    expect(result.z).toBeLessThanOrEqual(256 - RADIUS + 0.001)
  })

  it('desliza ao longo da parede em vez de travar na diagonal', () => {
    // Encostado na parede norte, empurrando para a frente e para o lado:
    // o componente bloqueado some, o componente livre sobrevive.
    const start = { x: 0, z: 240 }
    const result = moveWithCollision(start, { x: 30, z: 30 }, RADIUS, ROOM)

    expect(result.x).toBeCloseTo(30, 1)
    expect(result.z).toBeLessThanOrEqual(240.001)
  })

  it('mantem o jogador dentro da sala em uma corrida longa e erratica', () => {
    let position = { x: 0, z: 0 }

    // Sequencia deterministica de empurroes fortes em todas as direcoes.
    for (let i = 0; i < 500; i++) {
      const angle = (i * 2.399963) % (Math.PI * 2)
      position = moveWithCollision(
        position,
        { x: Math.cos(angle) * 60, z: Math.sin(angle) * 60 },
        RADIUS,
        ROOM,
      )

      expect(Math.abs(position.x)).toBeLessThanOrEqual(256 - RADIUS + 0.01)
      expect(Math.abs(position.z)).toBeLessThanOrEqual(256 - RADIUS + 0.01)
    }
  })
})

describe('segmentBlocked', () => {
  it('nao encontra obstaculo entre dois pontos internos', () => {
    expect(segmentBlocked(-100, -100, 100, 100, ROOM)).toBe(false)
  })

  it('encontra obstaculo quando a linha sai da sala', () => {
    expect(segmentBlocked(0, 0, 0, 500, ROOM)).toBe(true)
  })
})
