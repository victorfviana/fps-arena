/**
 * Progressao de ondas.
 *
 * Esta dimensao nao tem benchmark: o DOOM nao e um jogo de ondas, entao nao ha
 * numero para copiar. A curva abaixo e escolha de design, e por isso fica
 * fora do loop adversarial — o que da para verificar por teste e que ela
 * cresce sem saltos absurdos e que a pressao simultanea tem teto.
 */

import type { EnemyKind } from '../enemies/enemy'

export interface WaveComposition {
  zombieman: number
  imp: number
}

/** Teto de inimigos vivos ao mesmo tempo. */
export const MAX_CONCURRENT = 14

/**
 * Quantos de cada tipo a onda traz.
 *
 * Cresce pouco a pouco, e a proporcao de imps sobe com o numero da onda: o
 * inicio ensina a mirar de longe, o meio obriga a recuar de quem chega perto.
 */
export function waveComposition(wave: number): WaveComposition {
  const total = Math.min(4 + Math.floor(wave * 1.6), 26)
  const impShare = Math.min(0.15 + wave * 0.06, 0.6)

  const imp = Math.floor(total * impShare)
  return { zombieman: total - imp, imp }
}

/** A fila de nascimento da onda, ja embaralhada por tipo. */
export function waveQueue(wave: number): EnemyKind[] {
  const { zombieman, imp } = waveComposition(wave)
  const queue: EnemyKind[] = []

  // Intercala em vez de agrupar: uma onda que solta oito zumbis e depois oito
  // imps se joga em duas metades sem relacao uma com a outra.
  const total = zombieman + imp
  let remainingZombie = zombieman
  let remainingImp = imp

  for (let i = 0; i < total; i++) {
    const wantImp = remainingImp > 0 && (remainingZombie === 0 || i % 3 === 2)
    if (wantImp) {
      queue.push('imp')
      remainingImp--
    } else {
      queue.push('zombieman')
      remainingZombie--
    }
  }

  return queue
}

/** Intervalo entre nascimentos, em tics. Encurta conforme as ondas avancam. */
export function spawnIntervalTics(wave: number): number {
  return Math.max(12, 40 - wave * 2)
}

/** Pausa entre o fim de uma onda e o inicio da proxima, em tics. */
export const INTERMISSION_TICS = 70
