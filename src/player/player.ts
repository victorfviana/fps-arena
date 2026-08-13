/**
 * Fisica do jogador, um tic por vez.
 *
 * Reproduz a ordem de operacoes do DOOM, que e o que define a sensacao do
 * movimento: empuxo, deslocamento, friccao — nessa sequencia. Trocar a ordem
 * muda a velocidade final e o tempo de parada.
 *
 * Modulo puro e sem Three.js: e sobre ele que a rubrica de fidelidade de
 * movimento roda os numeros.
 */

import {
  BOB_AMPLITUDE,
  BOB_PERIOD_TICS,
  FORWARD_MOVE,
  FRICTION,
  MAX_BOB,
  MAX_MOVE,
  PLAYER_RADIUS,
  SIDE_MOVE,
  THRUST_SCALE,
  FRACUNIT,
  VIEW_HEIGHT,
} from '../core/doom'
import type { TicCommand } from '../core/input'
import { moveWithCollision, type Vec2, type Wall } from '../world/collision'

/** Limite do olhar vertical. O DOOM nao tinha; um FPS moderno precisa. */
const MAX_PITCH = Math.PI / 2 - 0.01

export interface PlayerState {
  x: number
  z: number
  /** Radianos. Zero olha para -Z; cresce girando para a esquerda. */
  yaw: number
  pitch: number
  /** Momento horizontal, em map units por tic. */
  momentumX: number
  momentumZ: number
  /** Tics acumulados em movimento, para a fase do balanco da camera. */
  bobPhaseTics: number
  /** Deslocamento vertical da camera neste tic. */
  viewBob: number
  health: number
}

export function createPlayer(start: { x: number; z: number; yaw: number }): PlayerState {
  return {
    x: start.x,
    z: start.z,
    yaw: start.yaw,
    pitch: 0,
    momentumX: 0,
    momentumZ: 0,
    bobPhaseTics: 0,
    viewBob: 0,
    health: 100,
  }
}

/** Vetor para onde o jogador olha, no plano horizontal. */
export function forwardVector(yaw: number): Vec2 {
  return { x: -Math.sin(yaw), z: -Math.cos(yaw) }
}

/** Vetor a direita do jogador, no plano horizontal. */
export function rightVector(yaw: number): Vec2 {
  return { x: Math.cos(yaw), z: -Math.sin(yaw) }
}

/** Altura do olho neste tic, ja com o balanco somado. */
export function eyeHeight(player: PlayerState): number {
  return VIEW_HEIGHT + player.viewBob
}

/**
 * Avanca o jogador um tic.
 *
 * Muta o estado recebido de proposito: um tic roda dezenas de vezes por
 * segundo e alocar um objeto novo a cada um so daria trabalho ao coletor.
 */
export function tickPlayer(
  player: PlayerState,
  command: TicCommand,
  walls: readonly Wall[],
): void {
  applyLook(player, command)
  applyThrust(player, command)
  applyMovement(player, walls)
  applyFriction(player)
  applyBob(player)
}

function applyLook(player: PlayerState, command: TicCommand): void {
  player.yaw += command.yawDelta
  player.pitch = clamp(player.pitch + command.pitchDelta, -MAX_PITCH, MAX_PITCH)

  // Sem isso o yaw cresce sem parar e, depois de muito tempo de jogo, a
  // precisao do float degrada visivelmente na mira.
  const twoPi = Math.PI * 2
  player.yaw = ((player.yaw % twoPi) + twoPi) % twoPi
}

function applyThrust(player: PlayerState, command: TicCommand): void {
  const speedIndex = command.run ? 'run' : 'walk'
  const forwardMove = FORWARD_MOVE[speedIndex]
  const sideMove = SIDE_MOVE[speedIndex]

  // Diagonal nao pode somar mais empuxo que a soma dos eixos permitiria, mas
  // o DOOM tambem nao normaliza: andar na diagonal e mesmo um pouco mais
  // rapido no original. Mantemos o comportamento, que faz parte da sensacao.
  const forward = forwardVector(player.yaw)
  const right = rightVector(player.yaw)

  const forwardThrust = (command.forward * forwardMove * THRUST_SCALE) / FRACUNIT
  const sideThrust = (command.side * sideMove * THRUST_SCALE) / FRACUNIT

  player.momentumX += forward.x * forwardThrust + right.x * sideThrust
  player.momentumZ += forward.z * forwardThrust + right.z * sideThrust

  player.momentumX = clamp(player.momentumX, -MAX_MOVE, MAX_MOVE)
  player.momentumZ = clamp(player.momentumZ, -MAX_MOVE, MAX_MOVE)
}

function applyMovement(player: PlayerState, walls: readonly Wall[]): void {
  const moved = moveWithCollision(
    { x: player.x, z: player.z },
    { x: player.momentumX, z: player.momentumZ },
    PLAYER_RADIUS,
    walls,
  )

  // Bater numa parede tem de matar o momento naquela direcao. Sem isso o
  // jogador fica colado, empurrando, e dispara de volta quando se afasta.
  const actualX = moved.x - player.x
  const actualZ = moved.z - player.z
  if (Math.abs(actualX) < Math.abs(player.momentumX) * 0.5) player.momentumX = actualX
  if (Math.abs(actualZ) < Math.abs(player.momentumZ) * 0.5) player.momentumZ = actualZ

  player.x = moved.x
  player.z = moved.z
}

function applyFriction(player: PlayerState): void {
  player.momentumX *= FRICTION
  player.momentumZ *= FRICTION

  // O DOOM zera o momento abaixo de um limiar. Sem isso o jogador desliza
  // eternamente por fracoes de unidade e o balanco da camera nunca descansa.
  const stopThreshold = 0.0625
  if (Math.abs(player.momentumX) < stopThreshold) player.momentumX = 0
  if (Math.abs(player.momentumZ) < stopThreshold) player.momentumZ = 0
}

/**
 * Balanco da camera.
 *
 * p_user.c: `bob = (momx^2 + momy^2) / 4`, limitado a MAXBOB, aplicado como
 * seno com amplitude de metade do valor. Na pratica o teto satura em
 * qualquer velocidade de caminhada — o balanco do DOOM e quase constante, e
 * some so quando o jogador para.
 */
function applyBob(player: PlayerState): void {
  const speedSquared =
    player.momentumX * player.momentumX + player.momentumZ * player.momentumZ

  if (speedSquared === 0) {
    // Volta suave ao repouso, em vez de cortar o balanco no meio do ciclo.
    player.viewBob *= 0.8
    if (Math.abs(player.viewBob) < 0.01) player.viewBob = 0
    return
  }

  player.bobPhaseTics = (player.bobPhaseTics + 1) % BOB_PERIOD_TICS

  const magnitude = Math.min(speedSquared / 4, MAX_BOB)
  const phase = (player.bobPhaseTics / BOB_PERIOD_TICS) * Math.PI * 2
  player.viewBob = (magnitude / MAX_BOB) * BOB_AMPLITUDE * Math.sin(phase)
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}
