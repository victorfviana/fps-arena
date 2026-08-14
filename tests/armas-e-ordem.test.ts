/**
 * Regressao de dois bugs e duas invariantes de acoplamento entre modulos.
 *
 * Nao repete o que `tests/game.test.ts` ja cobre (curva de onda, sobrevivencia,
 * limites da arena). Aqui o alvo e mais estreito: o estado da arma sobrevive a
 * troca, a guarda do fuse recusa a troca no momento errado, a separacao entre
 * inimigos nao depende da ordem do array, e duas constantes que precisam ficar
 * coerentes entre si (pose de ataque vs cooldown, balanco da camera vs altura
 * dos obstaculos) continuam coerentes.
 */
import { describe, it, expect } from 'vitest'
import { Game } from '../src/game'
import {
  ATTACK_POSE_TICS,
  BEHAVIOUR,
  createEnemy,
  resetEnemyIds,
} from '../src/enemies/enemy'
import { createAimState, requestSwap } from '../src/weapons/aiming'
import { createWeapon } from '../src/weapons/weapon'
import { BOB_AMPLITUDE } from '../src/core/doom'
import { createArena } from '../src/world/arena'
import { SHOT_HEIGHT } from '../src/weapons/hitscan'
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

describe('cooldown de arma sobrevive a troca', () => {
  it('preserva o cooldown da escopeta atraves de uma troca e volta (regressao do exploit)', () => {
    // A versao anterior recriava o WeaponState a cada troca: sacar a escopeta
    // de volta apos um round-trip rapido devolvia o cooldown a zero,
    // driblando o cycleTics de 44 tics. Este teste dispara, troca para o
    // rifle e volta o mais cedo que as regras permitem, contando os tics
    // reais decorridos — o cooldown ao voltar tem de refletir exatamente esse
    // tempo, nunca zero.
    const game = newGame()

    game.tick(command({ fire: true }))
    let elapsed = 1
    expect(game.weapon.id).toBe('shotgun')
    // tickWeapon decrementa o cooldown ANTES de aceitar o gatilho: no proprio
    // tic do disparo o cooldown vai direto para cycleTics (44), sem decrementar
    // ainda. Cada tic seguinte tira 1: cooldown = 44 - (elapsed - 1).
    expect(game.weapon.cooldownTics).toBe(44 - (elapsed - 1))

    // A guarda do fuse recusa a troca enquanto o dano do disparo ainda nao
    // saiu; espera o disparo resolver antes de pedir.
    while (game.weapon.fuseTics >= 0) {
      game.tick(command())
      elapsed++
    }

    game.tick(command({ switchTo: 'rifle' }))
    elapsed++
    expect(game.aim.pending === 'rifle' || game.aim.current === 'rifle').toBe(true)

    // Espera a troca terminar para poder trocar de volta.
    while (game.aim.swapTics > 0 || game.aim.pending !== null) {
      game.tick(command())
      elapsed++
    }
    expect(game.aim.current).toBe('rifle')

    game.tick(command({ switchTo: 'shotgun' }))
    elapsed++
    while (game.aim.swapTics > 0 || game.aim.pending !== null) {
      game.tick(command())
      elapsed++
    }
    expect(game.aim.current).toBe('shotgun')

    const expectedCooldown = Math.max(0, 44 - (elapsed - 1))
    expect(game.weapon.cooldownTics).toBe(expectedCooldown)
    // O exploit historico zerava o cooldown a cada troca. cycleTics (44)
    // ainda nao se passou nesse round-trip, entao tem de sobrar cooldown.
    expect(game.weapon.cooldownTics).toBeGreaterThan(0)
  })
})

describe('guarda do fuse na troca', () => {
  it('recusa a troca com fuseTics pendente e libera assim que o disparo resolve', () => {
    const weapon = createWeapon('shotgun')
    const aim = createAimState('shotgun')

    weapon.fuseTics = 2 // disparo em voo, dano ainda nao saiu
    expect(requestSwap(aim, 'rifle', weapon)).toBe(false)
    expect(aim.pending).toBeNull()

    weapon.fuseTics = -1 // resolvido
    expect(requestSwap(aim, 'rifle', weapon)).toBe(true)
    expect(aim.pending).toBe('rifle')
  })
})

describe('acoplamento pose de ataque / cooldown de ataque', () => {
  it('ATTACK_POSE_TICS e menor que o cooldown de ataque de qualquer inimigo', () => {
    // Se a pose durasse mais que o proprio cooldown, o inimigo voltaria a
    // atacar antes de terminar de mostrar que atacou.
    const cooldowns = Object.values(BEHAVIOUR).map((behaviour) => behaviour.attackCooldownTics)
    expect(ATTACK_POSE_TICS).toBeLessThan(Math.min(...cooldowns))
  })
})

describe('separacao entre inimigos independe da ordem', () => {
  it('duas posicoes finais iguais, processando o array em ordem [A,B] e [B,A]', () => {
    // Distancia do jogador (start em 0,0) maior que o attackRange (900) dos
    // dois tipos, para cair no ramo de perseguicao (advance -> separacao) e
    // nao no de ataque, que nao mexe em posicao.
    function scenario(order: 'ab' | 'ba') {
      const game = newGame()
      const a = createEnemy('zombieman', -990, 0)
      const b = createEnemy('zombieman', -970, 0) // raio 20+20=40 > distancia 20: sobrepostos

      if (order === 'ab') game.enemies.push(a, b)
      else game.enemies.push(b, a)

      game.tick(command())
      return { a, b }
    }

    const ab = scenario('ab')
    const ba = scenario('ba')

    expect(ab.a.x).toBeCloseTo(ba.a.x)
    expect(ab.a.z).toBeCloseTo(ba.a.z)
    expect(ab.b.x).toBeCloseTo(ba.b.x)
    expect(ab.b.z).toBeCloseTo(ba.b.z)
  })
})

describe('acoplamento view bob / geometria da arena', () => {
  it('nenhum obstaculo da arena cai na faixa de altura que o balanco da camera atravessa', () => {
    // A simulacao mira numa altura fixa (SHOT_HEIGHT), mas a camera balanca
    // +-BOB_AMPLITUDE. Um obstaculo cuja altura caia dentro dessa faixa faria
    // o visual (o que a camera mostra, balancando) divergir da regra de
    // acerto (que nao balanca).
    const arena = createArena()
    const low = SHOT_HEIGHT - BOB_AMPLITUDE
    const high = SHOT_HEIGHT + BOB_AMPLITUDE

    for (const box of arena.boxes) {
      const dentroDaFaixa = box.height > low && box.height < high
      expect(dentroDaFaixa).toBe(false)
    }
  })
})
