/**
 * Arsenal do jogador.
 *
 * FORA DO BENCHMARK, e isso e declarado de proposito. As constantes da
 * escopeta vieram do source do DOOM e continuam citadas em `core/doom.ts`. Ja
 * o rifle e a mira apontada (ADS) nao existem no DOOM de 1993 — sao camadas
 * modernas escolhidas a pedido, e seus numeros sao decisao de design, nao
 * fidelidade a artefato nenhum. Misturar as duas origens sem avisar seria o
 * mesmo erro que a regra de procedencia do projeto existe para impedir.
 *
 * A base de movimento segue a do DOOM: rapida e sem inercia falsa. O ADS
 * apenas pesa o passo enquanto esta ativo, em vez de trocar o modelo inteiro
 * de locomocao.
 */

import { TICRATE, WEAPONS as DOOM_WEAPONS } from '../core/doom'

export type LoadoutId = 'shotgun' | 'rifle'

/** Comportamento da arma com a mira apontada. */
export interface AdsProfile {
  /** Campo de visao horizontal enquanto apontado, em graus. */
  fovDeg: number
  /** Dispersao com a mira apontada, em graus. */
  spreadDeg: number
  /** Multiplicador da velocidade do jogador enquanto aponta. */
  moveScale: number
  /** Tics para entrar e sair da mira. */
  transitionTics: number
  /** Usa luneta com sobreposicao na tela, em vez de so alinhar a alca. */
  scoped: boolean
}

export interface LoadoutWeapon {
  id: LoadoutId
  /** Nome exibido no painel. */
  label: string
  cycleTics: number
  delayTics: number
  pellets: number
  damage: { multiplier: number; faces: number }
  /** Dispersao com a arma na altura do quadril, em graus. */
  spreadDeg: number
  ads: AdsProfile
  /** Forca do coice na camera, em graus por disparo. */
  recoilDeg: number
}

export const LOADOUT: Record<LoadoutId, LoadoutWeapon> = {
  /**
   * Escopeta: os numeros de cadencia, atraso, chumbos e dano seguem o DOOM.
   * Apontar nao aproxima nada — apenas fecha a dispersao, que e o unico ganho
   * honesto que uma escopeta oferece.
   */
  shotgun: {
    id: 'shotgun',
    label: 'escopeta',
    cycleTics: DOOM_WEAPONS.shotgun.cycleTics,
    delayTics: DOOM_WEAPONS.shotgun.delayTics,
    pellets: DOOM_WEAPONS.shotgun.pellets,
    damage: DOOM_WEAPONS.shotgun.damage,
    spreadDeg: DOOM_WEAPONS.shotgun.spreadDeg,
    ads: {
      fovDeg: 70,
      spreadDeg: 2.4,
      moveScale: 0.72,
      transitionTics: 5,
      scoped: false,
    },
    recoilDeg: 2.6,
  },

  /**
   * Rifle com luneta. Tudo aqui e escolha de design.
   *
   * A relacao que importa: no quadril ele e impreciso a ponto de nao competir
   * com a escopeta de perto; apontado, e cirurgico e alcanca o outro lado da
   * arena. Sem esse contraste a luneta viraria enfeite, e as duas armas
   * ocupariam o mesmo papel.
   */
  rifle: {
    id: 'rifle',
    label: 'rifle',
    cycleTics: 21,
    delayTics: 2,
    pellets: 1,
    damage: { multiplier: 12, faces: 3 },
    spreadDeg: 3.4,
    ads: {
      fovDeg: 26,
      spreadDeg: 0.12,
      moveScale: 0.45,
      transitionTics: 8,
      scoped: true,
    },
    recoilDeg: 1.4,
  },
}

export const LOADOUT_ORDER: LoadoutId[] = ['shotgun', 'rifle']

/** Dispersao efetiva, interpolada durante a transicao da mira. */
export function effectiveSpread(weapon: LoadoutWeapon, adsProgress: number): number {
  return weapon.spreadDeg + (weapon.ads.spreadDeg - weapon.spreadDeg) * adsProgress
}

/** Campo de visao efetivo, interpolado durante a transicao. */
export function effectiveFov(
  weapon: LoadoutWeapon,
  adsProgress: number,
  hipFovDeg: number,
): number {
  return hipFovDeg + (weapon.ads.fovDeg - hipFovDeg) * adsProgress
}

/** Multiplicador de velocidade do jogador, interpolado. */
export function effectiveMoveScale(weapon: LoadoutWeapon, adsProgress: number): number {
  return 1 + (weapon.ads.moveScale - 1) * adsProgress
}

/**
 * Passo da transicao da mira, por tic.
 *
 * Entrar e sair levam o mesmo tempo. Sair mais rapido que entrar e comum em
 * jogos comerciais, mas cria uma assimetria que confunde quem esta aprendendo
 * o ritmo da arma.
 */
export function adsStep(weapon: LoadoutWeapon): number {
  return 1 / Math.max(1, weapon.ads.transitionTics)
}

/** Dano medio por disparo, para calibrar a vida dos inimigos. */
export function averageDamage(weapon: LoadoutWeapon): number {
  return weapon.pellets * weapon.damage.multiplier * ((weapon.damage.faces + 1) / 2)
}

/** Disparos por segundo, para comparar as armas no painel de diagnostico. */
export function shotsPerSecond(weapon: LoadoutWeapon): number {
  return TICRATE / weapon.cycleTics
}
