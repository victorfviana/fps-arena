/**
 * Tiro instantaneo.
 *
 * O DOOM nao simula projetil para pistola e escopeta: tracaria uma linha e
 * resolve o acerto no mesmo instante. Reproduzimos isso, e a consequencia para
 * a sensacao de jogo e direta — nao ha tempo de voo para o jogador compensar,
 * o que faz o tiro parecer imediato mesmo com cadencia baixa.
 *
 * Modulo puro: nenhuma dependencia de Three.js, tudo verificavel sob teste.
 */

import { blocksSight, segmentBlocked, type Wall } from '../world/collision'
import { VIEW_HEIGHT } from '../core/doom'

/**
 * Altura em que o tiro viaja.
 *
 * O DOOM resolve o tiro no plano, com mira vertical automatica: olhar para
 * cima ou para baixo nao muda o acerto. Mantemos isso — mas o raio ainda tem
 * uma altura, e e ela que decide se um obstaculo baixo atrapalha.
 */
export const SHOT_HEIGHT = VIEW_HEIGHT

export interface HitscanTarget {
  id: number
  x: number
  z: number
  radius: number
  /** Alvo ja morto continua na cena durante a animacao, mas nao recebe tiro. */
  alive: boolean
}

/**
 * Generico no tipo do alvo para nao apagar o que o chamador passou: quem
 * dispara contra inimigos recebe um inimigo de volta, com todos os seus
 * campos, sem precisar de conversao de tipo.
 */
export interface HitscanResult<T extends HitscanTarget = HitscanTarget> {
  target: T | null
  /** Ponto onde o tiro parou: no alvo, na parede ou no limite do alcance. */
  x: number
  z: number
  distance: number
}

/**
 * Menor distancia positiva ao longo do raio em que ele toca o circulo, ou
 * null se nunca toca.
 */
export function rayCircleDistance(
  originX: number,
  originZ: number,
  dirX: number,
  dirZ: number,
  centerX: number,
  centerZ: number,
  radius: number,
): number | null {
  const offsetX = originX - centerX
  const offsetZ = originZ - centerZ

  // Direcao e unitaria, entao o termo quadratico vale 1.
  const b = 2 * (offsetX * dirX + offsetZ * dirZ)
  const c = offsetX * offsetX + offsetZ * offsetZ - radius * radius

  const discriminant = b * b - 4 * c
  if (discriminant < 0) return null

  const root = Math.sqrt(discriminant)
  const near = (-b - root) / 2
  const far = (-b + root) / 2

  if (near >= 0) return near
  // Origem dentro do circulo: o tiro sai de dentro do alvo e acerta.
  if (far >= 0) return 0

  return null
}

/**
 * Dispara um raio e devolve o primeiro alvo atingido.
 *
 * A ordem importa: encontramos o alvo mais proximo primeiro e so entao
 * checamos se ha parede no caminho. Checar parede antes, contra o alcance
 * inteiro, faria o tiro atravessar inimigos que estao na frente da parede.
 */
export function hitscan<T extends HitscanTarget>(
  originX: number,
  originZ: number,
  angle: number,
  range: number,
  walls: readonly Wall[],
  targets: readonly T[],
): HitscanResult<T> {
  const dirX = -Math.sin(angle)
  const dirZ = -Math.cos(angle)

  let closest: T | null = null
  let closestDistance = range

  for (const target of targets) {
    if (!target.alive) continue

    const distance = rayCircleDistance(
      originX, originZ, dirX, dirZ,
      target.x, target.z, target.radius,
    )

    if (distance === null || distance > closestDistance) continue

    closest = target
    closestDistance = distance
  }

  const endX = originX + dirX * closestDistance
  const endZ = originZ + dirZ * closestDistance

  if (closest && !segmentBlocked(originX, originZ, endX, endZ, walls, SHOT_HEIGHT)) {
    return { target: closest, x: endX, z: endZ, distance: closestDistance }
  }

  // Sem alvo, ou alvo atras de parede: o tiro para onde a geometria mandar.
  const wallDistance = distanceToWall(originX, originZ, dirX, dirZ, range, walls)
  return {
    target: null,
    x: originX + dirX * wallDistance,
    z: originZ + dirZ * wallDistance,
    distance: wallDistance,
  }
}

/** Distancia ate a primeira parede no caminho, ou o alcance maximo. */
function distanceToWall(
  originX: number,
  originZ: number,
  dirX: number,
  dirZ: number,
  range: number,
  walls: readonly Wall[],
): number {
  let nearest = range

  for (const wall of walls) {
    if (!blocksSight(wall, SHOT_HEIGHT)) continue

    const segmentX = wall.bx - wall.ax
    const segmentZ = wall.bz - wall.az

    const denominator = dirX * segmentZ - dirZ * segmentX
    if (denominator === 0) continue // paralelo

    const deltaX = wall.ax - originX
    const deltaZ = wall.az - originZ

    const t = (deltaX * segmentZ - deltaZ * segmentX) / denominator
    const u = (deltaX * dirZ - deltaZ * dirX) / denominator

    if (t >= 0 && t < nearest && u >= 0 && u <= 1) nearest = t
  }

  return nearest
}
