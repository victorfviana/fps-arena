import { describe, it, expect } from 'vitest'
import { FixedTimestepLoop } from '../src/core/loop'

const TICK_RATE = 35
const TICK_MS = 1000 / TICK_RATE

function makeLoop(maxTicksPerFrame?: number) {
  const ticks: number[] = []
  const alphas: number[] = []

  const loop = new FixedTimestepLoop({
    tickRateHz: TICK_RATE,
    maxTicksPerFrame,
    onTick: () => ticks.push(1),
    onRender: (alpha) => alphas.push(alpha),
  })

  return { loop, ticks, alphas }
}

describe('FixedTimestepLoop', () => {
  it('roda exatamente um tic por intervalo de tic', () => {
    const { loop, ticks } = makeLoop()
    loop.advance(TICK_MS)
    expect(ticks).toHaveLength(1)
  })

  it('nao roda tic nenhum antes de completar o intervalo', () => {
    const { loop, ticks } = makeLoop()
    loop.advance(TICK_MS * 0.9)
    expect(ticks).toHaveLength(0)
  })

  it('acumula fracoes ate fechar um tic', () => {
    const { loop, ticks } = makeLoop()
    loop.advance(TICK_MS * 0.6)
    loop.advance(TICK_MS * 0.6)
    expect(ticks).toHaveLength(1)
  })

  it('mantem a taxa de simulacao independente do framerate do desenho', () => {
    // Um segundo de tempo real precisa render 35 tics, seja a 30 ou a 240 fps.
    for (const fps of [30, 60, 144, 240]) {
      const { loop, ticks } = makeLoop(64)
      for (let frame = 0; frame < fps; frame++) loop.advance(1000 / fps)

      // Tolerancia de um tic, pela fracao que sobra no acumulador.
      expect(Math.abs(ticks.length - TICK_RATE)).toBeLessThanOrEqual(1)
    }
  })

  it('desenha uma vez por frame, mesmo em frame sem tic', () => {
    const { loop, alphas } = makeLoop()
    loop.advance(1)
    loop.advance(1)
    expect(alphas).toHaveLength(2)
  })

  it('entrega alpha entre 0 e 1 para a interpolacao', () => {
    const { loop, alphas } = makeLoop()
    loop.advance(TICK_MS * 1.5)
    expect(alphas[0]).toBeGreaterThanOrEqual(0)
    expect(alphas[0]).toBeLessThan(1)
    expect(alphas[0]).toBeCloseTo(0.5, 5)
  })

  it('descarta o excedente em vez de travar depois de uma pausa longa', () => {
    const { loop, ticks } = makeLoop(8)
    loop.advance(10_000) // dez segundos de aba suspensa

    expect(ticks).toHaveLength(8)
    expect(loop.droppedTicks).toBeGreaterThan(0)
  })

  it('nao deixa o acumulador crescer sem limite entre frames', () => {
    const { loop, ticks } = makeLoop(8)
    loop.advance(10_000)
    ticks.length = 0

    // O frame seguinte, ja em ritmo normal, volta a rodar um unico tic.
    loop.advance(TICK_MS)
    expect(ticks).toHaveLength(1)
  })

  it('trata delta invalido como zero em vez de contaminar a fisica', () => {
    const { loop, ticks } = makeLoop()
    loop.advance(Number.NaN)
    loop.advance(-500)
    expect(ticks).toHaveLength(0)
  })

  it('recusa taxa de tic invalida', () => {
    expect(() => new FixedTimestepLoop({
      tickRateHz: 0,
      onTick: () => {},
      onRender: () => {},
    })).toThrow()
  })
})
