/**
 * Trava das constantes do benchmark.
 *
 * Nao testa "o jogo esta bom" — testa que as derivacoes feitas a partir do
 * source do DOOM continuam batendo com valores conhecidos de forma
 * independente. Se alguem mexer numa constante sem entender a cadeia, isto
 * quebra antes de virar sensacao errada no jogo.
 */
import { describe, it, expect } from 'vitest'
import {
  TICRATE,
  TIC_MS,
  FRICTION,
  FORWARD_MOVE,
  SIDE_MOVE,
  MAX_MOVE,
  TERMINAL_SPEED,
  TURN_DEG_PER_TIC,
  MAX_BOB,
  BOB_AMPLITUDE,
  ENEMIES,
  chaseSpeed,
  perTicToPerSecond,
  terminalSpeed,
  thrustToAcceleration,
} from '../src/core/doom'

describe('tempo', () => {
  it('roda a 35 tics por segundo', () => {
    expect(TICRATE).toBe(35)
    expect(TIC_MS).toBeCloseTo(28.571, 3)
  })
})

describe('friccao', () => {
  it('vale 0,90625 — o 0xe800 do p_mobj.c sobre FRACUNIT', () => {
    expect(FRICTION).toBeCloseTo(0.90625, 10)
  })
})

describe('empuxo do movimento', () => {
  it('converte forwardmove em aceleracao dividindo por 32', () => {
    // move * 2048 / 65536 === move / 32
    expect(thrustToAcceleration(FORWARD_MOVE.run)).toBeCloseTo(50 / 32, 10)
    expect(thrustToAcceleration(FORWARD_MOVE.run)).toBeCloseTo(1.5625, 10)
    expect(thrustToAcceleration(FORWARD_MOVE.walk)).toBeCloseTo(0.78125, 10)
  })
})

describe('velocidade terminal', () => {
  it('reproduz a velocidade de corrida consagrada do DOOM, 583 u/s', () => {
    expect(TERMINAL_SPEED.forwardRun).toBeCloseTo(16.6667, 3)
    expect(perTicToPerSecond(TERMINAL_SPEED.forwardRun)).toBeCloseTo(583.33, 1)
  })

  it('anda a metade da velocidade de corrida', () => {
    expect(perTicToPerSecond(TERMINAL_SPEED.forwardWalk)).toBeCloseTo(291.67, 1)
    expect(TERMINAL_SPEED.forwardWalk * 2).toBeCloseTo(TERMINAL_SPEED.forwardRun, 6)
  })

  it('deixa o strafe mais lento que a corrida para a frente', () => {
    expect(TERMINAL_SPEED.sideRun).toBeLessThan(TERMINAL_SPEED.forwardRun)
    expect(perTicToPerSecond(TERMINAL_SPEED.sideRun)).toBeCloseTo(466.67, 1)
    expect(perTicToPerSecond(TERMINAL_SPEED.sideWalk)).toBeCloseTo(280, 1)
  })

  it('fica abaixo de MAXMOVE, que so entra com empurrao externo', () => {
    expect(TERMINAL_SPEED.forwardRun).toBeLessThan(MAX_MOVE)
  })

  it('emerge da simulacao tic a tic, e nao so da formula fechada', () => {
    // A prova que importa: rodar a fisica de verdade e ver onde ela estabiliza.
    const a = thrustToAcceleration(FORWARD_MOVE.run)
    let momentum = 0
    let travelled = 0

    for (let tic = 0; tic < 400; tic++) {
      momentum += a
      travelled = momentum // deslocamento deste tic, antes da friccao
      momentum *= FRICTION
    }

    expect(travelled).toBeCloseTo(TERMINAL_SPEED.forwardRun, 6)
  })

  it('reage no primeiro tic, sem atraso de partida', () => {
    // Responsividade e inegociavel na rubrica: o movimento comeca no mesmo
    // tic do input. A rampa e de velocidade, nao de latencia.
    const a = thrustToAcceleration(FORWARD_MOVE.run)
    expect(a).toBeGreaterThan(0)
    expect(a / TERMINAL_SPEED.forwardRun).toBeCloseTo(1 - FRICTION, 6)
  })

  /**
   * A rampa de aceleracao do DOOM e longa: 24 tics, quase 700 ms, ate 90% da
   * velocidade de corrida. Isso contraria a intuicao de que o jogo e "rapido
   * desde o primeiro quadro" — o que e imediato e a RESPOSTA, nao o topo da
   * velocidade. Os dois numeros ficam travados aqui porque sao justamente o
   * que separa um movimento que parece firme de um que parece patinar.
   */
  it('leva 24 tics para 90% da velocidade — a rampa real do original', () => {
    const a = thrustToAcceleration(FORWARD_MOVE.run)
    let momentum = 0
    let ticsTo90 = -1

    for (let tic = 0; tic < 200; tic++) {
      momentum += a
      if (ticsTo90 < 0 && momentum >= TERMINAL_SPEED.forwardRun * 0.9) ticsTo90 = tic + 1
      momentum *= FRICTION
    }

    expect(ticsTo90).toBe(24)
    expect(ticsTo90 * TIC_MS).toBeCloseTo(685.7, 1)
  })

  it('cobre dois tercos da velocidade em cerca de 10 tics', () => {
    // Constante de tempo da rampa: e o trecho que o jogador realmente sente,
    // porque quase todo deslocamento em combate dura menos de meio segundo.
    const a = thrustToAcceleration(FORWARD_MOVE.run)
    let momentum = 0
    let ticsTo63 = -1

    for (let tic = 0; tic < 200; tic++) {
      momentum += a
      if (ticsTo63 < 0 && momentum >= TERMINAL_SPEED.forwardRun * 0.632) ticsTo63 = tic + 1
      momentum *= FRICTION
    }

    expect(ticsTo63).toBeGreaterThan(0)
    expect(ticsTo63 * TIC_MS).toBeLessThan(350)
  })

  it('para em poucos tics quando o jogador solta o controle', () => {
    // Tempo de parada e metade da sensacao de peso. Longo demais vira gelo.
    let momentum = TERMINAL_SPEED.forwardRun
    let ticsToStop = 0

    while (momentum > 0.0625 && ticsToStop < 200) {
      momentum *= FRICTION
      ticsToStop++
    }

    expect(ticsToStop).toBeLessThan(60)
    expect(ticsToStop * TIC_MS).toBeLessThan(1700)
  })
})

describe('rotacao por teclado', () => {
  it('converte BAM para graus pela razao com 2^16', () => {
    expect(TURN_DEG_PER_TIC.normal).toBeCloseTo(3.5156, 3)
    expect(TURN_DEG_PER_TIC.fast).toBeCloseTo(7.0313, 3)
    expect(TURN_DEG_PER_TIC.slow).toBeCloseTo(1.7578, 3)
  })

  it('mantem a proporcao 1:2:4 entre lento, normal e rapido', () => {
    expect(TURN_DEG_PER_TIC.normal / TURN_DEG_PER_TIC.slow).toBeCloseTo(2, 6)
    expect(TURN_DEG_PER_TIC.fast / TURN_DEG_PER_TIC.normal).toBeCloseTo(2, 6)
  })
})

describe('view bob', () => {
  it('tem teto de 16 unidades e amplitude efetiva de 8', () => {
    expect(MAX_BOB).toBe(16)
    expect(BOB_AMPLITUDE).toBe(8)
  })
})

describe('inimigos', () => {
  it('persegue a 2 unidades por tic, ou 70 por segundo', () => {
    const speed = chaseSpeed(ENEMIES.zombieman)
    expect(speed).toBeCloseTo(2, 6)
    expect(perTicToPerSecond(speed)).toBeCloseTo(70, 6)
  })

  it('deixa o inimigo bem mais lento que o jogador correndo', () => {
    // Se essa relacao inverter, a arena vira perseguicao impossivel.
    expect(chaseSpeed(ENEMIES.zombieman)).toBeLessThan(TERMINAL_SPEED.forwardRun / 4)
  })

  it('da ao imp o triplo da vida do zombieman', () => {
    expect(ENEMIES.imp.health).toBe(60)
    expect(ENEMIES.zombieman.health).toBe(20)
  })

  it('mantem o estado de dor curto o bastante para nao travar o combate', () => {
    expect(ENEMIES.zombieman.painTics * TIC_MS).toBeLessThan(250)
    expect(ENEMIES.imp.painTics * TIC_MS).toBeLessThan(250)
  })
})

describe('coerencia geral', () => {
  it('nao deixa nenhuma velocidade derivada virar NaN ou negativa', () => {
    for (const move of [FORWARD_MOVE.walk, FORWARD_MOVE.run, SIDE_MOVE.walk, SIDE_MOVE.run]) {
      const v = terminalSpeed(move)
      expect(Number.isFinite(v)).toBe(true)
      expect(v).toBeGreaterThan(0)
    }
  })
})
