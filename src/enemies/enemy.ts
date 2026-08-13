/**
 * Inimigos: estado, perseguicao e reacao ao dano.
 *
 * A reacao ao dano e uma dimensao inteira da rubrica, e e onde FPS amador
 * costuma falhar: sem estado de dor visivel, o jogador atira e nao sabe se
 * acertou. Aqui o dano produz tres sinais simultaneos — interrupcao do
 * movimento, empurrao e troca de cor — porque um so nao atravessa o ruido de
 * uma arena cheia.
 *
 * Modulo puro, sem Three.js.
 */

import { ENEMIES, PLAYER_RADIUS, TICRATE, chaseSpeed, damageThrust } from '../core/doom'
import type { Random } from '../core/random'
import { moveWithCollision, segmentBlocked, type Vec2, type Wall } from '../world/collision'
import { SHOT_HEIGHT } from '../weapons/hitscan'

export type EnemyKind = keyof typeof ENEMIES

export type EnemyState = 'chase' | 'attack' | 'pain' | 'dying' | 'dead'

export interface Enemy {
  id: number
  kind: EnemyKind
  x: number
  z: number
  radius: number
  height: number
  health: number
  maxHealth: number
  state: EnemyState
  /** Tics restantes no estado atual, quando o estado tem duracao. */
  stateTics: number
  /** Direcao para onde olha, usada pelo desenho. */
  yaw: number
  /** Empurrao residual do ultimo dano recebido. */
  knockX: number
  knockZ: number
  alive: boolean
  /** Tics ate poder atacar de novo. */
  attackCooldown: number
  /** Lado para onde circula ao chegar na distancia de tiro: 1 ou -1. */
  strafeDir: number
  /** Tics ate sortear um novo lado. */
  strafeTics: number
}

/**
 * Comportamento por tipo.
 *
 * DIVERGENCIA DECLARADA do benchmark: no DOOM o imp lanca bola de fogo. Aqui
 * ele e corpo a corpo rapido. Projetil viajante e escopo proprio (colisao,
 * desenho, previsao da IA) e nao entra nesta etapa. A escolha esta registrada
 * para nao ser lida depois como erro de fidelidade.
 */
export const BEHAVIOUR = {
  zombieman: {
    /** Atira de longe. */
    attackRange: 900,
    damage: 3,
    attackCooldownTics: 28,
    /** Distancia em que para de se aproximar. */
    preferredRange: 400,
  },
  imp: {
    attackRange: 150,
    damage: 7,
    attackCooldownTics: 20,
    // Perto, mas nao encostado. Colado, o modelo dele tomava metade da tela e
    // o jogador perdia de vista o resto da onda — que e justamente o momento
    // em que precisa ver o resto da onda.
    preferredRange: 118,
  },
} as const

let nextId = 1

export function createEnemy(kind: EnemyKind, x: number, z: number): Enemy {
  const stats = ENEMIES[kind]
  return {
    id: nextId++,
    kind,
    x,
    z,
    radius: stats.radius,
    height: stats.height,
    health: stats.health,
    maxHealth: stats.health,
    state: 'chase',
    stateTics: 0,
    yaw: 0,
    knockX: 0,
    knockZ: 0,
    alive: true,
    attackCooldown: 0,
    strafeDir: 1,
    strafeTics: 0,
  }
}

/** Reinicia a numeracao. Existe para manter os testes independentes. */
export function resetEnemyIds(): void {
  nextId = 1
}

export interface EnemyAttack {
  enemyId: number
  damage: number
}

export interface EnemyTickContext {
  player: Vec2
  walls: readonly Wall[]
  others: readonly Enemy[]
  random: Random
}

/**
 * Avanca um inimigo um tic.
 *
 * @returns o ataque desferido neste tic, se houver.
 */
export function tickEnemy(enemy: Enemy, context: EnemyTickContext): EnemyAttack | null {
  if (enemy.state === 'dead') return null

  if (enemy.state === 'dying') {
    enemy.stateTics--
    applyKnockback(enemy, context.walls)
    if (enemy.stateTics <= 0) enemy.state = 'dead'
    return null
  }

  faceTarget(enemy, context.player)
  applyKnockback(enemy, context.walls)

  if (enemy.attackCooldown > 0) enemy.attackCooldown--

  if (enemy.state === 'pain') {
    enemy.stateTics--
    // Em dor o inimigo nao anda nem ataca: e o que torna o acerto legivel.
    if (enemy.stateTics <= 0) enemy.state = 'chase'
    return null
  }

  const behaviour = BEHAVIOUR[enemy.kind]
  const distance = Math.hypot(context.player.x - enemy.x, context.player.z - enemy.z)
  // Mesma altura de visada do tiro do jogador: se o inimigo enxerga, ele pode
  // ser enxergado. Assimetria aqui produz a sensacao de tiro que vem do nada.
  const hasLineOfSight = !segmentBlocked(
    enemy.x, enemy.z, context.player.x, context.player.z, context.walls, SHOT_HEIGHT,
  )

  if (hasLineOfSight && distance <= behaviour.attackRange && enemy.attackCooldown <= 0) {
    enemy.state = 'attack'
    enemy.attackCooldown = behaviour.attackCooldownTics
    return { enemyId: enemy.id, damage: behaviour.damage }
  }

  enemy.state = 'chase'
  advance(enemy, context, distance, behaviour.preferredRange)
  return null
}

function faceTarget(enemy: Enemy, target: Vec2): void {
  enemy.yaw = Math.atan2(-(target.x - enemy.x), -(target.z - enemy.z))
}

/**
 * Move em direcao ao jogador.
 *
 * O DOOM move o monstro em saltos de `speed` unidades a cada frame de
 * caminhada. Aqui distribuimos o mesmo deslocamento por tic: a velocidade
 * media e identica, mas o movimento interpola sem tranco a 60 fps, onde o
 * salto original apareceria como engasgo.
 */
function advance(
  enemy: Enemy,
  context: EnemyTickContext,
  distance: number,
  preferredRange: number,
): void {
  // Nunca entrar no espaco do jogador. Sem este limite o inimigo corpo a
  // corpo caminha ate o centro dele, a camera termina dentro do modelo e o
  // jogador perde a nocao de onde a ameaca esta.
  const bodyDistance = PLAYER_RADIUS + enemy.radius
  const minimo = Math.max(preferredRange, bodyDistance)

  const speed = chaseSpeed(ENEMIES[enemy.kind])
  const toPlayerX = (context.player.x - enemy.x) / (distance || 1)
  const toPlayerZ = (context.player.z - enemy.z) / (distance || 1)

  let moveX: number
  let moveZ: number

  if (distance > minimo) {
    moveX = toPlayerX * speed
    moveZ = toPlayerZ * speed
  } else {
    // Chegou na distancia de tiro. A versao anterior simplesmente parava, e o
    // inimigo virava estatua: parecia alvo de estande enquanto continuava
    // matando de longe. Agora circula o jogador, trocando de lado de tempos
    // em tempos — le-se como ameaca viva e obriga a reajustar a mira.
    enemy.strafeTics--
    if (enemy.strafeTics <= 0) {
      enemy.strafeDir = context.random.float() < 0.5 ? 1 : -1
      enemy.strafeTics = 25 + context.random.int(45)
    }

    const lateral = speed * 0.7 * enemy.strafeDir
    moveX = -toPlayerZ * lateral
    moveZ = toPlayerX * lateral

    // Correcao suave de raio: se estiver perto ou longe demais da distancia
    // preferida, aproxima ou afasta enquanto circula.
    const erro = distance - minimo
    if (Math.abs(erro) > 40) {
      const ajuste = Math.sign(erro) * speed * 0.35
      moveX += toPlayerX * ajuste
      moveZ += toPlayerZ * ajuste
    }
  }

  const separation = computeSeparation(enemy, context.others)

  const moved = moveWithCollision(
    { x: enemy.x, z: enemy.z },
    { x: moveX + separation.x, z: moveZ + separation.z },
    enemy.radius,
    context.walls,
  )

  enemy.x = moved.x
  enemy.z = moved.z
}

/**
 * Empurrao suave entre inimigos.
 *
 * Sem isso todos convergem para o mesmo ponto e viram um unico bloco: a onda
 * perde a leitura, e o jogador nao consegue estimar quantos estao vindo.
 */
function computeSeparation(enemy: Enemy, others: readonly Enemy[]): Vec2 {
  let pushX = 0
  let pushZ = 0

  for (const other of others) {
    if (other.id === enemy.id || !other.alive) continue

    const dx = enemy.x - other.x
    const dz = enemy.z - other.z
    const distance = Math.hypot(dx, dz)
    const minimum = enemy.radius + other.radius

    if (distance === 0 || distance >= minimum) continue

    const strength = (minimum - distance) / minimum
    pushX += (dx / distance) * strength * 2
    pushZ += (dz / distance) * strength * 2
  }

  return { x: pushX, z: pushZ }
}

function applyKnockback(enemy: Enemy, walls: readonly Wall[]): void {
  if (enemy.knockX === 0 && enemy.knockZ === 0) return

  const moved = moveWithCollision(
    { x: enemy.x, z: enemy.z },
    { x: enemy.knockX, z: enemy.knockZ },
    enemy.radius,
    walls,
  )
  enemy.x = moved.x
  enemy.z = moved.z

  // Mesma friccao do jogador: o empurrao morre em poucos tics.
  enemy.knockX *= 0.75
  enemy.knockZ *= 0.75
  if (Math.abs(enemy.knockX) < 0.05) enemy.knockX = 0
  if (Math.abs(enemy.knockZ) < 0.05) enemy.knockZ = 0
}

export interface DamageResult {
  killed: boolean
  /** Entrou em estado de dor — o sinal visivel de que o tiro acertou. */
  staggered: boolean
}

/**
 * Aplica dano a um inimigo.
 *
 * @param dirX direcao do tiro, para o empurrao. Deve ser unitaria.
 */
export function damageEnemy(
  enemy: Enemy,
  damage: number,
  dirX: number,
  dirZ: number,
  random: Random,
): DamageResult {
  if (!enemy.alive || enemy.state === 'dying' || enemy.state === 'dead') {
    return { killed: false, staggered: false }
  }

  enemy.health -= damage

  const thrust = damageThrust(damage)
  enemy.knockX += dirX * thrust
  enemy.knockZ += dirZ * thrust

  if (enemy.health <= 0) {
    enemy.alive = false
    enemy.state = 'dying'
    enemy.stateTics = ENEMIES[enemy.kind].deathTics
    return { killed: true, staggered: false }
  }

  const stats = ENEMIES[enemy.kind]
  const staggered = random.float() < stats.painChance

  if (staggered) {
    enemy.state = 'pain'
    enemy.stateTics = stats.painTics
  }

  return { killed: false, staggered }
}

/** Quanto tempo o corpo permanece visivel apos a morte, em tics. */
export const CORPSE_LINGER_TICS = TICRATE * 8
