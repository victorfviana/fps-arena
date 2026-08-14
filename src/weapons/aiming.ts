/**
 * Mira apontada e troca de arma.
 *
 * Estado puro, avancado por tic, para que o desenho apenas leia `adsProgress`
 * e interpole camera, arma e maos a partir dele. Guardar isso no renderer
 * faria a transicao depender do framerate: a mira fecharia mais rapido num
 * monitor de 144 Hz do que num de 60, e a dispersao junto.
 */

import { LOADOUT, LOADOUT_ORDER, adsStep, type LoadoutId, type LoadoutWeapon } from './loadout'
import type { WeaponState } from './weapon'

/** Tics para guardar uma arma e sacar a outra. */
export const SWAP_TICS = 9

export interface AimState {
  current: LoadoutId
  /** 0 no quadril, 1 totalmente apontado. */
  adsProgress: number
  /** O jogador esta segurando o botao de mirar? */
  wantsAds: boolean
  /** Tics restantes da troca de arma. Zero quando nao ha troca em curso. */
  swapTics: number
  /** Arma que entra quando a troca terminar. */
  pending: LoadoutId | null
}

export function createAimState(start: LoadoutId = 'shotgun'): AimState {
  return {
    current: start,
    adsProgress: 0,
    wantsAds: false,
    swapTics: 0,
    pending: null,
  }
}

export function currentWeapon(aim: AimState): LoadoutWeapon {
  return LOADOUT[aim.current]
}

/** Trocar de arma esta liberado agora? */
export function canSwap(aim: AimState): boolean {
  return aim.swapTics === 0 && aim.pending === null
}

/**
 * Pede a troca para outra arma.
 *
 * Apontado, a troca cancela a mira: sacar outra arma ja mirando seria um
 * atalho que anula o custo de tempo do ADS.
 *
 * Recusa tambem enquanto a arma ativa tem um disparo em voo (`fuseTics >=
 * 0`): o dano ainda nao saiu. Hoje a aritmetica torna isso inalcancavel — a
 * troca mais rapida leva pelo menos 5 tics e o maior `delayTics` do arsenal e
 * 3 — mas nada impedia essa combinacao antes desta guarda, e uma arma nova
 * com `delayTics` maior tornaria isso alcancavel em silencio.
 */
export function requestSwap(aim: AimState, to: LoadoutId, weapon: WeaponState): boolean {
  if (to === aim.current || !canSwap(aim)) return false
  if (weapon.fuseTics >= 0) return false

  aim.pending = to
  aim.swapTics = SWAP_TICS
  aim.wantsAds = false
  return true
}

/** Alterna para a proxima arma do arsenal. */
export function requestNextWeapon(aim: AimState, weapon: WeaponState): boolean {
  const index = LOADOUT_ORDER.indexOf(aim.current)
  const next = LOADOUT_ORDER[(index + 1) % LOADOUT_ORDER.length]!
  return requestSwap(aim, next, weapon)
}

/**
 * Avanca a mira e a troca um tic.
 *
 * Durante a troca a mira e forcada de volta ao quadril, e nao apenas impedida
 * de subir: a arma esta saindo de cena, entao nao ha alca para alinhar.
 */
export function tickAim(aim: AimState, wantsAds: boolean): void {
  if (aim.swapTics > 0) {
    aim.swapTics--
    aim.adsProgress = Math.max(0, aim.adsProgress - adsStep(currentWeapon(aim)) * 2)

    // Metade do tempo guarda a arma antiga; a outra metade saca a nova.
    if (aim.swapTics <= Math.floor(SWAP_TICS / 2) && aim.pending) {
      aim.current = aim.pending
      aim.pending = null
    }
    return
  }

  aim.wantsAds = wantsAds

  const step = adsStep(currentWeapon(aim))
  aim.adsProgress = wantsAds
    ? Math.min(1, aim.adsProgress + step)
    : Math.max(0, aim.adsProgress - step)
}

/** A arma esta trocando agora? Usado pelo desenho e para travar o disparo. */
export function isSwapping(aim: AimState): boolean {
  return aim.swapTics > 0
}

/** Fracao da animacao de troca, de 0 a 1, para o desenho baixar a arma. */
export function swapProgress(aim: AimState): number {
  if (aim.swapTics === 0) return 0
  // Sobe ate 1 no meio da troca e volta a 0 — a arma desce e sobe de novo.
  const decorrido = (SWAP_TICS - aim.swapTics) / SWAP_TICS
  return 1 - Math.abs(decorrido * 2 - 1)
}
