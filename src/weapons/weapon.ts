/**
 * Maquina de estados da arma, em tics.
 *
 * O DOOM separa duas coisas que e tentador juntar: o atraso ate o dano sair
 * (`delayTics`) e o tempo ate poder atirar de novo (`cycleTics`). Sao os dois
 * numeros que a rubrica de feedback de tiro le — o primeiro define se o tiro
 * parece imediato, o segundo define o ritmo do combate.
 */

import { WEAPONS } from '../core/doom'
import type { Random } from '../core/random'
import { LOADOUT } from './loadout'

/**
 * Catalogo de disparo.
 *
 * Junta o que veio do source do DOOM (`WEAPONS`) com o arsenal de design
 * (`LOADOUT`). A procedencia de cada numero continua registrada na origem; aqui
 * so importa o que a maquina de estados precisa para contar tics.
 */
const CATALOG = { ...WEAPONS, ...LOADOUT }

export type WeaponId = keyof typeof CATALOG

export interface WeaponDefinition {
  cycleTics: number
  delayTics: number
  pellets: number
  damage: { multiplier: number; faces: number }
  spreadDeg: number
}

export interface WeaponState {
  id: WeaponId
  definition: WeaponDefinition
  /** Tics ate a arma aceitar outro disparo. */
  cooldownTics: number
  /** Tics ate o dano deste disparo sair. Negativo quando nao ha tiro em voo. */
  fuseTics: number
  ammo: number
}

/** Um projetil resolvido: angulo ja com dispersao e dano ja sorteado. */
export interface Pellet {
  angleOffset: number
  damage: number
}

/** Emitido no tic em que o dano sai — nao no tic em que o gatilho e apertado. */
export interface FireEvent {
  weapon: WeaponId
  pellets: Pellet[]
}

export function createWeapon(id: WeaponId, ammo = Infinity): WeaponState {
  return {
    id,
    definition: CATALOG[id],
    cooldownTics: 0,
    fuseTics: -1,
    ammo,
  }
}

/** A arma esta pronta para disparar agora? */
export function canFire(weapon: WeaponState): boolean {
  return weapon.cooldownTics <= 0 && weapon.fuseTics < 0 && weapon.ammo > 0
}

/**
 * Avanca a arma um tic.
 *
 * A ordem e deliberada: primeiro resolvemos o disparo pendente, depois
 * decrementamos o tempo de recarga, e so entao aceitamos um gatilho novo.
 * Resolver o gatilho antes faria uma arma de `delayTics` zero disparar duas
 * vezes no mesmo tic.
 *
 * @returns o evento de dano, se ele sai neste tic.
 */
export function tickWeapon(
  weapon: WeaponState,
  wantsFire: boolean,
  random: Random,
): FireEvent | null {
  let event: FireEvent | null = null

  // Decrementa e checa no mesmo tic. Separar as duas coisas custa um tic extra
  // de atraso — 28,6 ms que ninguem consegue apontar de onde vem, mas que o
  // jogador sente como um tiro que responde tarde.
  if (weapon.fuseTics > 0) {
    weapon.fuseTics--
    if (weapon.fuseTics === 0) {
      event = resolveShot(weapon, random)
      weapon.fuseTics = -1
    }
  }

  if (weapon.cooldownTics > 0) weapon.cooldownTics--

  if (wantsFire && canFire(weapon)) {
    weapon.ammo--
    weapon.cooldownTics = weapon.definition.cycleTics

    if (weapon.definition.delayTics === 0) {
      // Arma sem atraso resolve no mesmo tic do gatilho; nao ha o que esperar.
      event = resolveShot(weapon, random)
    } else {
      weapon.fuseTics = weapon.definition.delayTics
    }
  }

  return event
}

function resolveShot(weapon: WeaponState, random: Random): FireEvent {
  const { pellets, spreadDeg, damage } = weapon.definition
  const spreadRad = (spreadDeg * Math.PI) / 180

  const shots: Pellet[] = []
  for (let i = 0; i < pellets; i++) {
    shots.push({
      // Dispersao so na horizontal, como no original.
      angleOffset: spreadRad === 0 ? 0 : random.signed() * spreadRad,
      damage: damage.multiplier * (random.int(damage.faces) + 1),
    })
  }

  return { weapon: weapon.id, pellets: shots }
}

/** Dano medio por disparo, para calibrar a vida dos inimigos e as ondas. */
export function averageDamagePerShot(definition: WeaponDefinition): number {
  const { multiplier, faces } = definition.damage
  const averageRoll = (faces + 1) / 2
  return definition.pellets * multiplier * averageRoll
}
