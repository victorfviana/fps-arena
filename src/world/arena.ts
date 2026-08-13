/**
 * Definicao da arena, em map units do DOOM.
 *
 * Dados puros: geometria logica, paredes de colisao e pontos de nascimento.
 * A construcao das malhas do Three.js fica no modulo de render, para que a
 * arena inteira possa ser verificada sob teste sem navegador.
 */

import { GRID_CELL } from '../core/doom'
import type { Vec2, Wall } from './collision'

/** Caixa alinhada aos eixos: pilar, bloco de cobertura ou parede grossa. */
export interface Box {
  /** Centro no plano horizontal. */
  x: number
  z: number
  /** Extensao total, nao meia-extensao. */
  width: number
  depth: number
  height: number
}

export interface Arena {
  /** Lado da sala, em map units. */
  size: number
  wallHeight: number
  /** Segmentos usados pela colisao — perimetro e obstaculos. */
  walls: Wall[]
  /** Obstaculos, para o render levantar as malhas. */
  boxes: Box[]
  playerStart: { x: number; z: number; yaw: number }
  /** Pontos de nascimento de inimigos, longe do centro. */
  spawnPoints: Vec2[]
}

/** Converte uma caixa nos quatro segmentos do seu perimetro. */
export function boxToWalls(box: Box): Wall[] {
  const halfWidth = box.width / 2
  const halfDepth = box.depth / 2
  const minX = box.x - halfWidth
  const maxX = box.x + halfWidth
  const minZ = box.z - halfDepth
  const maxZ = box.z + halfDepth

  return [
    { ax: minX, az: minZ, bx: maxX, bz: minZ },
    { ax: maxX, az: minZ, bx: maxX, bz: maxZ },
    { ax: maxX, az: maxZ, bx: minX, bz: maxZ },
    { ax: minX, az: maxZ, bx: minX, bz: minZ },
  ]
}

/**
 * Arena padrao: sala quadrada com quatro pilares e dois blocos baixos.
 *
 * O tamanho e multiplo da celula de grid do DOOM (64) de proposito — a escala
 * de referencia atravessa o projeto inteiro, inclusive no level design.
 * Os pilares existem por razao de jogo, nao decorativa: sem nada que quebre a
 * linha de visao, uma arena de ondas vira tiro ao alvo em campo aberto.
 */
export function createArena(): Arena {
  const size = GRID_CELL * 32 // 2048 unidades de lado
  const half = size / 2
  const wallHeight = GRID_CELL * 4 // 256

  const perimeter: Wall[] = [
    { ax: -half, az: -half, bx: half, bz: -half },
    { ax: half, az: -half, bx: half, bz: half },
    { ax: half, az: half, bx: -half, bz: half },
    { ax: -half, az: half, bx: -half, bz: -half },
  ]

  const pillarOffset = GRID_CELL * 8 // 512
  const boxes: Box[] = [
    { x: -pillarOffset, z: -pillarOffset, width: 128, depth: 128, height: wallHeight },
    { x: pillarOffset, z: -pillarOffset, width: 128, depth: 128, height: wallHeight },
    { x: -pillarOffset, z: pillarOffset, width: 128, depth: 128, height: wallHeight },
    { x: pillarOffset, z: pillarOffset, width: 128, depth: 128, height: wallHeight },
    // Blocos baixos: cobertura parcial, sem fechar a leitura do combate.
    { x: 0, z: -GRID_CELL * 5, width: 320, depth: 64, height: 64 },
    { x: 0, z: GRID_CELL * 5, width: 320, depth: 64, height: 64 },
  ]

  const walls = [...perimeter, ...boxes.flatMap(boxToWalls)]

  // Nascimentos nas quinas e no meio de cada parede, afastados do centro para
  // que nenhum inimigo apareca em cima do jogador.
  const spawnRadius = half - GRID_CELL * 3
  const spawnPoints: Vec2[] = []
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2
    spawnPoints.push({
      x: Math.cos(angle) * spawnRadius,
      z: Math.sin(angle) * spawnRadius,
    })
  }

  return {
    size,
    wallHeight,
    walls,
    boxes,
    playerStart: { x: 0, z: 0, yaw: 0 },
    spawnPoints,
  }
}
