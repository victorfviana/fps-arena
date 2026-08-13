/**
 * Colisao no plano horizontal: um circulo (o jogador ou um inimigo) contra
 * segmentos de parede.
 *
 * O DOOM e 2.5D — colisao acontece em XZ, altura nao participa. Mantemos a
 * mesma simplificacao. Nenhuma dependencia de Three.js aqui de proposito:
 * este modulo roda inteiro sob teste, sem navegador.
 */

export interface Vec2 {
  x: number
  z: number
}

/** Segmento de parede, do ponto A ao ponto B. */
export interface Wall {
  ax: number
  az: number
  bx: number
  bz: number
}

/** Ponto do segmento AB mais proximo de P. */
export function closestPointOnSegment(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): Vec2 {
  const abx = bx - ax
  const abz = bz - az
  const lengthSq = abx * abx + abz * abz

  // Segmento degenerado (A == B): o ponto mais proximo e o proprio A.
  if (lengthSq === 0) return { x: ax, z: az }

  let t = ((px - ax) * abx + (pz - az) * abz) / lengthSq
  t = Math.max(0, Math.min(1, t))

  return { x: ax + t * abx, z: az + t * abz }
}

/**
 * Empurra o circulo para fora de toda parede que ele estiver penetrando.
 *
 * Roda em varias passadas porque resolver uma parede pode empurrar o circulo
 * para dentro de outra — tipico em quina. Poucas passadas bastam; se ainda
 * houver penetracao ao fim, o circulo esta encaixado num vao menor que o
 * proprio diametro e nao ha saida correta.
 */
export function resolvePenetration(
  position: Vec2,
  radius: number,
  walls: readonly Wall[],
  passes = 4,
): Vec2 {
  let { x, z } = position

  for (let pass = 0; pass < passes; pass++) {
    let touched = false

    for (const wall of walls) {
      const closest = closestPointOnSegment(x, z, wall.ax, wall.az, wall.bx, wall.bz)
      let dx = x - closest.x
      let dz = z - closest.z
      let distance = Math.hypot(dx, dz)

      if (distance >= radius) continue

      // Centro exatamente sobre a parede: sem direcao definida para empurrar.
      // Usamos a normal do segmento como desempate.
      if (distance === 0) {
        const nx = -(wall.bz - wall.az)
        const nz = wall.bx - wall.ax
        const nLength = Math.hypot(nx, nz) || 1
        dx = nx / nLength
        dz = nz / nLength
        distance = 0.0001
      } else {
        dx /= distance
        dz /= distance
      }

      const push = radius - distance
      x += dx * push
      z += dz * push
      touched = true
    }

    if (!touched) break
  }

  return { x, z }
}

/**
 * Move o circulo por `delta`, respeitando as paredes, deslizando ao longo
 * delas em vez de parar.
 *
 * O movimento e fatiado em passos menores que o raio. Sem isso, um jogador
 * correndo percorre mais que o proprio diametro num unico tic e atravessa
 * paredes finas sem nunca ocupar o espaco que dispararia a colisao.
 */
export function moveWithCollision(
  position: Vec2,
  delta: Vec2,
  radius: number,
  walls: readonly Wall[],
): Vec2 {
  const distance = Math.hypot(delta.x, delta.z)
  if (distance === 0) return resolvePenetration(position, radius, walls)

  const maxStep = radius * 0.5
  const steps = Math.max(1, Math.ceil(distance / maxStep))
  const stepX = delta.x / steps
  const stepZ = delta.z / steps

  let current: Vec2 = { x: position.x, z: position.z }

  for (let i = 0; i < steps; i++) {
    current = resolvePenetration(
      { x: current.x + stepX, z: current.z + stepZ },
      radius,
      walls,
    )
  }

  return current
}

/**
 * Ha linha de visao livre entre dois pontos?
 *
 * Teste de interseccao segmento-a-segmento, usado depois pelo tiro hitscan e
 * pela decisao de ataque dos inimigos.
 */
export function segmentBlocked(
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  walls: readonly Wall[],
): boolean {
  for (const wall of walls) {
    if (segmentsIntersect(fromX, fromZ, toX, toZ, wall.ax, wall.az, wall.bx, wall.bz)) {
      return true
    }
  }
  return false
}

function segmentsIntersect(
  p0x: number, p0z: number, p1x: number, p1z: number,
  q0x: number, q0z: number, q1x: number, q1z: number,
): boolean {
  const rx = p1x - p0x
  const rz = p1z - p0z
  const sx = q1x - q0x
  const sz = q1z - q0z

  const denominator = rx * sz - rz * sx
  // Paralelos ou colineares: tratados como sem interseccao. Um tiro rasante
  // exatamente paralelo a parede passa — e o comportamento desejado.
  if (denominator === 0) return false

  const t = ((q0x - p0x) * sz - (q0z - p0z) * sx) / denominator
  const u = ((q0x - p0x) * rz - (q0z - p0z) * rx) / denominator

  return t >= 0 && t <= 1 && u >= 0 && u <= 1
}
