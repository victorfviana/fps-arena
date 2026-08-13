/**
 * Regras do jogo, sem nada de desenho.
 *
 * Toda a partida — jogador, arma, inimigos, ondas, pontuacao — avanca por
 * `tick`, que devolve os acontecimentos daquele tic. O desenho e o audio
 * consomem esses acontecimentos; nao os produzem. Isso permite rodar uma
 * partida inteira sob teste, sem navegador.
 */

import { TICRATE, VIEW_HEIGHT } from './core/doom'
import type { TicCommand } from './core/input'
import { createRandom, type Random } from './core/random'
import {
  BEHAVIOUR,
  createEnemy,
  damageEnemy,
  tickEnemy,
  type Enemy,
  type EnemyKind,
} from './enemies/enemy'
import { createPlayer, eyeHeight, forwardVector, tickPlayer, type PlayerState } from './player/player'
import { createWeapon, tickWeapon, type WeaponId, type WeaponState } from './weapons/weapon'
import { hitscan } from './weapons/hitscan'
import { createArena, type Arena } from './world/arena'
import {
  INTERMISSION_TICS,
  MAX_CONCURRENT,
  spawnIntervalTics,
  waveQueue,
} from './world/waves'

const HITSCAN_RANGE = 4000

export interface ShotTrace {
  fromX: number
  fromZ: number
  toX: number
  toZ: number
  hit: boolean
}

/**
 * Um ataque inimigo, com origem.
 *
 * A origem e o que faltava: o inimigo acertava o jogador por hitscan
 * instantaneo e nada disso era desenhado. Chegava um clarao vermelho na borda
 * da tela e a vida caia, sem pista nenhuma de quem atirou nem de onde. Sem
 * esta informacao o desenho nao tem como avisar.
 */
export interface EnemyShot {
  enemyId: number
  kind: EnemyKind
  fromX: number
  fromZ: number
  toX: number
  toZ: number
  damage: number
  /** Corpo a corpo nao desenha rastro, so o aviso de direcao. */
  melee: boolean
}

/** O que aconteceu num tic. Consumido pelo desenho e pelo audio. */
export interface GameEvents {
  fired: boolean
  weaponFired: WeaponId | null
  traces: ShotTrace[]
  hits: number
  kills: number
  damageTaken: number
  enemyShots: EnemyShot[]
  waveStarted: number | null
  playerDied: boolean
}

const NO_EVENTS: GameEvents = {
  fired: false,
  weaponFired: null,
  traces: [],
  hits: 0,
  kills: 0,
  damageTaken: 0,
  enemyShots: [],
  waveStarted: null,
  playerDied: false,
}

/** Como o jogador morreu, para a tela de fim explicar em vez de so contar. */
export interface DeathCause {
  kind: EnemyKind
  /** Distancia de onde veio o golpe fatal, em map units. */
  distance: number
  melee: boolean
}

export type GamePhase = 'intermission' | 'fighting' | 'over'

export class Game {
  readonly arena: Arena
  readonly player: PlayerState
  weapon: WeaponState
  readonly enemies: Enemy[] = []

  phase: GamePhase = 'intermission'
  wave = 0
  score = 0
  kills = 0

  /** Ultimo golpe recebido. Alimenta a tela de fim de jogo. */
  lastDamage: DeathCause | null = null

  private queue: EnemyKind[] = []
  private spawnCooldown = 0
  private phaseTics = INTERMISSION_TICS
  private nextSpawnIndex = 0
  private readonly random: Random

  constructor(seed = 0x1d1a) {
    this.arena = createArena()
    this.player = createPlayer(this.arena.playerStart)
    this.weapon = createWeapon('shotgun')
    this.random = createRandom(seed)
  }

  get aliveEnemies(): number {
    return this.enemies.filter((enemy) => enemy.alive).length
  }

  /** Inimigos que ainda ocupam a cena, incluindo os que estao morrendo. */
  get visibleEnemies(): Enemy[] {
    return this.enemies.filter((enemy) => enemy.state !== 'dead')
  }

  tick(command: TicCommand): GameEvents {
    if (this.phase === 'over') return NO_EVENTS

    const events: GameEvents = { ...NO_EVENTS, traces: [], enemyShots: [] }

    tickPlayer(this.player, command, this.arena.walls)
    this.advanceWave(events)
    this.fire(command, events)
    this.advanceEnemies(events)
    this.collectDead()

    if (this.player.health <= 0) {
      this.player.health = 0
      this.phase = 'over'
      events.playerDied = true
    }

    return events
  }

  private advanceWave(events: GameEvents): void {
    if (this.phase === 'intermission') {
      this.phaseTics--
      if (this.phaseTics > 0) return

      this.wave++
      this.queue = waveQueue(this.wave)
      this.nextSpawnIndex = 0
      this.spawnCooldown = 0
      this.phase = 'fighting'
      events.waveStarted = this.wave
      return
    }

    const pending = this.queue.length - this.nextSpawnIndex

    if (pending === 0 && this.aliveEnemies === 0) {
      this.phase = 'intermission'
      this.phaseTics = INTERMISSION_TICS
      // Sobreviver a onda inteira vale mais que a soma das mortes: e o que
      // transforma a partida numa escalada em vez de uma lista de abates.
      this.score += this.wave * 100
      return
    }

    if (pending === 0) return

    if (this.spawnCooldown > 0) {
      this.spawnCooldown--
      return
    }

    if (this.aliveEnemies >= MAX_CONCURRENT) return

    this.spawn(this.queue[this.nextSpawnIndex]!)
    this.nextSpawnIndex++
    this.spawnCooldown = spawnIntervalTics(this.wave)
  }

  /**
   * Faz nascer um inimigo no ponto mais distante do jogador.
   *
   * Nascer perto e desleal de um jeito que o jogador nao consegue prever nem
   * evitar — a morte parece bug, nao erro dele.
   */
  private spawn(kind: EnemyKind): void {
    const points = this.arena.spawnPoints
    let best = points[0]!
    let bestDistance = -1

    for (const point of points) {
      const distance = Math.hypot(point.x - this.player.x, point.z - this.player.z)
      // Desempate aleatorio evita que a onda inteira brote no mesmo canto.
      const jittered = distance + this.random.float() * 200

      if (jittered > bestDistance) {
        bestDistance = jittered
        best = point
      }
    }

    this.enemies.push(createEnemy(kind, best.x, best.z))
  }

  private fire(command: TicCommand, events: GameEvents): void {
    const event = tickWeapon(this.weapon, command.fire, this.random)
    if (!event) return

    events.fired = true
    events.weaponFired = event.weapon

    for (const pellet of event.pellets) {
      const angle = this.player.yaw + pellet.angleOffset
      const result = hitscan(
        this.player.x,
        this.player.z,
        angle,
        HITSCAN_RANGE,
        this.arena.walls,
        this.enemies,
      )

      events.traces.push({
        fromX: this.player.x,
        fromZ: this.player.z,
        toX: result.x,
        toZ: result.z,
        hit: result.target !== null,
      })

      if (!result.target) continue

      const direction = forwardVector(angle)
      const outcome = damageEnemy(
        result.target,
        pellet.damage,
        direction.x,
        direction.z,
        this.random,
      )

      events.hits++
      if (outcome.killed) {
        events.kills++
        this.kills++
        this.score += result.target.kind === 'imp' ? 60 : 25
      }
    }
  }

  private advanceEnemies(events: GameEvents): void {
    const context = {
      player: { x: this.player.x, z: this.player.z },
      walls: this.arena.walls,
      others: this.enemies,
      random: this.random,
    }

    for (const enemy of this.enemies) {
      const attack = tickEnemy(enemy, context)
      if (!attack) continue

      this.player.health -= attack.damage
      events.damageTaken += attack.damage

      const distance = Math.hypot(enemy.x - this.player.x, enemy.z - this.player.z)
      const melee = BEHAVIOUR[enemy.kind].attackRange < 200

      events.enemyShots.push({
        enemyId: enemy.id,
        kind: enemy.kind,
        fromX: enemy.x,
        fromZ: enemy.z,
        toX: this.player.x,
        toZ: this.player.z,
        damage: attack.damage,
        melee,
      })

      this.lastDamage = { kind: enemy.kind, distance, melee }
    }
  }

  /** Remove corpos ja terminados, para a lista nao crescer sem limite. */
  private collectDead(): void {
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      if (this.enemies[i]!.state === 'dead') this.enemies.splice(i, 1)
    }
  }

  /** Altura do olho no tic atual, para a camera. */
  get eyeY(): number {
    return eyeHeight(this.player)
  }
}

export { VIEW_HEIGHT, TICRATE }
